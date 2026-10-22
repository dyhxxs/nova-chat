import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDatabase } from '../src/database.js';
import { loadConfig } from '../src/config.js';
import { CompanionPushRuntime } from '../src/companionPush.js';
let directory: string;
let db: AppDatabase;
let runtime: CompanionPushRuntime;
let owner: string;
let companionId: string;
let session: { token: string; expiresAt: number };
const token = 'ExpoPushToken[test-device-1]';
const logger = { warn: vi.fn() };
const fetchMock = vi.fn();
const event = () => db.createCompanionEvent({ userId: owner, companionId, conversationId: randomUUID(), kind: 'message', content: '刚想起你说的书', attachments: [] });
const register = (pushToken = token) => db.registerCompanionPushDevice(owner, db.authenticate(session.token)!.sessionId, pushToken, 'https://gateway.test');
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T08:00:00Z'));
  directory = await mkdtemp(path.join(tmpdir(), 'nova-companion-push-'));
  db = new AppDatabase(loadConfig({ NODE_ENV: 'test', DATA_DIR: directory, SERVER_MASTER_KEY: 'push-test-master-key-with-more-than-32-characters' }));
  owner = db.createUser({ email: 'push@qa.local', password: 'temporary-test-password', displayName: 'QA' }).id;
  companionId = db.createCompanion(owner, { name: 'Lumi' }).id;
  session = db.createSession(owner, 'test-device-1');
  runtime = new CompanionPushRuntime(db, logger); fetchMock.mockReset(); logger.warn.mockReset(); vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  await runtime.close(); db.close(); vi.unstubAllGlobals(); vi.useRealTimers();
  expect(path.dirname(path.resolve(directory))).toBe(path.resolve(tmpdir()));
  expect(path.basename(directory)).toMatch(/^nova-companion-push-/);
  await rm(directory, { recursive: true, force: true });
});
describe('companion system push delivery', () => {
  it('sends the companion name, preview and exact account/topic target once without provider credentials', async () => {
    register(); const value = event();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'ok', id: 'ticket-1' }] })));
    await runtime.deliverDue(); await runtime.deliverDue(); expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fetchMock.mock.calls[0]![1].body)[0];
    expect(payload).toMatchObject({ to: token, title: 'Lumi', body: '刚想起你说的书', data: { eventId: value.eventId, userId: owner, companionId, conversationId: value.conversationId, serverUrl: 'https://gateway.test' } });
    expect(payload).not.toHaveProperty('accessToken'); expect(db.dueCompanionPushes()).toEqual([]);
  });
  it('stops notifications after logout and when the same device changes accounts', async () => {
    register(); event(); db.revokeSession(session.token); await runtime.deliverDue(); expect(fetchMock).not.toHaveBeenCalled();
    session = db.createSession(owner, 'test-device-1'); register();
    const other = db.createUser({ email: 'other@qa.local', password: 'temporary-test-password', displayName: 'Other' }).id;
    const otherSession = db.createSession(other, 'same-phone');
    db.registerCompanionPushDevice(other, db.authenticate(otherSession.token)!.sessionId, token, 'https://gateway.test');
    expect(db.listCompanionPushDevices(owner)).toEqual([]); expect(db.listCompanionPushDevices(other)).toEqual([token]);
  });
  it('retries failures durably while preserving the original chat event', async () => {
    register(); const value = event(); fetchMock.mockRejectedValue(new Error('offline')); await runtime.deliverDue();
    expect(db.dueCompanionPushes()).toEqual([]);
    expect(db.listCompanionEvents(owner, companionId, value.conversationId)).toHaveLength(1);
    vi.setSystemTime(Date.now() + 60_000);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'ok' }] }))); await runtime.deliverDue();
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(db.dueCompanionPushes()).toEqual([]);
  });
  it('removes expired device tokens instead of repeatedly sending failed notifications', async () => {
    register(); event(); fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] })));
    await runtime.deliverDue(); expect(db.listCompanionPushDevices(owner)).toEqual([]); expect(db.dueCompanionPushes()).toEqual([]);
  });
  it('retries only the failing device, without duplicating the accepted notification on another phone', async () => {
    register(); const secondSession = db.createSession(owner, 'phone-2');
    db.registerCompanionPushDevice(owner, db.authenticate(secondSession.token)!.sessionId, 'ExpoPushToken[phone-2]', 'https://gateway.test'); event();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ status: 'ok' }, { status: 'error', details: { error: 'MessageRateExceeded' } }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ status: 'ok' }] })));
    await runtime.deliverDue(); vi.setSystemTime(Date.now() + 60_000); await runtime.deliverDue();
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toHaveLength(1);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)[0].to).toBe('ExpoPushToken[phone-2]');
  });
});
