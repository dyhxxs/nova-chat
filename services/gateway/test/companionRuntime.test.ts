import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateRequestSchema, type GenerateRequest } from '@nova-chat/protocol';
import { AppDatabase } from '../src/database.js';
import { loadConfig } from '../src/config.js';
import { CompanionRuntime } from '../src/companionRuntime.js';
import type { GenerationResult, ModelProvider } from '../src/provider.js';

let directory: string;
let db: AppDatabase;
let runtime: CompanionRuntime | undefined;
let owner: string;
let companionId: string;
let conversationId: string;
const generate = vi.fn();
const logger = { warn: vi.fn() };
const photo = { id: '55555555-5555-4555-8555-555555555555', name: '照片.png', mimeType: 'image/png', kind: 'image' as const, size: 100 };
const request = (content: string): GenerateRequest => generateRequestSchema.parse({ requestId: randomUUID(), conversationId, companionId, deviceId: 'runtime-test', messages: [{ role: 'user', content }], options: {} });
const remember = (value: GenerateRequest) => {
  db.saveCompanionThread(owner, companionId, conversationId, value.messages);
  db.archiveCompanionTurn(owner, companionId, conversationId, value.requestId, value.messages[0]!.content, '');
};
const start = () => { runtime = new CompanionRuntime(db, { generate } as unknown as ModelProvider, logger); return runtime; };
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T04:00:00Z')); generate.mockReset(); logger.warn.mockReset();
  directory = await mkdtemp(path.join(tmpdir(), 'nova-companion-runtime-'));
  db = new AppDatabase(loadConfig({ NODE_ENV: 'test', DATA_DIR: directory, SERVER_MASTER_KEY: 'runtime-test-master-key-longer-than-thirty-two-characters' }));
  owner = db.createUser({ email: 'runtime@qa.local', password: 'temporary-test-password', displayName: 'QA' }).id;
  db.setCompanionProviderSettings('chat', { apiBaseUrl: 'https://companion.example/v1', apiKey: 'test-key', apiMode: 'chat-completions', authMode: 'bearer', defaultModel: 'test-model', allowedModels: ['test-model'] }, owner);
  companionId = db.createCompanion(owner, { relationshipStage: 'close', proactiveMessagesEnabled: true }).id;
  conversationId = randomUUID();
});
afterEach(async () => {
  await runtime?.close(); runtime = undefined; db.close();
  // Only remove the exact test directory created above.
  if (!directory.startsWith(path.join(tmpdir(), 'nova-companion-runtime-'))) throw new Error('Unexpected test directory');
  await rm(directory, { recursive: true, force: true }); vi.useRealTimers();
});

describe('durable companion delivery', () => {
  it('appends a late photo to the latest chat, without overwriting intervening messages', async () => {
    const value = request('发张照片'); remember(value);
    let complete!: (result: GenerationResult) => void;
    generate.mockImplementationOnce(() => new Promise<GenerationResult>(resolve => { complete = resolve; }));
    db.queueCompanionDelivery(owner, value, 'photo', Date.now()); start().deliverDue();
    db.saveCompanionThread(owner, companionId, conversationId, [...value.messages, { role: 'user', content: '我先去吃饭了', attachments: [] }]);
    complete({ text: '给你', attachments: [photo], model: 'test' }); await vi.advanceTimersByTimeAsync(0);
    const events = db.listCompanionEvents(owner, companionId, conversationId);
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ kind: 'photo', attachments: [photo] });
    expect(db.getCompanionThread(owner, companionId, conversationId)?.messages.map(message => message.content)).toEqual(['发张照片', '我先去吃饭了', '给你']);
    runtime!.deliverDue(); expect(generate).toHaveBeenCalledTimes(1);
  });
  it('creates only a failure message when a photo fails', async () => {
    const value = request('发张照片'); remember(value); generate.mockRejectedValueOnce(new Error('upstream failure'));
    db.queueCompanionDelivery(owner, value, 'photo', Date.now()); start().deliverDue(); await vi.advanceTimersByTimeAsync(0);
    expect(db.listCompanionEvents(owner, companionId, conversationId)).toEqual([expect.objectContaining({ kind: 'message', attachments: [], content: expect.stringContaining('没发出来') })]);
  });
  it('waits until a deferred text is due, then delivers each segment once', async () => {
    const value = request('嗯'); remember(value); generate.mockResolvedValue({ text: '刚才走神了\n现在在', segments: ['刚才走神了', '现在在'], model: 'test' });
    db.queueCompanionDelivery(owner, value, 'reply', Date.now() + 30_000); start().deliverDue(); expect(generate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(db.listCompanionEvents(owner, companionId, conversationId).map(event => event.content)).toEqual(['刚才走神了', '现在在']);
    await vi.advanceTimersByTimeAsync(10_000); expect(generate).toHaveBeenCalledTimes(1);
  });
  it('drops a stale delayed reply when the user starts another turn, even with identical words', async () => {
    const value = request('嗯'); remember(value); db.queueCompanionDelivery(owner, value, 'reply', Date.now() + 30_000);
    remember(request('嗯')); start(); await vi.advanceTimersByTimeAsync(30_000);
    expect(generate).not.toHaveBeenCalled(); expect(db.listCompanionEvents(owner, companionId, conversationId)).toEqual([]);
  });
  it('recovers interrupted photos without submitting a second image request', () => {
    const value = request('发张照片'); remember(value); db.queueCompanionDelivery(owner, value, 'photo', Date.now());
    expect(db.claimCompanionDeliveries()).toHaveLength(1); start();
    expect(generate).not.toHaveBeenCalled(); expect(db.claimCompanionDeliveries()).toEqual([]);
    expect(db.listCompanionEvents(owner, companionId, conversationId)[0]?.attachments).toEqual([]);
  });
});

