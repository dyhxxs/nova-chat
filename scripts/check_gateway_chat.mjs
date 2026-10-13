import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { checkGateway, validateFriendGateway, readGatewayJson } from './check_gateway.mjs';

const MAX_REPLY = 32 * 1024;
export class ChatCheckError extends Error {
  constructor(code, report) {
    super(code);
    this.name = 'ChatCheckError';
    this.code = code;
    this.report = report;
  }
}

function checkedOrigin(value, { localOnly, allowTemporary }) {
  if (!localOnly) return validateFriendGateway(value, { allowTemporary });
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) throw new Error('invalid_loopback_origin');
  return url.origin;
}


/** One synthetic model request, never retried. The caller owns the session lifecycle. */
export async function checkGatewayChat(value, {
  accessToken, allowTemporary = false, localOnly = false, requireRegistration = true,
  fetchImpl = fetch, socketFactory = (url, options) => new WebSocket(url, options),
  httpTimeoutMs = 15_000, chatTimeoutMs = 90_000,
} = {}) {
  const report = {
    checkedAt: new Date().toISOString(), scope: localOnly ? 'loopback-only' : 'public-gateway',
    publicChatVerified: false, modelRequestsAttempted: 0, checks: [],
  };
  let stage = 'configuration';
  let base, payload, completed = false;
  const pass = (name) => report.checks.push({ name, ok: true });
  const fail = () => { throw new Error(stage); };
  async function request(route, { authenticated = true, method = 'GET', expectedStatus = 200 } = {}) {
    const response = await fetchImpl(base + route, {
      method, redirect: 'error', signal: AbortSignal.timeout(httpTimeoutMs),
      headers: authenticated ? { authorization: `Bearer ${accessToken}` } : {},
    });
    if (response.status !== expectedStatus) {
      await response.body?.cancel().catch(() => {});
      fail();
    }
    return readGatewayJson(response);
  }
  try {
    base = checkedOrigin(value, { localOnly, allowTemporary });
    if (typeof accessToken !== 'string' || !accessToken.trim() || accessToken.length > 4096
        || /[\s\x00-\x1f\x7f]/.test(accessToken)) fail();
    if (!Number.isInteger(httpTimeoutMs) || httpTimeoutMs < 1 || httpTimeoutMs > 30_000
        || !Number.isInteger(chatTimeoutMs) || chatTimeoutMs < 1 || chatTimeoutMs > 120_000) fail();
    report.gatewayUrl = base;
    stage = 'readiness';
    if (localOnly) {
      const health = await request('/health', { authenticated: false });
      const setup = await request('/v1/setup/status', { authenticated: false });
      if (health?.ok !== true || health?.service !== 'nova-chat-gateway'
          || setup?.needsBootstrap !== false || setup?.providerConfigured !== true) fail();
    } else {
      await checkGateway(base, { allowTemporary, requireRegistration, fetchImpl });
    }
    pass(stage);
    stage = 'authentication_guard';
    const denied = await request('/v1/auth/me', { authenticated: false, expectedStatus: 401 });
    if (denied?.error?.code !== 'unauthorized') fail();
    pass(stage);
    stage = 'authenticated_session';
    const me = await request('/v1/auth/me');
    if (typeof me?.user?.id !== 'string' || !me.user.id || me.user.disabled !== false) fail();
    pass(stage);
    stage = 'model_catalog';
    const catalog = await request('/v1/models');
    if (typeof catalog?.defaultModel !== 'string' || !catalog.defaultModel.trim() || catalog.defaultModel.length > 100
        || !Array.isArray(catalog.models) || !catalog.models.includes(catalog.defaultModel)) fail();
    pass(stage);
    payload = {
      requestId: randomUUID(), conversationId: randomUUID(), deviceId: 'nova-release-chat-check',
      messages: [{ role: 'user', content: '这是连接测试。请只回复：连接成功。', attachments: [] }],
      options: {
        model: catalog.defaultModel, reasoningEffort: 'low', verbosity: 'low', maxOutputTokens: 1024,
        autoTools: false, knowledgeBase: false, webSearch: false, codeInterpreter: false,
      },
    };
    stage = 'websocket_chat';
    const startedAt = Date.now();
    const result = await new Promise((resolve, reject) => {
      const wsUrl = new URL('/v1/chat/stream', base);
      wsUrl.protocol = localOnly ? 'ws:' : 'wss:';
      const ws = socketFactory(wsUrl.href, {
        followRedirects: false, handshakeTimeout: httpTimeoutMs, maxPayload: 64 * 1024, perMessageDeflate: false,
      });
      let settled = false, helloSent = false, started = false, text = '', deltaCount = 0;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // terminate is bounded, unlike waiting indefinitely for a peer's close handshake.
        // Keep listeners until the close/error events drain; settled prevents late sends.
        try { ws.terminate(); } catch { /* already closed */ }
        if (error) reject(error); else resolve({ text, deltaCount });
      };
      const timer = setTimeout(() => finish(new Error('chat_timeout')), chatTimeoutMs);
      ws.on('open', () => {
        if (settled || helloSent) return;
        helloSent = true;
        try { ws.send(JSON.stringify({ type: 'hello', accessToken, deviceId: payload.deviceId })); }
        catch { finish(new Error('hello_failed')); }
      });
      ws.on('message', (raw, isBinary) => {
        if (settled) return;
        try {
          if (isBinary || Buffer.byteLength(raw) > 64 * 1024) throw new Error('invalid_frame');
          const message = JSON.parse(raw.toString());
          if (!message || typeof message.type !== 'string') throw new Error('invalid_message');
          if (message.type === 'ready') {
            if (!helloSent) throw new Error('unexpected_ready');
            if (started) return;
            started = true;
            report.modelRequestsAttempted = 1;
            pass('authenticated_websocket_ready');
            ws.send(JSON.stringify({ type: 'start', payload }));
            return;
          }
          if (message.type === 'error' && (!message.requestId || message.requestId === payload.requestId)) {
            throw new Error('server_error');
          }
          if (message.requestId !== payload.requestId) return;
          if (!started) throw new Error('unexpected_chat_frame');
          if (message.type === 'tool' || message.type === 'cancelled') throw new Error('unexpected_chat_result');
          if (message.type === 'delta') {
            if (typeof message.delta !== 'string') throw new Error('invalid_delta');
            text += message.delta;
            deltaCount += 1;
            if (Buffer.byteLength(text) > MAX_REPLY) throw new Error('reply_too_large');
          }
          if (message.type === 'done') {
            if (!deltaCount || !text.trim() || (message.tools?.length ?? 0) > 0
                || (message.attachments?.length ?? 0) > 0 || message.knowledge) throw new Error('invalid_completion');
            finish();
          }
        } catch { finish(new Error('chat_protocol_or_server_error')); }
      });
      ws.on('error', () => finish(new Error('websocket_failed')));
      ws.on('close', () => finish(new Error('websocket_closed_early')));
    });
    report.deltaCount = result.deltaCount;
    report.replyCharacters = result.text.length;
    report.chatDurationMs = Date.now() - startedAt;
    pass(stage);
    stage = 'completed_job_snapshot';
    const route = `/v1/chat/jobs/${payload.requestId}?conversationId=${encodeURIComponent(payload.conversationId)}`;
    const job = await request(route);
    if (job?.requestId !== payload.requestId || job?.conversationId !== payload.conversationId
        || job?.status !== 'completed' || job?.text !== result.text) fail();
    completed = true;
    pass(stage);
    report.publicChatVerified = !localOnly;
    return report;
  } catch {
    report.checks.push({ name: stage, ok: false });
    // Do not echo server text, URL errors, tokens, account identity or model replies.
    throw new ChatCheckError(`chat_check_${stage}_failed`, report);
  } finally {
    if (report.modelRequestsAttempted && !completed && base && payload) {
      try {
        const result = await request(`/v1/chat/jobs/${payload.requestId}/cancel?conversationId=${encodeURIComponent(payload.conversationId)}`, { method: 'POST' });
        report.cancellationRequested = result?.ok === true;
      } catch { report.cancellationRequested = false; }
      // A successful cancel request is not proof of zero upstream billing.
    }
    report.finishedAt = new Date().toISOString();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (!args[0] || args.slice(1).some(arg => !['--allow-temporary', '--local-only', '--existing-accounts-only'].includes(arg))) {
      throw new Error('invalid_arguments');
    }
    const accessToken = process.env.NOVA_RELEASE_SESSION_TOKEN;
    delete process.env.NOVA_RELEASE_SESSION_TOKEN;
    const report = await checkGatewayChat(args[0], {
      accessToken, allowTemporary: args.includes('--allow-temporary'), localOnly: args.includes('--local-only'), requireRegistration: !args.includes('--existing-accounts-only'),
    });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false, code: error instanceof ChatCheckError ? error.code : 'chat_check_configuration_failed',
      ...(error instanceof ChatCheckError ? { report: error.report } : {}),
    }, null, 2));
    process.exitCode = 1;
  }
}
