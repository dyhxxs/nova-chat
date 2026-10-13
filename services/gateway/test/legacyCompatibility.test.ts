import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMPANION_PROFILE_VERSION_HEADER, companionProfileSchema } from '@nova-chat/protocol';
import { loadConfig } from '../src/config.js';
import { AppDatabase } from '../src/database.js';
import { ModelProvider } from '../src/provider.js';
import { buildServer } from '../src/server.js';
const dirs: string[] = [];
const apps: FastifyInstance[] = [];
const legacyProfile = companionProfileSchema.omit({ appearance: true, avatarFileId: true }).strict();
async function setup() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'nova-legacy-')); dirs.push(dataDir);
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: dataDir, LOG_LEVEL: 'silent', OPENAI_API_KEY: 'synthetic-key', REQUESTS_PER_MINUTE: '500' });
  const app = await buildServer(config); apps.push(app);
  const auth = await app.inject({ method: 'POST', url: '/v1/auth/bootstrap', payload: { email: 'legacy@example.com', password: 'synthetic-password', displayName: 'Legacy', deviceId: 'legacy-client-device' } });
  expect(auth.statusCode).toBe(201);
  const headers = { authorization: `Bearer ${auth.json().accessToken}` };
  return { config, app, headers, token: auth.json().accessToken as string };
}
afterEach(async () => { vi.restoreAllMocks(); for (const app of apps.splice(0)) await app.close(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
describe('older installed clients remain compatible with gateway upgrades', () => {
  it('returns the original strict profile shape for legacy create, list, get and edit requests', async () => {
    const { app, headers } = await setup();
    const created = await app.inject({ method: 'POST', url: '/v1/companions', headers, payload: { name: 'Lumi' } });
    expect(created.statusCode).toBe(201);
    const profile = legacyProfile.parse(created.json().companion);
    for (const method of ['GET', 'PATCH'] as const) {
      const result = await app.inject({ method, url: '/v1/companions/' + profile.id, headers, ...(method === 'PATCH' ? { payload: { name: 'Old app edit' } } : {}) });
      expect(result.statusCode).toBe(200); expect(() => legacyProfile.parse(result.json().companion)).not.toThrow();
    }
    const list = await app.inject({ method: 'GET', url: '/v1/companions', headers });
    expect(list.statusCode).toBe(200);
    for (const value of list.json().companions) expect(() => legacyProfile.parse(value)).not.toThrow();
  });
  it('opts new clients into appearance fields and preserves them when an old app edits the name', async () => {
    const { app, headers } = await setup();
    const modern = { ...headers, [COMPANION_PROFILE_VERSION_HEADER]: '2' };
    const created = await app.inject({ method: 'POST', url: '/v1/companions', headers: modern, payload: { name: 'Lumi', appearance: '短发、棕色眼睛' } });
    const profile = companionProfileSchema.parse(created.json().companion);
    expect(profile.appearance).toBe('短发、棕色眼睛'); expect(profile.avatarFileId).toBeNull();
    const edit = await app.inject({ method: 'PATCH', url: '/v1/companions/' + profile.id, headers, payload: { name: 'From old app' } });
    expect(edit.statusCode).toBe(200); legacyProfile.parse(edit.json().companion);
    const get = await app.inject({ method: 'GET', url: '/v1/companions/' + profile.id, headers: modern });
    expect(get.json().companion).toMatchObject({ name: 'From old app', appearance: profile.appearance, avatarFileId: null });
    const list = await app.inject({ method: 'GET', url: '/v1/companions', headers: modern });
    expect(list.json().companions.find((p: { id: string }) => p.id === profile.id).appearance).toBe(profile.appearance);
  });
  it('accepts old REST payloads and old appVersion values on the existing WebSocket route', async () => {
    const { app, headers, token } = await setup();
    const generate = vi.spyOn(ModelProvider.prototype, 'generate').mockResolvedValue({ text: 'Legacy chat works', model: 'gpt-5.6-sol' });
    const payload = () => ({ requestId: randomUUID(), conversationId: randomUUID(), deviceId: 'legacy-client-device', messages: [{ role: 'user', content: 'Hello' }], options: { model: 'gpt-5.6-sol' } });
    const rest = await app.inject({ method: 'POST', url: '/v1/chat', headers, payload: payload() });
    expect(rest.statusCode).toBe(200); expect(rest.json().text).toBe('Legacy chat works');
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const ws = new WebSocket(address.replace('http:', 'ws:') + '/v1/chat/stream');
    const frames: Array<{ type: string }> = [];
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('legacy socket timeout')), 5000);
        ws.on('error', error => { clearTimeout(timer); reject(error); });
        ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', accessToken: token, deviceId: 'legacy-client-device', appVersion: '1.1.22' })));
        ws.on('message', raw => { const frame = JSON.parse(raw.toString()); frames.push(frame); if (frame.type === 'ready') ws.send(JSON.stringify({ type: 'start', payload: payload() })); if (frame.type === 'done') { clearTimeout(timer); resolve(); } if (frame.type === 'error') { clearTimeout(timer); reject(new Error(frame.code)); } });
      });
      expect(frames.map(f => f.type)).toEqual(expect.arrayContaining(['ready', 'started', 'done']));
      expect(generate).toHaveBeenCalledTimes(2);
    } finally { ws.terminate(); }
  });
  it('adds new tables to an old database without changing accounts, sessions, providers or companion data', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-old-db-')); dirs.push(dir);
    const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: dir });
    let db = new AppDatabase(config);
    const user = db.createUser({ email: 'existing@example.com', password: 'synthetic-password', displayName: 'Existing' });
    const session = db.createSession(user.id, 'existing-phone-device');
    const profile = db.createCompanion(user.id, { name: 'Existing Lumi' });
    db.updateProviderSettings({ apiBaseUrl: 'https://ordinary.example/v1', apiKey: 'synthetic-provider-key', defaultModel: 'existing-model', allowedModels: ['existing-model'], apiMode: 'responses', authMode: 'bearer' }, user.id);
    db.close();
    const old = new DatabaseSync(path.join(dir, 'nova-chat.sqlite'));
    old.exec('DROP TABLE companion_appearance; DROP TABLE companion_provider_settings; DROP TABLE generation_jobs;');
    const before = ['users', 'sessions', 'provider_settings', 'companion_profiles'].map(t => old.prepare('SELECT * FROM ' + t).all());
    old.close();
    db = new AppDatabase(config);
    try {
      expect(db.authenticate(session.token)?.id).toBe(user.id);
      expect(db.getProviderSettings()).toMatchObject({ defaultModel: 'existing-model', apiKey: 'synthetic-provider-key' });
      expect(db.getCompanion(user.id, profile.id)).toMatchObject({ name: 'Existing Lumi', appearance: '', avatarFileId: null });
    } finally { db.close(); }
    const upgraded = new DatabaseSync(path.join(dir, 'nova-chat.sqlite'));
    try {
      expect(['users', 'sessions', 'provider_settings', 'companion_profiles'].map(t => upgraded.prepare('SELECT * FROM ' + t).all())).toEqual(before);
      expect(upgraded.prepare('SELECT token_hash FROM sessions').get()?.token_hash).toBe(createHash('sha256').update(session.token).digest('hex'));
    } finally { upgraded.close(); }
  });
});
