import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import https from 'node:https';
import http from 'node:http';

export class ToolError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export async function fetchToolText(url: URL, signal: AbortSignal, headers: Record<string, string> = {}, redirects = 0): Promise<string> {
  const response = await fetch(url, { signal, headers: { accept: 'application/json, text/plain, application/xml', ...headers }, redirect: 'manual' });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    await response.body?.cancel();
    const location = response.headers.get('location');
    if (!location || redirects >= 3) throw new ToolError('redirect_limit', '数据服务重定向无效或次数过多。');
    const next = new URL(location, url);
    const bingHosts = new Set(['www.bing.com', 'cn.bing.com']);
    if (next.protocol !== 'https:' || next.username || next.password || next.port
      || (next.hostname !== url.hostname && !(bingHosts.has(url.hostname) && bingHosts.has(next.hostname)))) {
      throw new ToolError('blocked_redirect', '数据服务跳转到未授权地址，已阻止访问。');
    }
    return fetchToolText(next, signal, next.hostname === url.hostname ? headers : {}, redirects + 1);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ToolError('service_unavailable', `数据服务返回 HTTP ${response.status}，本次没有取得可靠数据。`);
  }
  if (!response.body) throw new ToolError('empty_response', '数据服务返回空内容。');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 512_000) throw new ToolError('response_too_large', '数据服务返回内容过大，已停止读取。');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

export async function fetchToolJson(url: URL, signal: AbortSignal, headers?: Record<string, string>): Promise<any> {
  const text = await fetchToolText(url, signal, headers);
  try { return JSON.parse(text); } catch { throw new ToolError('invalid_response', '数据服务未返回有效 JSON，可能被代理或验证页面拦截。'); }
}

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(address, prefix, 'ipv4');
const publicV6 = new BlockList();
publicV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) blocked.addSubnet(address, prefix, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  // Reject mapped IPv4, NAT64, local/multicast and transition networks rather than translating them.
  return family === 6 && publicV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

export function publicUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new ToolError('invalid_url', '请输入完整的 http 或 https 网页地址。'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || (url.port && !['80', '443'].includes(url.port))
    || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || (isIP(host) && !isPublicAddress(host))) {
    throw new ToolError('blocked_url', '只允许读取公开网页；内网、环回、特殊端口和带凭据的地址不可访问。');
  }
  url.hash = '';
  return url;
}

/** Every redirect is revalidated; DNS is resolved once and pinned at connection time. No cookies, proxy or provider keys. */
export async function readPublicPage(value: string, signal: AbortSignal, redirects = 0): Promise<{ url: string; text: string }> {
  const url = publicUrl(value);
  signal.throwIfAborted();
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let abortListener: (() => void) | undefined;
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await Promise.race([
    lookup(host, { all: true }),
    new Promise<never>((_, reject) => {
      abortListener = () => reject(signal.reason);
      signal.addEventListener('abort', abortListener, { once: true });
      if (signal.aborted) abortListener();
    }),
  ]).finally(() => {
    if (abortListener) signal.removeEventListener('abort', abortListener);
  });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new ToolError('blocked_url', '网页地址解析到非公开网络，已阻止访问。');
  const selected = addresses[0]!;
  const result = await new Promise<{ redirect?: string; text?: string }>((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.get(url, {
      signal, agent: false,
      headers: { 'user-agent': 'NovaChat/1.0 (public-page-reader)', accept: 'text/html,text/plain,application/xhtml+xml', 'accept-encoding': 'identity' },
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [selected]);
        else callback(null, selected.address, selected.family);
      },
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
        response.destroy();
        resolve({ redirect: response.headers.location });
        return;
      }
      if ((response.statusCode ?? 500) >= 400 || !/^(text\/(?:html|plain)|application\/xhtml\+xml)(?:;|$)/i.test(response.headers['content-type'] ?? '')) {
        response.destroy();
        reject(new ToolError('unreadable_page', '网页拒绝访问或不是可读取的 HTML/文本；不支持登录、验证码、PDF 或 JavaScript 渲染页面。'));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 512_000) {
          response.destroy();
          reject(new ToolError('response_too_large', '网页超过读取大小限制。'));
        } else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
  });
  if (result.redirect) {
    if (redirects >= 3) throw new ToolError('redirect_limit', '网页重定向次数过多。');
    return readPublicPage(new URL(result.redirect, url).toString(), signal, redirects + 1);
  }
  if (!result.text) throw new ToolError('empty_response', '网页未返回可读取内容。');
  return { url: url.toString(), text: htmlText(result.text).slice(0, 16_000) };
}

export function htmlText(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (v) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[v]!)
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, value: string) => {
      const point = value[0]?.toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ' ';
    }).replace(/\s+/g, ' ').trim();
}
