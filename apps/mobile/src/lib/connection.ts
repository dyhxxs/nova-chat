export function normalizeServerUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (!/^https?:\/\//i.test(trimmed)) return 'https://' + trimmed;
  return trimmed;
}

export function toWebSocketUrl(serverUrl: string): string {
  const url = new URL(normalizeServerUrl(serverUrl));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = (url.pathname.replace(/\/$/, '') + '/v1/chat/stream').replace(/\/{2,}/g, '/');
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function toRestUrl(serverUrl: string, route: string): string {
  return normalizeServerUrl(serverUrl) + (route.startsWith('/') ? route : '/' + route);
}

export function isInsecureHttpUrl(value: string): boolean {
  try {
    return new URL(normalizeServerUrl(value)).protocol === 'http:';
  } catch {
    return false;
  }
}

export function isLocalHttpUrl(value: string): boolean {
  try {
    const url = new URL(normalizeServerUrl(value));
    return url.protocol === 'http:' && !['localhost', '127.0.0.1', '10.0.2.2'].includes(url.hostname);
  } catch {
    return false;
  }
}