describe('proactive contact', () => {
  it('contacts a familiar user after a half hour, then waits for a reply even across a restart', async () => {
    const value = request('今天把那本书读完了'); remember(value); db.recordCompanionInteraction(owner, companionId, value.messages[0]!.content, '嗯');
    generate.mockResolvedValue({ text: '刚想起你说的那个结尾', model: 'test' });
    const instance = start();
    vi.setSystemTime(Date.now() + 29 * 60_000); instance.startProactiveSweep(); await vi.advanceTimersByTimeAsync(0);
    expect(generate).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 2 * 60_000); instance.startProactiveSweep(); await vi.advanceTimersByTimeAsync(0);
    expect(generate).toHaveBeenCalledTimes(1);
    await instance.close(); runtime = undefined;
    vi.setSystemTime(Date.now() + 24 * 60 * 60_000); start().startProactiveSweep(); await vi.advanceTimersByTimeAsync(0);
    expect(generate).toHaveBeenCalledTimes(1);
    const returned = request('我回来啦'); remember(returned); db.recordCompanionInteraction(owner, companionId, '我回来啦', '回来啦');
    vi.setSystemTime(Date.now() + 31 * 60_000); runtime!.startProactiveSweep(); await vi.advanceTimersByTimeAsync(0);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('keeps the night quiet and resumes after 09:00 China time', async () => {
    remember(request('晚点聊')); db.recordCompanionInteraction(owner, companionId, '晚点聊', '好');
    vi.setSystemTime(new Date('2026-10-14T15:00:00Z')); generate.mockResolvedValue({ text: '想起上次聊的书了', model: 'test' });
    const instance = start(); instance.startProactiveSweep(); await vi.advanceTimersByTimeAsync(0);
    expect(generate).not.toHaveBeenCalled();
    vi.setSystemTime(new Date('2026-10-15T00:59:00Z')); instance.startProactiveSweep(); await vi.advanceTimersByTimeAsync(0);
    expect(generate).not.toHaveBeenCalled();
    vi.setSystemTime(new Date('2026-10-15T01:00:00Z')); instance.startProactiveSweep(); await vi.advanceTimersByTimeAsync(0);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('retries an upstream failure after fifteen minutes without publishing an error as a chat', async () => {
    remember(request('晚点聊')); db.recordCompanionInteraction(owner, companionId, '晚点聊', '好');
    vi.setSystemTime(Date.now() + 61 * 60_000);
    generate.mockRejectedValueOnce(new Error('temporary upstream failure')).mockResolvedValueOnce({ text: '想起你说的那本书了', model: 'test' });
    const instance = start(); instance.startProactiveSweep(); await vi.advanceTimersByTimeAsync(0);
    expect(db.listCompanionEvents(owner, companionId, conversationId)).toEqual([]);
    vi.setSystemTime(Date.now() + 14 * 60_000); instance.startProactiveSweep(); await vi.advanceTimersByTimeAsync(0);
    expect(generate).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 60_001); instance.startProactiveSweep(); await vi.advanceTimersByTimeAsync(0);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(db.listCompanionEvents(owner, companionId, conversationId)).toHaveLength(1);
  });

  it('can reach out after ordinary friendly exchanges without requiring declarations of affection', async () => {
    for (const text of ['今天在看书', '这本书结局挺意外的', '晚点接着聊']) {
      const value = request(text); remember(value); db.recordCompanionInteraction(owner, companionId, text, '嗯');
    }
    vi.setSystemTime(Date.now() + 5 * 60 * 60_000);
    generate.mockResolvedValue({ text: '刚又翻了两页 那个结尾还挺有意思', model: 'test' });
    start().startProactiveSweep(); await vi.advanceTimersByTimeAsync(0);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(db.listCompanionEvents(owner, companionId, conversationId)[0]?.content).toContain('结尾');
  });

  it('does not initiate contact when the user has asked for space', async () => {
    remember(request('先别找我 不用回')); db.recordCompanionInteraction(owner, companionId, '先别找我 不用回', '');
    vi.setSystemTime(Date.now() + 5 * 60 * 60_000); start().startProactiveSweep(); await vi.advanceTimersByTimeAsync(0);
    expect(generate).not.toHaveBeenCalled();
  });
  it('sends a proactively offered photo as a later attachment and keeps the cooldown', async () => {
    const value = request('谢谢 喜欢你'); remember(value); db.recordCompanionInteraction(owner, companionId, '谢谢 喜欢你', '嗯');
    vi.setSystemTime(Date.now() + 5 * 60 * 60_000);
    generate.mockResolvedValueOnce({ text: '这张想给你看看', model: 'test', companionPhotoRequested: true })
      .mockResolvedValueOnce({ text: '给你', model: 'test-photo', attachments: [photo] });
    const instance = start(); instance.startProactiveSweep(); await vi.advanceTimersByTimeAsync(0);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0]?.[5]).toBe('proactive');
    expect(generate.mock.calls[1]?.[0].companionAction).toBe('photo');
    expect(db.listCompanionEvents(owner, companionId, conversationId)).toEqual([
      expect.objectContaining({ kind: 'message', content: '这张想给你看看' }),
      expect.objectContaining({ kind: 'photo', attachments: [photo] }),
    ]);
    instance.startProactiveSweep(); await vi.advanceTimersByTimeAsync(0); expect(generate).toHaveBeenCalledTimes(2);
  });
  it('contacts only the most recent thread with cooldown and actual recorded history', async () => {
    const value = request('谢谢 喜欢你'); remember(value); db.recordCompanionInteraction(owner, companionId, '谢谢 喜欢你', '嗯');
    vi.setSystemTime(Date.now() + 1_000); const newer = randomUUID();
    db.saveCompanionThread(owner, companionId, newer, [{ role: 'user', content: '明天要去考试', attachments: [] }]);
    vi.setSystemTime(Date.now() + 5 * 60 * 60_000); generate.mockResolvedValue({ text: '刚想起你明天要考试', model: 'test' });
    const instance = start(); instance.startProactiveSweep(); instance.startProactiveSweep(); await vi.advanceTimersByTimeAsync(0);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]?.[0].messages).toEqual([{ role: 'user', content: '明天要去考试', attachments: [] }]);
    expect(generate.mock.calls[0]?.[5]).toBe('proactive');
    expect(db.listCompanionEvents(owner, companionId, newer)).toHaveLength(1);
    expect(db.listCompanionEvents(owner, companionId, conversationId)).toEqual([]);
    instance.startProactiveSweep(); await vi.advanceTimersByTimeAsync(0); expect(generate).toHaveBeenCalledTimes(1);
  });
  it('discards a proactive draft if the user returns while it is being generated', async () => {
    const value = request('谢谢 喜欢你'); remember(value); db.recordCompanionInteraction(owner, companionId, '谢谢 喜欢你', '嗯');
    vi.setSystemTime(Date.now() + 5 * 60 * 60_000);
    let complete!: (value: GenerationResult) => void; generate.mockImplementationOnce(() => new Promise<GenerationResult>(resolve => { complete = resolve; }));
    start().startProactiveSweep(); remember(request('我回来了')); complete({ text: '你在吗', model: 'test' }); await vi.advanceTimersByTimeAsync(0);
    expect(db.listCompanionEvents(owner, companionId, conversationId)).toEqual([]);
  });
});

