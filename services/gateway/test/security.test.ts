import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { ModelProvider } from '../src/provider.js';

const apps: FastifyInstance[] = [];
const dirs: string[] = [];
const clients: WebSocket[] = [];
const bootstrapToken = 'test-security-bootstrap-token-long-enough';
const password = 'original secure password';
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
async function setup() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'nova-security-test-'));
  dirs.push(dataDir);
  const app = await buildServer(loadConfig({ NODE_ENV: 'test', DATA_DIR: dataDir, LOG_LEVEL: 'silent',
    SERVER_MASTER_KEY: 'security-test-only-master-key-longer-than-thirty-two-characters', ADMIN_BOOTSTRAP_TOKEN: bootstrapToken,
    OPENAI_API_KEY: 'test-only-never-used', REQUESTS_PER_MINUTE: '500',
  }));
  apps.push(app);
  const response = await app.inject({ method: 'POST', url: '/v1/auth/bootstrap', payload: {
    email: 'admin@example.com', password, displayName: 'Admin', deviceId: 'first-test-device', bootstrapToken,
  } });
  expect(response.statusCode).toBe(201);
  return { app, auth: response.json() as { accessToken: string; user: { id: string } } };
}
async function login(app: FastifyInstance) {
  const response = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'admin@example.com', password, deviceId: 'second-test-device' } });
  expect(response.statusCode).toBe(200);
  return response.json().accessToken as string;
}
async function register(app: FastifyInstance) {
  const response = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email: 'user@example.com', password, deviceId: 'other-user-device' } });
  expect(response.statusCode).toBe(201);
  return response.json() as { accessToken: string; user: { id: string } };
}
function frame(socket: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('message', listener); reject(new Error(`missing ${type} frame`)); }, 3_000);
    function listener(data: WebSocket.RawData) {
      const message = JSON.parse(data.toString());
      if (message.type !== type) return;
      clearTimeout(timer); socket.off('message', listener); resolve(message);
    }
    socket.on('message', listener);
  });
}
async function connect(app: FastifyInstance, token: string) {
  if (!app.server.listening) await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  const client = new WebSocket(`ws://127.0.0.1:${address.port}/v1/chat/stream`);
  clients.push(client);
  await once(client, 'open');
  const ready = frame(client, 'ready');
  client.send(JSON.stringify({ type: 'hello', accessToken: token, deviceId: 'test-socket-device' }));
  await ready;
  return client;
}
afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate();
  for (const app of apps.splice(0)) await app.close();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('account security API', () => {
  it('lists only owned active sessions with a current marker and no token material', async () => {
    const { app, auth } = await setup();
    await login(app);
    await register(app);
    const response = await app.inject({ method: 'GET', url: '/v1/auth/sessions', headers: bearer(auth.accessToken) });
    expect(response.statusCode).toBe(200);
    expect(response.json().sessions).toHaveLength(2);
    expect(response.json().sessions[0]).toMatchObject({ current: true, deviceId: 'first-test-device' });
    expect(response.body).not.toContain(auth.accessToken);
    expect(response.body).not.toContain('token_hash');
    expect(response.body).not.toContain('other-user-device');
    expect((await app.inject('/v1/auth/sessions')).statusCode).toBe(401);
  });

  it('prevents revoking another user session, even as an administrator', async () => {
    const { app, auth } = await setup();
    const other = await register(app);
    const sessions = await app.inject({ method: 'GET', url: '/v1/auth/sessions', headers: bearer(other.accessToken) });
    const id = sessions.json().sessions[0].id;
    expect((await app.inject({ method: 'DELETE', url: `/v1/auth/sessions/${id}`, headers: bearer(auth.accessToken) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(other.accessToken) })).statusCode).toBe(200);
  });

  it('revokes other sessions and closes their existing WebSockets while preserving this login', async () => {
    const { app, auth } = await setup();
    const second = await login(app);
    const socket = await connect(app, second);
    const closed = once(socket, 'close');
    const response = await app.inject({ method: 'POST', url: '/v1/auth/sessions/revoke-others', headers: bearer(auth.accessToken) });
    expect(response.json()).toEqual({ ok: true, revoked: 1 });
    expect((await closed)[0]).toBe(4401);
    expect((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(second) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(auth.accessToken) })).statusCode).toBe(200);
  });

  it('changes a password atomically and requires every device to log in again', async () => {
    const { app, auth } = await setup();
    const second = await login(app);
    const socket = await connect(app, auth.accessToken);
    const closed = once(socket, 'close');
    const response = await app.inject({ method: 'POST', url: '/v1/auth/password', headers: bearer(auth.accessToken), payload: { currentPassword: password, newPassword: 'replacement secure password' } });
    expect(response.statusCode).toBe(200);
    expect((await closed)[0]).toBe(4401);
    for (const token of [auth.accessToken, second]) expect((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(token) })).statusCode).toBe(401);
    const oldLogin = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'admin@example.com', password, deviceId: 'login-test-device' } });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'admin@example.com', password: 'replacement secure password', deviceId: 'login-test-device' } });
    expect(newLogin.statusCode).toBe(200);
  });

  it('validates current passwords, rejects equivalent replacements and rate-limits attempts per account', async () => {
    const { app, auth } = await setup();
    const attempt = (currentPassword: string, newPassword: string) => app.inject({ method: 'POST', url: '/v1/auth/password', headers: bearer(auth.accessToken), payload: { currentPassword, newPassword } });
    expect((await attempt(password, 'short')).statusCode).toBe(400);
    expect((await attempt(password, password)).json().error.code).toBe('password_unchanged');
    for (let index = 0; index < 4; index += 1) expect((await attempt('wrong password', 'replacement password')).json().error.code).toBe('invalid_current_password');
    const limited = await attempt('wrong password', 'replacement password');
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(auth.accessToken) })).statusCode).toBe(200);
  });

  it('revokes this specific session without affecting a second login', async () => {
    const { app, auth } = await setup();
    const second = await login(app);
    const response = await app.inject({ method: 'GET', url: '/v1/auth/sessions', headers: bearer(auth.accessToken) });
    const id = response.json().sessions[0].id;
    const deleted = await app.inject({ method: 'DELETE', url: `/v1/auth/sessions/${id}`, headers: bearer(auth.accessToken) });
    expect(deleted.json()).toEqual({ ok: true, currentSessionRevoked: true });
    expect((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(auth.accessToken) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(second) })).statusCode).toBe(200);
  });
});

