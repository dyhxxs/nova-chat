import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig, type AppConfig } from '../src/config.js';
import { buildServer } from '../src/server.js';

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
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('gateway server', () => {
  it('reports health without exposing secrets', async () => {
    const app = await startServer({ APP_ACCESS_TOKEN: 'legacy-friend-token' });
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, service: 'nova-chat-gateway', apiMode: 'responses', defaultModel: 'gpt-5.6-sol' });
    expect(response.body).not.toContain('environment-provider-key');
    expect(response.body).not.toContain('legacy-friend-token');
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
      apiBaseUrl: 'https://provider.example/v1',
      apiKeySet: true,
      apiKeyPreview: '••••9876',
      defaultModel: 'gpt-5.6-luna',
      allowedModels: ['gpt-5.6-luna'],
    });
    expect(updated.body).not.toContain(apiKey);
    expect(updated.json().provider).not.toHaveProperty('apiKey');

    const fetched = await app.inject({ method: 'GET', url: '/v1/admin/provider', headers: bearer(admin.accessToken) });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.body).not.toContain(apiKey);
    expect(fetched.json().provider).not.toHaveProperty('apiKey');

    const models = await app.inject({ method: 'GET', url: '/v1/models', headers: bearer(user.accessToken) });
    expect(models.json()).toMatchObject({ models: ['gpt-5.6-luna'], defaultModel: 'gpt-5.6-luna', apiMode: 'responses' });
    expect(models.body).not.toContain(apiKey);
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
