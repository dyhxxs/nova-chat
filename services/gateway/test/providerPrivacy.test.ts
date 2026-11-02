import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { buildServer } from '../src/server.js';
import { resolveProviderSettings } from '../src/providerSettings.js';

const secret = 'private-provider-credential-DO-NOT-RETURN-9271';
const upstream = 'https://private-upstream.example/v1';
const apps: FastifyInstance[] = [];
const directories: string[] = [];
const options = { apiMode: 'responses' as const, authMode: 'bearer' as const, defaultModel: 'model-a', allowedModels: ['model-a'] };
const current = { ...options, apiBaseUrl: upstream, apiKey: secret };
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } }); }
async function setup() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'nova-provider-privacy-')); directories.push(dataDir);
  const app = await buildServer(loadConfig({
    NODE_ENV: 'test', DATA_DIR: dataDir, LOG_LEVEL: 'silent',
    SERVER_MASTER_KEY: 'synthetic-privacy-test-master-key-over-32-characters',
    ADMIN_BOOTSTRAP_TOKEN: 'synthetic-bootstrap-over-24-characters',
    OPENAI_API_KEY: secret, OPENAI_BASE_URL: upstream, OPENAI_MODEL: 'model-a', ALLOWED_MODELS: 'model-a', REQUESTS_PER_MINUTE: '500',
  }));
  apps.push(app);
  const result = await app.inject({ method: 'POST', url: '/v1/auth/bootstrap', payload: {
    email: 'admin@example.test', password: 'synthetic-long-password', displayName: 'Admin', deviceId: 'synthetic-device',
    bootstrapToken: 'synthetic-bootstrap-over-24-characters',
  } });
  expect(result.statusCode).toBe(201);
  const headers = { authorization: `Bearer ${result.json().accessToken}` };
  return { app, headers };
}
function expectNoFullSecret(body: string) {
  expect(body).not.toContain(secret);
  expect(body).not.toContain('apiKeyPreview');
}
afterEach(async () => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  while (apps.length) await apps.pop()?.close();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('provider credential disclosure', () => {
  it('returns safe diagnostics for a failed draft without persisting the draft', async () => {
    const { app, headers } = await setup();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError(`${upstream} ${secret}`, { cause: { code: 'ENOTFOUND' } })));
    const result = await app.inject({ method: 'POST', url: '/v1/admin/provider/test', headers,
      payload: { ...options, apiBaseUrl: upstream, apiKey: secret, defaultModel: 'unsaved-model' } });
    expect(result.statusCode).toBe(502);
    expect(result.json().error.code).toBe('provider_dns_error');
    expectNoFullSecret(result.body);
    const saved = await app.inject({ method: 'GET', url: '/v1/admin/provider', headers });
    expect(saved.json().provider.defaultModel).toBe('model-a');
    const anonymous = await app.inject({ method: 'POST', url: '/v1/admin/provider/test', payload: options });
    expect(anonymous.statusCode).toBe(401);
  });
  it('never discloses environment fallback settings, even to an administrator', async () => {
    const { app, headers } = await setup();
    const result = await app.inject({ method: 'GET', url: '/v1/admin/provider', headers });
    expect(result.statusCode).toBe(200);
    expect(result.json().provider).toEqual({ ...options, apiBaseUrl: '', apiBaseUrlSet: true, apiKeySet: true, apiKeyHint: '' });
    expectNoFullSecret(result.body);
    expect(result.body).not.toContain(upstream);
    expect(result.body).not.toContain('private-upstream.example');
    expect(result.body).not.toContain(secret.slice(-4));
  });
  it.each([{}, { apiBaseUrl: '', apiKey: '' }])('retains blank or omitted credentials through save and model refresh: %j', async (fields) => {
    const { app, headers } = await setup();
    const fetch = vi.fn().mockImplementation(() => response({ data: [{ id: 'model-a' }] })); vi.stubGlobal('fetch', fetch);
    const saved = await app.inject({ method: 'PUT', url: '/v1/admin/provider', headers, payload: { ...options, ...fields } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().provider).toMatchObject({ apiBaseUrl: upstream, apiKeyHint: 'privat…9271', apiBaseUrlSet: true, apiKeySet: true });
    expect(saved.json().provider).not.toHaveProperty('apiKey');
    expectNoFullSecret(saved.body);
    const tested = await app.inject({ method: 'POST', url: '/v1/admin/provider/test', headers, payload: { ...options, ...fields } });
    expect(tested.statusCode).toBe(200); expectNoFullSecret(tested.body);
    expect(fetch).toHaveBeenCalledWith(`${upstream}/models`, expect.objectContaining({ headers: expect.objectContaining({ authorization: `Bearer ${secret}` }) }));
  });
  it.each(['PUT', 'POST'] as const)('rejects forwarding the saved key to another destination on %s', async (method) => {
    const { app, headers } = await setup(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const result = await app.inject({ method, url: `/v1/admin/provider${method === 'POST' ? '/test' : ''}`, headers,
      payload: { ...options, apiBaseUrl: 'https://another.example/collect', apiKey: ' ' } });
    expect(result.statusCode).toBe(400); expect(result.json().error.code).toBe('provider_credentials_required');
    expect(fetch).not.toHaveBeenCalled(); expectNoFullSecret(result.body);
  });
  it('allows explicit replacement, returns the new URL and masked hint only, and uses only the replacement key', async () => {
    const { app, headers } = await setup(); const replacementKey = 'different-synthetic-secret-8642';
    const newUrl = 'https://replacement.example/v2';
    const fetch = vi.fn().mockImplementation(() => response({ data: [{ id: 'model-a' }] })); vi.stubGlobal('fetch', fetch);
    const saved = await app.inject({ method: 'PUT', url: '/v1/admin/provider', headers, payload: { ...options, apiBaseUrl: newUrl, apiKey: replacementKey } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().provider.apiBaseUrl).toBe(newUrl);
    expect(saved.json().provider.apiKeyHint).toBe('differ…8642');
    expect(saved.json().provider).not.toHaveProperty('apiKey');
    expect(saved.body).not.toContain(replacementKey);
    const tested = await app.inject({ method: 'POST', url: '/v1/admin/provider/test', headers });
    expect(tested.statusCode).toBe(200);
    expect(fetch).toHaveBeenCalledWith(`${newUrl}/models`, expect.objectContaining({ headers: expect.objectContaining({ authorization: `Bearer ${replacementKey}` }) }));
  });
  it.each(['ftp://private-upstream.example/v1', 'https://user:password@private-upstream.example/v1', `${upstream}?key=${secret}`, `${upstream}#${secret}`])('rejects invalid destinations without echoing input: %s', async (apiBaseUrl) => {
    const { app, headers } = await setup();
    const result = await app.inject({ method: 'PUT', url: '/v1/admin/provider', headers, payload: { ...options, apiBaseUrl, apiKey: 'replacement' } });
    expect(result.statusCode).toBe(400); expectNoFullSecret(result.body);
  });
  it.each([400, 401, 403, 422, 500])('never returns upstream error text or error codes containing credentials (HTTP %s)', async (status) => {
    const { app, headers } = await setup();
    const fetch = vi.fn().mockResolvedValue(response({ error: { code: `bad-${secret}`, message: `Access to ${upstream} failed with ${secret}` } }, status)); vi.stubGlobal('fetch', fetch);
    const result = await app.inject({ method: 'POST', url: '/v1/admin/provider/test', headers });
    expect(result.statusCode).toBeGreaterThanOrEqual(400); expectNoFullSecret(result.body);
    expect(result.json().error.code).toMatch(/^provider_/);
  });
  it('treats path changes as new destinations, but tolerates a trailing slash', () => {
    expect(() => resolveProviderSettings(current, { ...options, apiBaseUrl: `${upstream}/other` })).toThrow('新的密钥');
    expect(resolveProviderSettings(current, { ...options, apiBaseUrl: `${upstream}/` })).toEqual(current);
  });
});