describe('live WebSocket authorization', () => {
  it('invalidates an already-open connection immediately on logout', async () => {
    const { app, auth } = await setup();
    const socket = await connect(app, auth.accessToken);
    const closed = once(socket, 'close');
    await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: bearer(auth.accessToken) });
    expect((await closed)[0]).toBe(4401);
  });

  it('disconnects a disabled user and cancels their in-flight generation, not just future requests', async () => {
    let jobSignal: AbortSignal | undefined;
    vi.spyOn(ModelProvider.prototype, 'generate').mockImplementation(async (_payload, _principal, signal) => {
      jobSignal = signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    });
    const { app, auth } = await setup();
    const user = await register(app);
    const socket = await connect(app, user.accessToken);
    const started = frame(socket, 'started');
    socket.send(JSON.stringify({ type: 'start', payload: { requestId: randomUUID(), conversationId: randomUUID(), deviceId: 'test-socket-device', messages: [{ role: 'user', content: 'hello', attachments: [] }], options: {} } }));
    await started;
    expect(jobSignal?.aborted).toBe(false);
    const closed = once(socket, 'close');
    const disabled = await app.inject({ method: 'PATCH', url: `/v1/admin/users/${user.user.id}`, headers: bearer(auth.accessToken), payload: { disabled: true } });
    expect(disabled.statusCode).toBe(200);
    expect((await closed)[0]).toBe(4401);
    expect(jobSignal?.aborted).toBe(true);
  });
  it('rejects an expired session on its next frame even if the socket stayed open', async () => {
    const { app, auth } = await setup();
    const socket = await connect(app, auth.accessToken);
    const closed = once(socket, 'close');
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 24 * 60 * 60_000);
    socket.send(JSON.stringify({ type: 'ping' }));
    expect((await closed)[0]).toBe(4401);
  });

  it('does not let a demoted administrator cancel another account job on an old socket', async () => {
    let jobSignal: AbortSignal | undefined;
    vi.spyOn(ModelProvider.prototype, 'generate').mockImplementation(async (_payload, _principal, signal) => {
      jobSignal = signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    });
    const { app, auth } = await setup(); const user = await register(app);
    const changeRole = (role: string) => app.inject({ method: 'PATCH', url: '/v1/admin/users/' + user.user.id, headers: bearer(auth.accessToken), payload: { role } });
    expect((await changeRole('admin')).statusCode).toBe(200);
    const oldAdminSocket = await connect(app, user.accessToken);
    const ownerSocket = await connect(app, auth.accessToken);
    const requestId = randomUUID(); const conversationId = randomUUID();
    const started = frame(ownerSocket, 'started');
    ownerSocket.send(JSON.stringify({ type: 'start', payload: { requestId, conversationId, deviceId: 'test-socket-device', messages: [{ role: 'user', content: 'test', attachments: [] }], options: {} } }));
    await started;
    expect((await changeRole('user')).statusCode).toBe(200);
    const pong = frame(oldAdminSocket, 'pong');
    oldAdminSocket.send(JSON.stringify({ type: 'cancel', requestId, conversationId }));
    oldAdminSocket.send(JSON.stringify({ type: 'ping' }));
    await pong; expect(jobSignal?.aborted).toBe(false);
  });

  it('preserves durable jobs after ordinary background disconnect and allows REST recovery', async () => {
    let jobSignal: AbortSignal | undefined;
    vi.spyOn(ModelProvider.prototype, 'generate').mockImplementation(async (_payload, _principal, signal) => {
      jobSignal = signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    });
    const { app, auth } = await setup(); const socket = await connect(app, auth.accessToken);
    const requestId = randomUUID(); const conversationId = randomUUID();
    const started = frame(socket, 'started');
    socket.send(JSON.stringify({ type: 'start', payload: { requestId, conversationId, deviceId: 'test-socket-device', messages: [{ role: 'user', content: 'test', attachments: [] }], options: {} } }));
    await started; const closed = once(socket, 'close'); socket.close(1000, 'background'); await closed;
    expect(jobSignal?.aborted).toBe(false);
    const recovered = await app.inject({ method: 'GET', url: '/v1/chat/jobs/' + requestId + '?conversationId=' + conversationId, headers: bearer(auth.accessToken) });
    expect(recovered.statusCode).toBe(200); expect(recovered.json().status).toBe('running');
  });

});
