import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig, type AppConfig } from '../src/config.js';
import { buildServer } from '../src/server.js';
import { ModelProvider, type GenerationResult } from '../src/provider.js';

const apps: FastifyInstance[] = [];
const temporaryDirectories: string[] = [];
const bootstrapToken = 'test-bootstrap-token-with-more-than-24-characters';

async function startServer(overrides: NodeJS.ProcessEnv = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'nova-chat-server-test-'));
  temporaryDirectories.push(dataDir);
  const config = loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    LOG_LEVEL: 'silent',
    SERVER_MASTER_KEY: 'server-test-master-key-with-more-than-thirty-two-characters',
    ADMIN_BOOTSTRAP_TOKEN: bootstrapToken,
    OPENAI_API_KEY: 'environment-provider-key',
    OPENAI_MODEL: 'gpt-5.6-sol',
    ALLOWED_MODELS: 'gpt-5.6-sol,gpt-5.6-terra',
    REQUESTS_PER_MINUTE: '500',
    ...overrides,
  });
  const app = await buildServer(config as AppConfig);
  apps.push(app);
  return app;
}

async function bootstrap(app: FastifyInstance) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/bootstrap',
    payload: {
      email: 'admin@example.com',
      password: 'admin password 12345',
      displayName: 'Administrator',
      deviceId: 'admin-test-device',
      bootstrapToken,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { accessToken: string; user: { id: string; role: string } };
}