it('paginates events created at the same instant without omissions and scopes them by account', () => {
  for (let index = 0; index < 65; index++) db.createCompanionEvent({ userId: owner, companionId, conversationId, kind: 'message', content: String(index), attachments: [] });
  const first = db.listCompanionEvents(owner, companionId, conversationId);
  const second = db.listCompanionEvents(owner, companionId, conversationId, first.at(-1)!.createdAt);
  expect(first).toHaveLength(50); expect(second).toHaveLength(15);
  expect(new Set([...first, ...second].map(event => event.eventId)).size).toBe(65);
  expect(db.listCompanionEvents('another-account', companionId, conversationId)).toEqual([]);
});

it('retrieves relevant older turns only from the same conversation and preserves custom persona text', () => {
  const original = db.getCompanion(owner, companionId)!.personaPrompt;
  db.archiveCompanionTurn(owner, companionId, conversationId, randomUUID(), '我花生过敏，不能吃花生', '记住了');
  db.archiveCompanionTurn(owner, companionId, randomUUID(), randomUUID(), '我喜欢吃花生', '嗯');
  expect(db.recallCompanionTurns(owner, companionId, conversationId, '花生能吃吗', [])).toEqual([expect.objectContaining({ userText: '我花生过敏，不能吃花生' })]);
  db.recordCompanionInteraction(owner, companionId, '谢谢 喜欢你', '嗯');
  expect(db.getCompanion(owner, companionId)?.personaPrompt).toBe(original);
  expect(db.recallCompanionTurns('someone-else', companionId, conversationId, '花生', [])).toEqual([]);
});
