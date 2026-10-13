import { pathToFileURL } from 'node:url';
import { BlockList, isIP } from 'node:net';

// Public IP SAN certificates are valid release targets. Keep non-public IPs blocked.
const nonPublicIpv4 = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) nonPublicIpv4.addSubnet(address, prefix, 'ipv4');

export async function readGatewayJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('empty_response');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > (256 * 1024)) throw new Error('response_too_large');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}


export function validateFriendGateway(value, { allowTemporary = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new Error('必须提供有效的 HTTPS 网关地址。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('分享版本必须使用 HTTPS 根地址，不能包含账号、路径、查询参数或片段。');
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || !host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost')
    || host.endsWith('.test') || host.endsWith('.invalid') || host.endsWith('.example')
    || (isIP(host) === 4 && nonPublicIpv4.check(host, 'ipv4')) || host.includes(':')) {
    throw new Error('分享版本必须使用公网域名或公网 IPv4，不能内置本机、保留或局域网地址。');
  }
  if ((host === 'trycloudflare.com' || host.endsWith('.trycloudflare.com')) && !allowTemporary) {
    throw new Error('拒绝将临时 trycloudflare 隧道打包为稳定分享版：隧道失效会再次出现 530。请使用固定域名，或显式选择临时预览版。');
  }
  return url.origin;
}

export async function checkGateway(value, { allowTemporary = false, requireRegistration = true, fetchImpl = fetch } = {}) {
  const base = validateFriendGateway(value, { allowTemporary });
  async function get(route) {
    const response = await fetchImpl(base + route, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
    if (!response.ok) throw new Error(`${route} 返回 HTTP ${response.status}；请先恢复网关/隧道，禁止分发不可用安装包。`);
    try { return await readGatewayJson(response); } catch { throw new Error(`${route} 没有返回大小受限的有效 JSON，可能连接到了代理错误页面。`); }
  }
  const health = await get('/health');
  if (health?.ok !== true || health?.service !== 'nova-chat-gateway') throw new Error('目标不是健康的 Nova Gateway。');
  const setup = await get('/v1/setup/status');
  if (setup?.needsBootstrap !== false) throw new Error('请先创建管理员，不应让朋友初始化服务器。');
  if (typeof setup?.registrationEnabled !== 'boolean' || (requireRegistration && !setup.registrationEnabled)) throw new Error('管理员尚未开启注册。');
  if (setup?.providerConfigured !== true) throw new Error('模型服务未配置，或网关版本过旧；请先配置/更新网关。');
  // Never merge response-owned fields into locally verified release metadata.
  const hostname = new URL(base).hostname;
  return {
    gatewayUrl: base, checkedAt: new Date().toISOString(),
    temporary: hostname === 'trycloudflare.com' || hostname.endsWith('.trycloudflare.com'),
    needsBootstrap: false, registrationEnabled: setup.registrationEnabled, providerConfigured: true,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await checkGateway(process.argv[2], { allowTemporary: process.argv.includes('--allow-temporary'), requireRegistration: !process.argv.includes('--existing-accounts-only') });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