async function register(app: FastifyInstance, index: number) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: {
      email: `user${index}@example.com`,
      password: `secure password ${index}2345`,
      displayName: `User ${index}`,
      deviceId: `user-${index}-test-device`,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { accessToken: string; user: { id: string; role: string } };
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function multipartFile(filename: string, mimeType: string, bytes: Buffer) {
  const boundary = `----nova-chat-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`, 'utf8'),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

afterEach(async () => {
  while (apps.length) await apps.pop()?.close();
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('gateway server', () => {
  it('correlates every JSON error with the request id returned in the header', async () => {
    const app = await startServer();
    const requestId = 'support-case-2026-10-19';
    const response = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { 'x-request-id': requestId } });
    expect(response.statusCode).toBe(401);
    expect(response.headers['x-request-id']).toBe(requestId);
    expect(response.json().error.requestId).toBe(requestId);
  });

  it('reports draining readiness and rejects new application requests during shutdown', async () => {
    const app = await startServer();
    app.beginDrain();
    const live = await app.inject('/healthz');
    expect(live.statusCode).toBe(200);
    expect(live.json()).toMatchObject({ ok: true, status: 'draining' });
    const ready = await app.inject('/readyz');
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toMatchObject({ ok: false, status: 'draining' });
    const rejected = await app.inject('/v1/auth/me');
    expect(rejected.statusCode).toBe(503);
    expect(rejected.json().error.code).toBe('server_draining');
    expect(rejected.headers['retry-after']).toBe('5');
  });

  it('registers an immediately usable non-admin account without a display name or provider fields', async () => {
    const app = await startServer();
    await bootstrap(app);
    const response = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: {
      email: 'friend@example.com', password: 'friend password 12345', deviceId: 'friend-test-device',
    } });
    expect(response.statusCode).toBe(201);
    const auth = response.json();
    expect(auth.user).toMatchObject({ displayName: '新用户', role: 'user' });
    expect(auth.accessToken).toBeTruthy();
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(auth.accessToken) });
    expect(me.statusCode).toBe(200);
    const models = await app.inject({ method: 'GET', url: '/v1/models', headers: bearer(auth.accessToken) });
    expect(models.statusCode).toBe(200);
    expect(models.json().defaultModel).toBe('gpt-5.6-sol');
    expect(models.body).not.toContain('environment-provider-key');
  });

  it('reports missing provider configuration without leaking credentials', async () => {
    const app = await startServer({ OPENAI_API_KEY: '' });
    await bootstrap(app);
    const status = await app.inject({ method: 'GET', url: '/v1/setup/status' });
    expect(status.json()).toMatchObject({ needsBootstrap: false, registrationEnabled: true, providerConfigured: false });
    const configured = await startServer();
    const ready = await configured.inject({ method: 'GET', url: '/v1/setup/status' });
    expect(ready.json().providerConfigured).toBe(true);
    expect(ready.body).not.toContain('environment-provider-key');
  });

  it('reports health without exposing secrets', async () => {
    const app = await startServer({ APP_ACCESS_TOKEN: 'legacy-friend-token' });
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, service: 'nova-chat-gateway', apiMode: 'responses', defaultModel: 'gpt-5.6-sol' });
    expect(response.body).not.toContain('environment-provider-key');
    expect(response.body).not.toContain('legacy-friend-token');
  });


  it('exposes operational probes, correlation ids and protected metrics', async () => {
    const metricsToken = 'metrics-test-token-with-more-than-24-characters';
    const app = await startServer({ METRICS_ENABLED: 'true', METRICS_TOKEN: metricsToken });
    const health = await app.inject({ method: 'GET', url: '/healthz', headers: { 'x-request-id': 'trace-123' } });
    expect(health.statusCode).toBe(200);
    expect(health.headers['x-request-id']).toBe('trace-123');
    expect(health.json()).toMatchObject({ ok: true, status: 'alive' });

    const missingRoute = await app.inject({ method: 'GET', url: '/v1/unknown/tenant-secret-123' });
    expect(missingRoute.statusCode).toBe(404);

    const ready = await app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ ok: true, checks: { database: 'ok', provider: 'configured' } });

    expect((await app.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(401);
    const metrics = await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: `Bearer ${metricsToken}` } });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.headers['content-type']).toContain('text/plain');
    expect(metrics.body).toContain('nova_gateway_http_requests_total');
    expect(metrics.body).toContain('route="/healthz"');
    expect(metrics.body).toContain('route="/unknown"');
    expect(metrics.body).not.toContain('tenant-secret-123');
    expect(metrics.body).not.toContain(metricsToken);
  });

  it('rate limits repeated login failures per source and account', async () => {
    const app = await startServer({ LOGIN_ATTEMPTS_PER_WINDOW: '2', LOGIN_WINDOW_MS: '60000' });
    await bootstrap(app);
    const payload = { email: 'admin@example.com', password: 'wrong password 12345', deviceId: 'login-limit-device' };
    expect((await app.inject({ method: 'POST', url: '/v1/auth/login', payload })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/auth/login', payload })).statusCode).toBe(401);
    const limited = await app.inject({ method: 'POST', url: '/v1/auth/login', payload });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeTruthy();
    expect(limited.json().error.code).toBe('rate_limited');
  });
  it('blocks stale clients while exposing update metadata to the current client', async () => {
    const app = await startServer({
      NOVA_MINIMUM_APP_VERSION_CODE: '30',
      NOVA_LATEST_APP_VERSION: '1.1.28',
      NOVA_LATEST_APP_VERSION_CODE: '30',
      NOVA_APP_DOWNLOAD_URL: 'https://134.175.139.81/downloads/NovaChat-1.1.28-android-arm64.apk',
    });
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    const oldSetup = await app.inject({ method: 'GET', url: '/v1/setup/status' });
    expect(oldSetup.statusCode).toBe(426);
    expect(oldSetup.json().error).toMatchObject({ code: 'upgrade_required', retryable: false });
    expect(oldSetup.json().error.details).toMatchObject({ latestVersion: '1.1.28', latestVersionCode: 30 });
    const currentSetup = await app.inject({ method: 'GET', url: '/v1/setup/status', headers: {
      'x-nova-app-version': '1.1.28', 'x-nova-app-version-code': '30',
    } });
    expect(currentSetup.statusCode).toBe(200);
    expect(currentSetup.json().appUpdate).toMatchObject({ minimumVersionCode: 30, latestVersion: '1.1.28' });
    const appUpdate = await app.inject({ method: 'GET', url: '/v1/app/update' });
    expect(appUpdate.statusCode).toBe(200);
    expect(appUpdate.json().update.downloadUrl).toContain('NovaChat-1.1.28');
  });

  it('requires a valid conversation scope for durable job lookup and cancellation', async () => {
    const app = await startServer();
    const account = await bootstrap(app);
    const requestId = '11111111-1111-4111-8111-111111111111';
    const conversationId = '22222222-2222-4222-8222-222222222222';
    const otherConversationId = '33333333-3333-4333-8333-333333333333';

    const missingLookup = await app.inject({ method: 'GET', url: `/v1/chat/jobs/${requestId}`, headers: bearer(account.accessToken) });
    expect(missingLookup.statusCode).toBe(400);
    expect(missingLookup.json().error.code).toBe('invalid_conversation_scope');

    const missingCancel = await app.inject({ method: 'POST', url: `/v1/chat/jobs/${requestId}/cancel`, headers: bearer(account.accessToken) });
    expect(missingCancel.statusCode).toBe(400);
    expect(missingCancel.json().error.code).toBe('invalid_conversation_scope');

    const unknownLookup = await app.inject({ method: 'GET', url: `/v1/chat/jobs/${requestId}?conversationId=${conversationId}`, headers: bearer(account.accessToken) });
    expect(unknownLookup.statusCode).toBe(404);
    const unknownCancel = await app.inject({ method: 'POST', url: `/v1/chat/jobs/${requestId}/cancel?conversationId=${otherConversationId}`, headers: bearer(account.accessToken) });
    expect(unknownCancel.statusCode).toBe(404);
  });

  it('supports bootstrap, registration, login, session lookup, logout, and admin authorization', async () => {
    const app = await startServer();
    const statusBefore = await app.inject({ method: 'GET', url: '/v1/setup/status' });
    expect(statusBefore.json()).toMatchObject({ needsBootstrap: true, bootstrapTokenRequired: true, registrationEnabled: true });

    const invalidBootstrap = await app.inject({
      method: 'POST', url: '/v1/auth/bootstrap',
      payload: { email: 'admin@example.com', password: 'admin password 12345', displayName: 'Admin', deviceId: 'admin-test-device', bootstrapToken: 'wrong' },
    });
    expect(invalidBootstrap.statusCode).toBe(403);
    expect(invalidBootstrap.json().error.code).toBe('invalid_bootstrap_token');

    const admin = await bootstrap(app);
    const duplicateBootstrap = await app.inject({
      method: 'POST', url: '/v1/auth/bootstrap',
      payload: { email: 'other@example.com', password: 'other password 12345', displayName: 'Other', deviceId: 'other-test-device', bootstrapToken },
    });
    expect(duplicateBootstrap.statusCode).toBe(409);

    const user = await register(app, 1);
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(user.accessToken) });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({ id: user.user.id, email: 'user1@example.com', role: 'user' });
    expect(me.body).not.toContain('password');

    const denied = await app.inject({ method: 'GET', url: '/v1/admin/users', headers: bearer(user.accessToken) });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('forbidden');

    const users = await app.inject({ method: 'GET', url: '/v1/admin/users', headers: bearer(admin.accessToken) });
    expect(users.statusCode).toBe(200);
    expect(users.json().users).toHaveLength(2);
    expect(users.body).not.toContain('password_hash');
    expect(users.body).not.toContain('password_salt');

    const badLogin = await app.inject({
      method: 'POST', url: '/v1/auth/login',
      payload: { email: 'user1@example.com', password: 'definitely wrong', deviceId: 'login-test-device' },
    });
    expect(badLogin.statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST', url: '/v1/auth/login',
      payload: { email: 'USER1@example.com', password: 'secure password 12345', deviceId: 'login-test-device' },
    });
    expect(login.statusCode).toBe(200);
    const loginToken = (login.json() as { accessToken: string }).accessToken;

    const logout = await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: bearer(loginToken) });
    expect(logout.statusCode).toBe(200);
    const afterLogout = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(loginToken) });
    expect(afterLogout.statusCode).toBe(401);
  });

  it('enforces the registration switch while keeping existing administrator login available', async () => {
    const app = await startServer({ REGISTRATION_ENABLED: 'false' });
    const status = await app.inject({ method: 'GET', url: '/v1/setup/status' });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ needsBootstrap: true, registrationEnabled: false });

    const admin = await bootstrap(app);
    const blockedRegistration = await app.inject({
      method: 'POST', url: '/v1/auth/register',
      payload: { email: 'blocked@example.com', password: 'secure password 12345', displayName: 'Blocked', deviceId: 'blocked-test-device' },
    });
    expect(blockedRegistration.statusCode).toBe(403);
    expect(blockedRegistration.json().error.code).toBe('registration_disabled');

    const login = await app.inject({
      method: 'POST', url: '/v1/auth/login',
      payload: { email: 'ADMIN@example.com', password: 'admin password 12345', deviceId: 'admin-login-device' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().user).toMatchObject({ id: admin.user.id, role: 'admin' });
  });

  it('authenticates the legacy app token without exposing it as an account session', async () => {
    const app = await startServer({ APP_ACCESS_TOKEN: 'legacy-friend-token' });

    const authorized = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer('legacy-friend-token') });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json().user).toMatchObject({ id: 'legacy-access-token', role: 'user' });

    const rejected = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer('wrong-token') });
    expect(rejected.statusCode).toBe(401);
    expect(rejected.json().error.code).toBe('unauthorized');

    const logout = await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: bearer('legacy-friend-token') });
    expect(logout.statusCode).toBe(200);
    const stillAuthorized = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer('legacy-friend-token') });
    expect(stillAuthorized.statusCode).toBe(200);
  });
  it('lets only admins manage provider configuration and never returns the provider API key', async () => {
    const app = await startServer();
    const admin = await bootstrap(app);
    const user = await register(app, 2);
    const apiKey = 'provider-super-secret-value-9876';
    const providerPayload = {
      apiBaseUrl: 'https://provider.example/v1/',
      apiKey,
      apiMode: 'responses',
      authMode: 'bearer',
      defaultModel: 'gpt-5.6-luna',
      allowedModels: ['gpt-5.6-luna'],
    };

    const denied = await app.inject({ method: 'PUT', url: '/v1/admin/provider', headers: bearer(user.accessToken), payload: providerPayload });
    expect(denied.statusCode).toBe(403);

    const updated = await app.inject({ method: 'PUT', url: '/v1/admin/provider', headers: bearer(admin.accessToken), payload: providerPayload });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().provider).toMatchObject({
      apiBaseUrlSet: true,
      apiKeySet: true,
      defaultModel: 'gpt-5.6-luna',
      allowedModels: ['gpt-5.6-luna'],
    });
    expect(updated.body).not.toContain(apiKey);
    expect(updated.json().provider).not.toHaveProperty('apiKey');

    const fetched = await app.inject({ method: 'GET', url: '/v1/admin/provider', headers: bearer(admin.accessToken) });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.body).not.toContain(apiKey);
    expect(fetched.json().provider).not.toHaveProperty('apiKey');
    for (const response of [updated, fetched]) {
      expect(response.body).not.toContain('provider.example');
      expect(response.body).not.toContain('9876');
      expect(response.json().provider.apiBaseUrl).toBe('');
      expect(response.json().provider).not.toHaveProperty('apiKeyPreview');
    }

    const models = await app.inject({ method: 'GET', url: '/v1/models', headers: bearer(user.accessToken) });
    expect(models.json()).toMatchObject({ models: ['gpt-5.6-luna'], defaultModel: 'gpt-5.6-luna', apiMode: 'responses' });
    expect(models.body).not.toContain(apiKey);
  });

  it('lets administrators page through an audit trail without exposing secrets', async () => {
    const app = await startServer();
    const admin = await bootstrap(app);
    const user = await register(app, 18);

    const denied = await app.inject({ method: 'GET', url: '/v1/admin/audit', headers: bearer(user.accessToken) });
    expect(denied.statusCode).toBe(403);

    const first = await app.inject({ method: 'GET', url: '/v1/admin/audit?limit=1', headers: bearer(admin.accessToken) });
    expect(first.statusCode).toBe(200);
    expect(first.json().events).toHaveLength(1);
    expect(first.json().events[0]).toMatchObject({ action: 'auth.register', actorEmail: 'user18@example.com' });
    expect(first.body).not.toContain('password');
    expect(first.body).not.toContain('bootstrap-token');
    expect(first.json().nextBefore).toBeTypeOf('number');

    const next = await app.inject({
      method: 'GET',
      url: `/v1/admin/audit?limit=10&before=${first.json().nextBefore}`,
      headers: bearer(admin.accessToken),
    });
    expect(next.statusCode).toBe(200);
    expect(next.json().events.some((event: { action: string }) => event.action === 'auth.bootstrap')).toBe(true);
  });

  it('protects the final enabled administrator and revokes disabled user sessions', async () => {
    const app = await startServer();
    const admin = await bootstrap(app);
    const user = await register(app, 3);

    for (const patch of [{ disabled: true }, { role: 'user' }]) {
      const response = await app.inject({
        method: 'PATCH', url: `/v1/admin/users/${admin.user.id}`,
        headers: bearer(admin.accessToken), payload: patch,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('last_admin');
    }

    const disabled = await app.inject({
      method: 'PATCH', url: `/v1/admin/users/${user.user.id}`,
      headers: bearer(admin.accessToken), payload: { disabled: true },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().user.disabled).toBe(true);

    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(user.accessToken) });
    expect(me.statusCode).toBe(401);
    const login = await app.inject({
      method: 'POST', url: '/v1/auth/login',
      payload: { email: 'user3@example.com', password: 'secure password 32345', deviceId: 'disabled-user-device' },
    });
    expect(login.statusCode).toBe(401);
  });

  it('supports updating a profile and managing its avatar', async () => {
    const app = await startServer();
    await bootstrap(app);
    const account = await register(app, 6);

    const updatedProfile = await app.inject({
      method: 'PATCH', url: '/v1/auth/me', headers: bearer(account.accessToken),
      payload: { displayName: 'Updated User' },
    });
    expect(updatedProfile.statusCode).toBe(200);
    expect(updatedProfile.json().user).toMatchObject({ id: account.user.id, displayName: 'Updated User' });

    const avatarBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const avatarPart = multipartFile('avatar.png', 'image/png', avatarBytes);
    const uploaded = await app.inject({
      method: 'POST', url: '/v1/auth/me/avatar', headers: { ...bearer(account.accessToken), ...avatarPart.headers }, payload: avatarPart.payload,
    });
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json().user).toMatchObject({ id: account.user.id, displayName: 'Updated User' });
    const avatarFileId = (uploaded.json() as { user: { avatarFileId: string } }).user.avatarFileId;
    expect(avatarFileId).toEqual(expect.any(String));

    const avatar = await app.inject({ method: 'GET', url: `/v1/files/${avatarFileId}`, headers: bearer(account.accessToken) });
    expect(avatar.statusCode).toBe(200);
    expect(avatar.headers['content-type']).toContain('image/png');
    expect(avatar.rawPayload.equals(avatarBytes)).toBe(true);

    const removed = await app.inject({ method: 'DELETE', url: '/v1/auth/me/avatar', headers: bearer(account.accessToken) });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().user).not.toHaveProperty('avatarFileId');
    const afterRemove = await app.inject({ method: 'GET', url: `/v1/files/${avatarFileId}`, headers: bearer(account.accessToken) });
    expect(afterRemove.statusCode).toBe(404);
  });

  it('validates upload MIME signatures and enforces per-user file access', async () => {
    const app = await startServer();
    const admin = await bootstrap(app);
    const owner = await register(app, 4);
    const stranger = await register(app, 5);

    const textPart = multipartFile('notes.txt', 'text/plain', Buffer.from('hello'));
    const textUpload = await app.inject({
      method: 'POST', url: '/v1/files', headers: { ...bearer(owner.accessToken), ...textPart.headers }, payload: textPart.payload,
    });
    expect(textUpload.statusCode).toBe(201);
    expect(textUpload.json().attachment).toMatchObject({ mimeType: 'text/plain', kind: 'document' });

    const unsupportedPart = multipartFile('archive.bin', 'application/octet-stream', Buffer.from([0x01, 0x02, 0x03]));
    const unsupported = await app.inject({
      method: 'POST', url: '/v1/files', headers: { ...bearer(owner.accessToken), ...unsupportedPart.headers }, payload: unsupportedPart.payload,
    });
    expect(unsupported.statusCode).toBe(415);
    expect(unsupported.json().error.code).toBe('unsupported_file');

    const invalidPngPart = multipartFile('fake.png', 'image/png', Buffer.from('this is not a PNG'));
    const invalidPng = await app.inject({
      method: 'POST', url: '/v1/files', headers: { ...bearer(owner.accessToken), ...invalidPngPart.headers }, payload: invalidPngPart.payload,
    });
    expect(invalidPng.statusCode).toBe(415);
    expect(invalidPng.json().error.code).toBe('invalid_file_content');

    const pdfBytes = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'ascii');
    const validPdfPart = multipartFile('说明.pdf', 'application/pdf', pdfBytes);
    const uploaded = await app.inject({
      method: 'POST', url: '/v1/files', headers: { ...bearer(owner.accessToken), ...validPdfPart.headers }, payload: validPdfPart.payload,
    });
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json().attachment).toMatchObject({ mimeType: 'application/pdf', size: pdfBytes.length, kind: 'document' });
    expect(uploaded.json().attachment).not.toHaveProperty('storagePath');
    expect(uploaded.json().attachment).not.toHaveProperty('userId');
    const fileId = (uploaded.json() as { attachment: { id: string } }).attachment.id;

    const ownerRead = await app.inject({ method: 'GET', url: `/v1/files/${fileId}`, headers: bearer(owner.accessToken) });
    expect(ownerRead.statusCode).toBe(200);
    expect(ownerRead.headers['content-type']).toContain('application/pdf');
    expect(ownerRead.rawPayload.equals(pdfBytes)).toBe(true);

    const strangerRead = await app.inject({ method: 'GET', url: `/v1/files/${fileId}`, headers: bearer(stranger.accessToken) });
    expect(strangerRead.statusCode).toBe(404);

    const adminRead = await app.inject({ method: 'GET', url: `/v1/files/${fileId}`, headers: bearer(admin.accessToken) });
    expect(adminRead.statusCode).toBe(200);
    expect(adminRead.rawPayload.equals(pdfBytes)).toBe(true);
  });

  it('rejects files over the configured limit', async () => {
    const app = await startServer({ MAX_FILE_BYTES: '8' });
    const admin = await bootstrap(app);
    const oversizedPart = multipartFile('large.pdf', 'application/pdf', Buffer.from('%PDF-1234', 'ascii'));
    const response = await app.inject({
      method: 'POST', url: '/v1/files', headers: { ...bearer(admin.accessToken), ...oversizedPart.headers }, payload: oversizedPart.payload,
    });

    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('file_too_large');
  });

  it('automatically trims oversized chat history instead of rejecting the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'trimmed-response', output_text: '继续回答' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const app = await startServer({ APP_ACCESS_TOKEN: 'legacy-friend-token', MAX_HISTORY_CHARS: '100', MAX_HISTORY_MESSAGES: '4' });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { authorization: 'Bearer legacy-friend-token' },
      payload: {
        requestId: '11111111-1111-4111-8111-111111111111',
        conversationId: '22222222-2222-4222-8222-222222222222',
        deviceId: 'history-test-device',
        messages: [
          { role: 'user', content: '很早的问题'.repeat(20), attachments: [] },
          { role: 'assistant', content: '很早的回答'.repeat(20), attachments: [] },
          { role: 'user', content: '最新的问题', attachments: [] },
        ],
        options: {
          model: 'gpt-5.6-sol', reasoningEffort: 'medium', verbosity: 'medium', instructions: '',
          maxOutputTokens: 4096, webSearch: false, codeInterpreter: false,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.input.map((item: { role: string; content: unknown }) => item.role)).toEqual(['user']);
    expect(body.input[0].content).toBe('最新的问题');
  });

  it('rejects unauthorized REST generation before contacting the provider', async () => {
    const app = await startServer({ APP_ACCESS_TOKEN: 'legacy-friend-token' });
    const response = await app.inject({ method: 'POST', url: '/v1/chat', headers: { authorization: 'Bearer wrong' }, payload: {} });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('unauthorized');
  });
});


