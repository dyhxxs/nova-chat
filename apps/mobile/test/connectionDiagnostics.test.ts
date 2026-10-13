import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDiagnosticReport, runConnectionDiagnostics } from '../src/services/connectionDiagnostics';
const input = { serverUrl: 'https://private-gateway.example/nova', accessToken: 'test-session-token', deviceId: 'test-device-id' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  sent: string[] = [];
  closed = false;
  constructor(readonly url: string) { FakeSocket.instances.push(this); queueMicrotask(() => this.onopen?.()); }
  send(value: string) { this.sent.push(value); queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'ready' }) })); }
  close() { this.closed = true; }
}
function goodFetch() { return vi.fn().mockResolvedValueOnce(json({ ok: true, service: 'nova-chat-gateway' })).mockResolvedValueOnce(json({ models: ['private-model-name'], defaultModel: 'private-model-name' })); }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); FakeSocket.instances = []; });
describe('privacy-safe connection diagnostics', () => {
  it('only makes metadata GETs and a hello handshake, then closes the socket', async () => {
    const fetchMock = goodFetch(); vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('WebSocket', FakeSocket);
    const report = await runConnectionDiagnostics(input);
    expect(report.steps.map((step) => step.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([input.serverUrl + '/health', input.serverUrl + '/v1/models']);
    expect(fetchMock.mock.calls[0]![1].headers).toEqual({});
    expect(fetchMock.mock.calls[1]![1].headers).toEqual({ authorization: 'Bearer ' + input.accessToken });
    for (const [, init] of fetchMock.mock.calls) { expect(init.method).toBe('GET'); expect(init.body).toBeUndefined(); }
    const socket = FakeSocket.instances[0]!;
    expect(socket.url).toBe('wss://private-gateway.example/nova/v1/chat/stream');
    expect(socket.closed).toBe(true);
    expect(socket.sent.map((frame) => JSON.parse(frame).type)).toEqual(['hello']);
    const text = formatDiagnosticReport(report, { version: 'test', platform: 'web' });
    for (const secret of [input.accessToken, input.deviceId, 'private-gateway', 'private-model-name']) expect(text).not.toContain(secret);
  });
  it.each(['https://name:password@example.com', 'https://example.com?token=secret', 'https://example.com#secret', ''])('rejects unsafe/invalid address %s before any network request', async (serverUrl) => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const result = await runConnectionDiagnostics({ ...input, serverUrl });
    expect(result.steps[0]?.status).toBe('error'); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not send credentials after a proxy HTML response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<html>proxy secret-token</html>')); vi.stubGlobal('fetch', fetchMock);
    const result = await runConnectionDiagnostics(input);
    expect(result.steps.map((step) => step.status)).toEqual(['ok', 'error', 'skipped', 'skipped']);
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(JSON.stringify(result)).not.toContain('secret-token');
  });
  it('reports auth errors without copying untrusted server error details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ ok: true, service: 'nova-chat-gateway' })).mockResolvedValueOnce(json({ error: { message: 'secret echoed token' } }, 401)));
    const result = await runConnectionDiagnostics(input);
    expect(result.steps[2]?.detail).toContain('重新登录'); expect(result.steps[3]?.status).toBe('skipped'); expect(JSON.stringify(result)).not.toContain('secret echoed');
  });
  it('limits public diagnostics to health when no token exists and warns about plaintext', async () => {
    const fetchMock = goodFetch(); vi.stubGlobal('fetch', fetchMock);
    const result = await runConnectionDiagnostics({ ...input, accessToken: '', serverUrl: 'http://192.168.1.2:8787' });
    expect(result.transport).toBe('HTTP'); expect(result.steps.map((step) => step.status)).toEqual(['warning', 'ok', 'skipped', 'skipped']); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('cancels an in-flight request and does not start later checks', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))));
    vi.stubGlobal('fetch', fetchMock);
    const pending = runConnectionDiagnostics({ ...input, signal: controller.signal }); controller.abort();
    const result = await pending; expect(result.cancelled).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(1); expect(result.steps.at(-1)?.status).toBe('skipped');
  });
  it('times out and cleans up a websocket that never answers', async () => {
    vi.useFakeTimers(); vi.stubGlobal('fetch', goodFetch());
    class SilentSocket extends FakeSocket { override send(value: string) { this.sent.push(value); } }
    vi.stubGlobal('WebSocket', SilentSocket);
    const pending = runConnectionDiagnostics({ ...input, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending; expect(result.steps.at(-1)?.detail).toContain('超时'); expect(FakeSocket.instances[0]?.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
