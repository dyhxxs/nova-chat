import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import type { AppDatabase, ProviderSettings } from '../src/database.js';
import { toPublicError } from '../src/errors.js';
import { ModelProvider } from '../src/provider.js';

const secret = 'synthetic-secret-never-echo';
const privateUrl = 'https://private-model-service.example/v1';
const settings: ProviderSettings = {
  apiBaseUrl: privateUrl, apiKey: secret, apiMode: 'responses', authMode: 'bearer',
  defaultModel: 'model-a', allowedModels: ['model-a'],
};
function provider() {
  const database = { getProviderSettings: () => ({ ...settings }) } as unknown as AppDatabase;
  return new ModelProvider(loadConfig({ NODE_ENV: 'test' }), database);
}
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status }); }
async function publicFailure(override?: ProviderSettings, signal?: AbortSignal) {
  const error = await provider().listModels(signal, override).then(() => { throw new Error('Expected failure'); }, error => toPublicError(error));
  expect(JSON.stringify(error)).not.toContain(secret);
  expect(JSON.stringify(error)).not.toContain(privateUrl);
  expect(JSON.stringify(error)).not.toContain('private-model-service.example');
  return error;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('safe model discovery diagnostics', () => {
  it.each([[{ id: ' model-b ' }, { name: 'model-a' }, 'model-b', null], { data: ['model-b', 'model-a', 'model-b'] }, { models: [{ name: 'model-b' }, { id: 'model-a' }] }])('preserves compatible model list shapes %#', async data => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(data)));
    expect(await provider().listModels()).toEqual(['model-a', 'model-b']);
  });
  it('preserves an explicitly empty model list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: [] })));
    expect(await provider().listModels()).toEqual([]);
  });
  it.each(['ENOTFOUND', 'EAI_AGAIN'])('classifies DNS %s without disclosing the destination', async code => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError(privateUrl + secret, { cause: Object.assign(new Error(secret), { code }) })));
    expect(await publicFailure()).toMatchObject({ code: 'provider_dns_error', statusCode: 502 });
  });
  it.each(['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID'])('classifies TLS %s without bypassing certificate verification', async code => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError(secret, { cause: { code } })));
    expect(await publicFailure()).toMatchObject({ code: 'provider_tls_error', statusCode: 502, retryable: false });
  });
  it.each(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'])('classifies network timeout %s', async code => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError(secret, { cause: { code } })));
    expect(await publicFailure()).toMatchObject({ code: 'provider_timeout', statusCode: 504 });
  });
  it('redacts unclassified connection errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError(privateUrl + secret, { cause: { code: secret } })));
    expect(await publicFailure()).toMatchObject({ code: 'provider_connection_error', statusCode: 502 });
  });
  it('handles HTML responses without echoing their content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`<html>${privateUrl}${secret}</html>`)));
    expect(await publicFailure()).toMatchObject({ code: 'provider_models_invalid_response', statusCode: 502 });
  });
  it.each([null, { error: { message: secret } }, { data: 'not-an-array' }])('rejects a non-list JSON shape %#', async data => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(data)));
    expect(await publicFailure()).toMatchObject({ code: 'provider_models_invalid_response', statusCode: 502 });
  });
  it.each([404, 405])('does not mislabel missing model-list endpoint %s as a missing chat model', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { message: privateUrl + secret } }, status)));
    expect(await publicFailure()).toMatchObject({ code: 'provider_models_unsupported', statusCode: 502 });
  });
  it.each([401, 403])('preserves sanitized authentication errors %s', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { message: privateUrl + secret } }, status)));
    expect(await publicFailure()).toMatchObject({ code: 'provider_auth_error', statusCode: 502 });
  });
  it('preserves rate-limiting classification', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { message: secret } }, 429)));
    expect(await publicFailure()).toMatchObject({ code: 'provider_rate_limited', statusCode: 429 });
  });
  it('reports body stream failures safely', async () => {
    const response = json({ data: [] });
    vi.spyOn(response, 'json').mockRejectedValue(new TypeError(privateUrl + secret, { cause: { code: 'UND_ERR_SOCKET' } }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    expect(await publicFailure()).toMatchObject({ code: 'provider_connection_error', statusCode: 502 });
  });
  it.each(['中文密钥', 'abc\nsecret'])('rejects invalid header characters before dispatch %#', async apiKey => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await publicFailure({ ...settings, apiKey })).toMatchObject({ code: 'provider_invalid_credentials_format', statusCode: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['not a url', 'ftp://example.test/v1', 'https://user:pass@example.test/v1', 'https://example.test/v1?secret=abc'])('rejects malformed or unsafe URLs before dispatch %#', async apiBaseUrl => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await publicFailure({ ...settings, apiBaseUrl })).toMatchObject({ code: 'provider_invalid_url', statusCode: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reports missing credentials without contacting the upstream', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await publicFailure({ ...settings, apiKey: '' })).toMatchObject({ code: 'provider_not_configured', statusCode: 503 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('cancels a disconnected client without reporting it as a provider outage', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => { controller.abort(); throw new DOMException('Aborted', 'AbortError'); }));
    expect(await publicFailure(undefined, controller.signal)).toMatchObject({ code: 'cancelled', statusCode: 499 });
  });
  it('does not dispatch a pre-aborted request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await publicFailure(undefined, AbortSignal.abort())).toMatchObject({ code: 'cancelled', statusCode: 499 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('enforces its 20-second deadline within the mobile 30-second request budget', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => { controller.abort(new DOMException('Timed out', 'TimeoutError')); throw controller.signal.reason; }));
    expect(await publicFailure()).toMatchObject({ code: 'provider_timeout', statusCode: 504 });
    expect(timeout).toHaveBeenCalledWith(20_000);
  });
});