describe('built-in tool discovery', () => {
  it('requires login and exposes capability names, never search/provider keys', async () => {
    const app = await startServer({ BRAVE_SEARCH_API_KEY: 'private-search-key' });
    expect((await app.inject({ method: 'GET', url: '/v1/tools' })).statusCode).toBe(401);
    await bootstrap(app);
    const user = await register(app, 91);
    const response = await app.inject({ method: 'GET', url: '/v1/tools', headers: bearer(user.accessToken) });
    expect(response.statusCode).toBe(200);
    expect(response.json().tools).toHaveLength(8);
    expect(response.json().tools.find((tool: any) => tool.name === 'get_weather').enabled).toBe(true);
    expect(response.body).not.toContain('private-search-key');
    expect(response.body).not.toContain('environment-provider-key');
  });
});

describe('companion profiles', () => {
  it('requires a real account and keeps profiles isolated between users', async () => {
    const app = await startServer({ APP_ACCESS_TOKEN: 'legacy-friend-token' });
    await bootstrap(app);

    const anonymous = await app.inject({ method: 'GET', url: '/v1/companions' });
    expect(anonymous.statusCode).toBe(401);

    const legacy = await app.inject({ method: 'GET', url: '/v1/companions', headers: bearer('legacy-friend-token') });
    expect(legacy.statusCode).toBe(403);
    expect(legacy.json().error.code).toBe('account_required');

    const first = await register(app, 201);
    const second = await register(app, 202);
    const firstList = await app.inject({ method: 'GET', url: '/v1/companions', headers: bearer(first.accessToken) });
    expect(firstList.statusCode).toBe(200);
    expect(firstList.json().companions).toHaveLength(2);
    expect(firstList.json().companions).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Lumi', templateId: 'cyber-companion-v1' }), expect.objectContaining({ name: '沈知意', templateId: 'shen-zhiyi-v1' })]));

    const created = await app.inject({
      method: 'POST',
      url: '/v1/companions',
      headers: bearer(first.accessToken),
      payload: {
        name: '小光',
        personality: ['温柔', '细腻'],
        speakingStyle: ['自然简洁'],
        relationshipStage: 'familiar',
        memoryEnabled: true,
        memories: ['用户喜欢雨天散步。'],
      },
    });
    expect(created.statusCode).toBe(201);
    const companion = created.json().companion;
    expect(companion).toMatchObject({ name: '小光', relationshipStage: 'familiar', memoryEnabled: true });

    const crossAccount = await app.inject({ method: 'GET', url: `/v1/companions/${companion.id}`, headers: bearer(second.accessToken) });
    expect(crossAccount.statusCode).toBe(404);
    expect(crossAccount.json().error.code).toBe('companion_not_found');

    const patched = await app.inject({
      method: 'PATCH',
      url: `/v1/companions/${companion.id}`,
      headers: bearer(first.accessToken),
      payload: { speakingStyle: ['短句', '只问一个问题'] },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().companion).toMatchObject({
      name: '小光',
      personality: ['温柔', '细腻'],
      speakingStyle: ['短句', '只问一个问题'],
      memoryEnabled: true,
      memories: ['用户喜欢雨天散步。'],
    });
  });

  it('resolves companionId from the authenticated account before calling the model provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'companion-response', output_text: '我在，慢慢说。' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const app = await startServer();
    const admin = await bootstrap(app);
    await app.inject({ method: 'PUT', url: '/v1/admin/companion-provider/chat', headers: bearer(admin.accessToken), payload: { apiBaseUrl: 'https://companion.example/v1', apiKey: 'companion-test-key', apiMode: 'responses', authMode: 'bearer', defaultModel: 'gpt-5.6-sol', allowedModels: ['gpt-5.6-sol'] } });
    const owner = await register(app, 203);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/companions',
      headers: bearer(owner.accessToken),
      payload: { name: 'Lumi 测试', memoryEnabled: true, memories: ['用户喜欢夜晚散步。'] },
    });
    const companionId = created.json().companion.id as string;

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: bearer(owner.accessToken),
      payload: {
        requestId: '33333333-3333-4333-8333-333333333333',
        conversationId: '44444444-4444-4444-8444-444444444444',
        deviceId: 'companion-test-device',
        companionId,
        messages: [{ role: 'user', content: '今天有点累。', attachments: [] }],
        options: {
          model: 'gpt-5.6-sol',
          reasoningEffort: 'medium',
          verbosity: 'medium',
          instructions: '',
          maxOutputTokens: 4096,
          webSearch: false,
          codeInterpreter: false,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.instructions).toContain('Lumi 测试');
    expect(body.instructions).toContain('用户喜欢夜晚散步');
    expect(body.instructions).toContain('不得使用内疚、威胁、嫉妒、占有');
    expect(JSON.stringify(body)).not.toContain(companionId);
  });
});


