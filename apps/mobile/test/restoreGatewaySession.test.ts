import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-file-system', () => ({ File: class {}, UploadType: { MULTIPART: 0 } }));
import { GatewayApiError } from '../src/services/gatewayApiClient';
import { isInvalidSession, isRetryableSessionError, restoreGatewaySession } from '../src/services/restoreGatewaySession';

const user = { id: 'user-1', email: 'user@example.com', displayName: 'User', role: 'user', disabled: false, createdAt: 1, updatedAt: 1 };
describe('restoring a session through an unreliable gateway', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('keeps the authenticated user when the model catalog fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user }), { status: 200 }))
      .mockResolvedValueOnce(new Response('Proxy unavailable', { status: 530 })));
    await expect(restoreGatewaySession('https://gateway.test', 'session-token')).resolves.toEqual({ user, catalog: undefined });
  });
  it('does not classify proxy failures, timeouts or network errors as an expired session', () => {
    for (const status of [0, 429, 500, 502, 503, 504, 530]) expect(isInvalidSession(new GatewayApiError('error', 'failed', true, status))).toBe(false);
    expect(isInvalidSession(new Error('Network failed'))).toBe(false);
    for (const status of [401, 403]) expect(isInvalidSession(new GatewayApiError('unauthorized', 'failed', false, status))).toBe(true);
  });
  it('propagates a gateway outage without attempting to load the model catalog', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('Proxy unavailable', { status: 530 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(restoreGatewaySession('https://gateway.test', 'session-token')).rejects.toMatchObject({ status: 530 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('session restore cancellation and proxy boundaries', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([401, 403])('does not treat a non-gateway HTTP %s as a reason to erase credentials', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Proxy access denied</html>', { status })));
    const error = await restoreGatewaySession('https://gateway.test', 'session-token').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(GatewayApiError);
    expect(isInvalidSession(error)).toBe(false); expect(isRetryableSessionError(error)).toBe(false);
  });
  it('classifies retryable transport failures without retrying cancellation or invalid sessions', () => {
    for (const status of [408, 425, 429]) expect(isRetryableSessionError(new GatewayApiError(`http_${status}`, 'later', false, status))).toBe(true);
    for (const status of [0, 502, 503, 530]) expect(isRetryableSessionError(new GatewayApiError('temporary', 'later', true, status))).toBe(true);
    for (const error of [new Error('local disk'), new GatewayApiError('aborted', 'cancelled', true, 0), new GatewayApiError('unauthorized', 'no', true, 401), new GatewayApiError('forbidden', 'no', true, 403), new GatewayApiError('http_404', 'not found', false, 404)]) expect(isRetryableSessionError(error)).toBe(false);
  });
  it('does not issue a request if cancellation already happened', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); const controller = new AbortController(); controller.abort();
    await expect(restoreGatewaySession('https://gateway.test', 'session-token', controller.signal)).rejects.toMatchObject({ code: 'aborted' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('aborts /auth/me without attempting the catalog', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })); vi.stubGlobal('fetch', fetchMock);
    const work = expect(restoreGatewaySession('https://gateway.test', 'session-token', controller.signal)).rejects.toMatchObject({ code: 'aborted' });
    controller.abort(); await work; expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('checks cancellation between profile and catalog even if fetch ignores abort', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => { controller.abort(); return JSON.stringify({ user }); } });
    vi.stubGlobal('fetch', fetchMock);
    await expect(restoreGatewaySession('https://gateway.test', 'session-token', controller.signal)).rejects.toMatchObject({ code: 'aborted' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not swallow cancellation during the optional catalog request', async () => {
    const controller = new AbortController(); let began!: () => void; const started = new Promise<void>((resolve) => { began = resolve; });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ user })))
      .mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }); began();
      })); vi.stubGlobal('fetch', fetchMock);
    const work = expect(restoreGatewaySession('https://gateway.test', 'session-token', controller.signal)).rejects.toMatchObject({ code: 'aborted' });
    await started; controller.abort(); await work; expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('checks cancellation after a catalog response that ignored abort', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ user })))
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => { controller.abort(); return JSON.stringify({ models: ['test'], defaultModel: 'test' }); } }));
    await expect(restoreGatewaySession('https://gateway.test', 'session-token', controller.signal)).rejects.toMatchObject({ code: 'aborted' });
  });
  it('does not restore a session revoked between profile and catalog', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ user })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'revoked', retryable: false } }), { status: 401 })));
    await expect(restoreGatewaySession('https://gateway.test', 'session-token')).rejects.toMatchObject({ code: 'unauthorized', status: 401 });
  });
  it('still tolerates a catalog-only proxy failure after successful profile authentication', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ user })))
      .mockResolvedValueOnce(new Response('<html>Proxy blocked catalog</html>', { status: 403 })));
    await expect(restoreGatewaySession('https://gateway.test', 'session-token')).resolves.toEqual({ user, catalog: undefined });
  });
});
