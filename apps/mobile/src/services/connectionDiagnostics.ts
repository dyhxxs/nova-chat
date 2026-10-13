import { normalizeServerUrl, toRestUrl, toWebSocketUrl } from '../lib/connection';

export type DiagnosticStep = { id: 'address' | 'gateway' | 'catalog' | 'stream'; label: string; status: 'ok' | 'warning' | 'error' | 'skipped'; detail: string; durationMs: number };
export type DiagnosticReport = { checkedAt: number; transport: 'HTTPS' | 'HTTP' | 'invalid'; cancelled: boolean; steps: DiagnosticStep[] };
type Input = { serverUrl: string; accessToken: string; deviceId: string; signal?: AbortSignal; timeoutMs?: number };
class CheckError extends Error {
  constructor(readonly kind: 'timeout' | 'network' | 'format' | 'auth' | 'http' | 'cancelled', readonly status?: number) { super(kind); }
}
const labels = { address: '服务器地址', gateway: '网关响应', catalog: '登录与模型目录', stream: '实时连接握手' };
function explain(error: unknown): string {
  if (!(error instanceof CheckError)) return '连接失败，请检查网络、证书和反向代理。';
  if (error.kind === 'cancelled') return '已取消检查。';
  if (error.kind === 'timeout') return '连接超时，请检查网络、服务器和代理超时设置。';
  if (error.kind === 'auth') return '登录凭证无效或没有访问权限，请重新登录。';
  if (error.kind === 'format') return '响应不是预期的 Nova 网关数据，请检查入口和反向代理。';
  if (error.kind === 'http') return `服务器返回 HTTP ${error.status}，请联系管理员排查网关或代理。`;
  return '网络或 TLS 连接失败。浏览器预览还需检查 CORS 与混合内容限制。';
}
async function getJson(url: string, input: Input, authenticated: boolean) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (input.signal?.aborted) throw new CheckError('cancelled');
  input.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, input.timeoutMs ?? 6_000);
  try {
    const response = await fetch(url, { method: 'GET', headers: authenticated ? { authorization: `Bearer ${input.accessToken}` } : {}, signal: controller.signal, redirect: 'error' });
    if (response.status === 401 || response.status === 403) throw new CheckError('auth');
    if (!response.ok) throw new CheckError('http', response.status);
    try { return await response.json() as unknown; } catch { throw new CheckError('format'); }
  } catch (error) {
    if (input.signal?.aborted) throw new CheckError('cancelled');
    if (controller.signal.aborted) throw new CheckError('timeout');
    if (error instanceof CheckError) throw error;
    throw new CheckError('network');
  } finally { clearTimeout(timer); input.signal?.removeEventListener('abort', abort); }
}
function checkSocket(url: string, input: Input): Promise<void> {
  return new Promise((resolve, reject) => {
    if (input.signal?.aborted) { reject(new CheckError('cancelled')); return; }
    let socket: WebSocket;
    try { socket = new WebSocket(url); } catch { reject(new CheckError('network')); return; }
    let settled = false;
    const finish = (error?: CheckError) => {
      if (settled) return;
      settled = true; clearTimeout(timer); input.signal?.removeEventListener('abort', abort);
      socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null;
      try { socket.close(1000, 'diagnostic complete'); } catch { /* Connecting socket can reject close. */ }
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(new CheckError('cancelled'));
    const timer = setTimeout(() => finish(new CheckError('timeout')), input.timeoutMs ?? 6_000);
    input.signal?.addEventListener('abort', abort, { once: true });
    if (input.signal?.aborted) { abort(); return; }
    socket.onopen = () => {
      try { socket.send(JSON.stringify({ type: 'hello', accessToken: input.accessToken, deviceId: input.deviceId })); }
      catch { finish(new CheckError('network')); }
    };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'ready') finish();
        else if (message.type === 'error') finish(new CheckError(message.code === 'unauthorized' ? 'auth' : 'format'));
        else finish(new CheckError('format'));
      } catch { finish(new CheckError('format')); }
    };
    socket.onerror = () => finish(new CheckError('network'));
    socket.onclose = (event) => finish(new CheckError(event.code === 4401 ? 'auth' : 'network'));
  });
}
/** Only metadata GETs + hello/ready. Never upload, start a job, or contact a model provider. */
export async function runConnectionDiagnostics(input: Input): Promise<DiagnosticReport> {
  const report: DiagnosticReport = { checkedAt: Date.now(), transport: 'invalid', cancelled: false, steps: [] };
  const add = (id: DiagnosticStep['id'], status: DiagnosticStep['status'], detail: string, started = Date.now()) => report.steps.push({ id, label: labels[id], status, detail, durationMs: Math.max(0, Date.now() - started) });
  let base: string;
  try {
    base = normalizeServerUrl(input.serverUrl);
    const url = new URL(base);
    if (!base || !['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error('invalid');
    report.transport = url.protocol === 'https:' ? 'HTTPS' : 'HTTP';
    add('address', report.transport === 'HTTP' ? 'warning' : 'ok', report.transport === 'HTTP' ? '正在使用未加密 HTTP。仅应在可信本地网络测试，公开部署请使用 HTTPS。' : '地址格式正确，使用 HTTPS。');
  } catch { add('address', 'error', '地址无效。请填写 HTTP(S) 网关根地址，不要包含用户名、密码、查询参数或片段。'); return report; }
  for (const id of ['gateway', 'catalog', 'stream'] as const) {
    if (input.signal?.aborted) { report.cancelled = true; add(id, 'skipped', '已取消检查。'); continue; }
    if (report.steps.some((step) => step.status === 'error')) { add(id, 'skipped', '前置检查未通过，未继续发送请求。'); continue; }
    if (id !== 'gateway' && !input.accessToken) { add(id, 'skipped', '尚未登录，仅检查公共网关响应。'); continue; }
    const started = Date.now();
    try {
      if (id === 'gateway') {
        const data = await getJson(toRestUrl(base, '/health'), input, false) as { ok?: unknown; service?: unknown } | null;
        if (data?.ok !== true || data.service !== 'nova-chat-gateway') throw new CheckError('format');
        add(id, 'ok', '网关健康端点可达；这不代表上游模型可用。', started);
      } else if (id === 'catalog') {
        const data = await getJson(toRestUrl(base, '/v1/models'), input, true) as { models?: unknown; defaultModel?: unknown } | null;
        if (!data || !Array.isArray(data.models) || data.models.some((model) => typeof model !== 'string' || !model.trim()) || typeof data.defaultModel !== 'string') throw new CheckError('format');
        const configured = data.models.length > 0 && data.models.includes(data.defaultModel);
        add(id, configured ? 'ok' : 'warning', configured ? `登录有效，网关提供 ${data.models.length} 个模型选项。未调用上游验证。` : '登录有效，但模型目录为空或默认模型不在目录中，请管理员检查配置。', started);
      } else { await checkSocket(toWebSocketUrl(base), input); add(id, 'ok', 'WebSocket 认证握手成功。未发起生成任务。', started); }
    } catch (error) {
      if (input.signal?.aborted) report.cancelled = true;
      add(id, report.cancelled ? 'skipped' : 'error', explain(error), started);
    }
  }
  return report;
}
/** Report contains only locally-generated summaries, never URL/host, credentials, IDs or server error bodies. */
export function formatDiagnosticReport(report: DiagnosticReport, client: { version: string; platform: string }) {
  return ['Nova 连接诊断（脱敏）', `时间：${new Date(report.checkedAt).toISOString()}`, `客户端：${client.version} / ${client.platform}`, `传输：${report.transport}`, `状态：${report.cancelled ? '已取消' : '已完成'}`, ...report.steps.map((step) => `${step.label} [${step.status}] ${step.durationMs}ms — ${step.detail}`), '仅检查网关、目录和实时握手，不验证上游模型、附件或付费能力。', '不含服务器地址、账户资料、令牌、设备标识、模型名称或聊天内容。'].join('\n');
}