describe('companion prompt profile versions', () => {
  it('round trips full prompts with v3 while keeping v1 and v2 response shapes stable', async () => {
    const app = await startServer();
    await bootstrap(app);
    const owner = await register(app, 390);
    const auth = bearer(owner.accessToken);
    const headers = { ...auth, 'x-nova-companion-profile-version': '3' };
    const personaPrompt = '你是阿川。\n【性格】\n35岁烘焙师。\n【聊天方式】\n简短、直接。';
    const created = await app.inject({ method: 'POST', url: '/v1/companions', headers, payload: { name: '阿川', personaPrompt } });
    expect(created.statusCode).toBe(201);
    expect(created.json().companion.personaPrompt).toBe(personaPrompt);
    const id = created.json().companion.id;
    const patched = await app.inject({ method: 'PATCH', url: `/v1/companions/${id}`, headers, payload: { userName: '小李' } });
    expect(patched.json().companion.personaPrompt).toBe(personaPrompt);
    const legacy = await app.inject({ method: 'GET', url: `/v1/companions/${id}`, headers: auth });
    expect(legacy.json().companion).not.toHaveProperty('personaPrompt');
    expect(legacy.json().companion).not.toHaveProperty('appearance');
    const v2 = await app.inject({ method: 'GET', url: `/v1/companions/${id}`, headers: { ...auth, 'x-nova-companion-profile-version': '2' } });
    expect(v2.json().companion).not.toHaveProperty('personaPrompt');
    expect(v2.json().companion).toHaveProperty('appearance');
    const tooLong = await app.inject({ method: 'POST', url: '/v1/companions', headers, payload: { name: '阿川', personaPrompt: 'x'.repeat(12001) } });
    expect(tooLong.statusCode).toBe(400);
    const emptyName = await app.inject({ method: 'POST', url: '/v1/companions', headers, payload: { name: '', personaPrompt } });
    expect(emptyName.statusCode).toBe(400);
  });
});


describe('consecutive companion chat messages', () => {
  it('accepts more than two outstanding sends and includes newly completed replies', async () => {
    const app = await startServer({ MAX_CONCURRENT_PER_DEVICE: '1' }); await bootstrap(app);
    const owner = await register(app, 503);
    const profile = await app.inject({ method: 'POST', url: '/v1/companions', headers: bearer(owner.accessToken), payload: { name: '连发测试' } });
    const companionId = profile.json().companion.id as string; const conversationId = randomUUID();
    let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
    const calls: string[][] = [];
    vi.spyOn(ModelProvider.prototype, 'generate').mockImplementation(async payload => {
      calls.push(payload.messages.map(message => message.content));
      if (calls.length === 1) await waiting;
      return { text: '收到' + payload.messages.filter(message => message.role === 'user').at(-1)?.content, model: 'test-chat' };
    });
    const contents = ['第一条', '第二条', '第三条'];
    const pending = contents.map((_, index) => app.inject({ method: 'POST', url: '/v1/chat', headers: bearer(owner.accessToken), payload: {
      requestId: randomUUID(), conversationId, companionId, deviceId: 'continuous-test-device',
      messages: contents.slice(0, index + 1).map(content => ({ role: 'user', content })), options: {},
    } }));
    try {
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      release(); const responses = await Promise.all(pending);
      expect(responses.map(response => response.statusCode)).toEqual([200, 200, 200]);
      expect(calls).toEqual([['第一条'], ['第一条', '收到第一条', '第二条'], ['第一条', '收到第一条', '第二条', '收到第二条', '第三条']]);
    } finally { release(); await Promise.all(pending); }
  });
});

describe('asynchronous companion photos', () => {
  it('finishes the photo turn, accepts more chat and delivers the photo only to its owner', async () => {
    const app = await startServer(); await bootstrap(app);
    const owner = await register(app, 501); const other = await register(app, 502);
    const profile = await app.inject({ method: 'POST', url: '/v1/companions', headers: bearer(owner.accessToken), payload: { name: '照片测试' } });
    const companionId = profile.json().companion.id as string;
    const conversationId = 'a4444444-4444-4444-8444-444444444444';
    let resolvePhoto!: (result: GenerationResult) => void;
    const photoResult = new Promise<GenerationResult>(resolve => { resolvePhoto = resolve; });
    vi.spyOn(ModelProvider.prototype, 'generate').mockImplementation(async payload => {
      if (payload.messages.at(-1)?.content.includes('封面')) return photoResult;
      return { text: '好 慢慢吃', model: 'test-text' };
    });
    const sendTurn = (requestId: string, messages: { role: 'user' | 'assistant'; content: string }[]) => app.inject({ method: 'POST', url: '/v1/chat', headers: bearer(owner.accessToken), payload: { requestId, conversationId, companionId, deviceId: 'photo-test-device', messages, options: {} } });
    try {
      const initial = await sendTurn('a3333333-3333-4333-8333-333333333331', [{ role: 'user', content: '把书的封面发给我看看' }]);
      expect(initial.statusCode).toBe(200); expect(initial.json().text).toBe(''); expect(initial.json().attachments ?? []).toEqual([]);
      const next = await sendTurn('b3333333-3333-4333-8333-333333333333', [{ role: 'user', content: '把书的封面发给我看看' }, { role: 'user', content: '我去吃饭了' }]);
      expect(next.statusCode).toBe(200); expect(next.json().text).toBe('好 慢慢吃');
      const eventUrl = '/v1/companions/' + companionId + '/events?conversationId=' + conversationId;
      expect((await app.inject({ method: 'GET', url: eventUrl, headers: bearer(owner.accessToken) })).json().events).toEqual([]);
      resolvePhoto({ text: '给你', model: 'test-photo', attachments: [{ id: 'a5555555-5555-4555-8555-555555555555', name: '照片.png', mimeType: 'image/png', kind: 'image', size: 100 }] });
      await vi.waitFor(async () => {
        const events = (await app.inject({ method: 'GET', url: eventUrl, headers: bearer(owner.accessToken) })).json().events;
        expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ kind: 'photo', content: '给你', attachments: [expect.objectContaining({ kind: 'image' })] });
      });
      const denied = await app.inject({ method: 'GET', url: eventUrl, headers: bearer(other.accessToken) });
      expect(denied.statusCode).toBe(404);
    } finally { resolvePhoto({ text: '', model: 'test-photo' }); }
  });
});
