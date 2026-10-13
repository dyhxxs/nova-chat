import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => vi.stubEnv('EXPO_PUBLIC_GATEWAY_URL', ''));
afterAll(() => vi.unstubAllEnvs());
const storage = vi.hoisted(() => new Map<string, string>());
const secure = vi.hoisted(() => ({ token: '' }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
  removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
} }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => key === 'nova-chat-session-token' ? secure.token : null),
  setItemAsync: vi.fn(async (_key: string, value: string) => { secure.token = value; }),
  deleteItemAsync: vi.fn(async (key: string) => { if (key === 'nova-chat-session-token') secure.token = ''; }),
}));
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { useAppStore } from '../src/store/useAppStore';

const user = { id: 'same-user-id', email: 'a@example.com', displayName: 'A', role: 'user' as const, disabled: false, createdAt: 1, updatedAt: 1 };
const server = 'https://a.example.com';
const key = (url = server) => `@nova-chat/account/v1/${encodeURIComponent(user.id)}:${encodeURIComponent(url)}`;
const state = () => useAppStore.getState();

describe('durable account storage', () => {
  beforeEach(async () => {
    await state().clearSession();
    await state().flushPersistence();
    storage.clear();
    vi.clearAllMocks();
    await state().setSession('token-a', user, server);
  });

  it('retains more than 100 conversations across logout and restore', async () => {
    const initial = state().activeConversationId;
    const turn = state().beginTurn('the oldest conversation must survive');
    state().completeAssistant(turn.conversationId, turn.assistantMessageId);
    for (let index = 0; index < 105; index += 1) state().newConversation();
    await state().clearSession();
    await state().setSession('token-a', user, server);
    expect(state().conversations).toHaveLength(106);
    expect(state().conversations.find((item) => item.id === initial)?.messages[0]?.content).toContain('must survive');
  });

  it('flushes the pending streaming delta before logout', async () => {
    const turn = state().beginTurn('question');
    state().appendAssistantDelta(turn.conversationId, turn.assistantMessageId, 'latest unsaved delta');
    await state().clearSession();
    await state().setSession('token-a', user, server);
    expect(state().conversations[0]?.messages[1]?.content).toBe('latest unsaved delta');
  });

  it('does not copy conversations or credentials to a newly selected gateway', async () => {
    state().beginTurn('private to gateway A');
    state().updateSettings({ serverUrl: 'https://b.example.com' });
    expect(state().accessToken).toBe('');
    expect(state().dataOwnerId).toBeUndefined();
    expect(state().conversations.flatMap((item) => item.messages)).toEqual([]);
    await state().flushPersistence();
    expect(storage.has(key('https://b.example.com'))).toBe(false);
    expect(storage.get(key())).toContain('private to gateway A');
    await state().setSession('token-b', user, 'https://b.example.com');
    expect(state().conversations.flatMap((item) => item.messages)).toEqual([]);
  });

  it('keeps account instructions out of the global bootstrap record and other accounts', async () => {
    state().updateSettings({ instructions: 'private system instructions' });
    await state().flushPersistence();
    expect(storage.get('@nova-chat/settings/v1')).not.toContain('private system instructions');
    await state().setSession('token-b', { ...user, id: 'another-user' }, server);
    expect(state().settings.instructions).not.toContain('private system instructions');
    await state().setSession('token-a', user, server);
    expect(state().settings.instructions).toBe('private system instructions');
  });

  it('serializes secure token writes so a slow login cannot resurrect a logged-out session', async () => {
    await state().clearSession();
    let release!: () => void;
    vi.mocked(SecureStore.setItemAsync).mockImplementationOnce(async (_key, value) => {
      await new Promise<void>((resolve) => { release = resolve; });
      secure.token = value;
    });
    const login = state().setSession('slow-token', user, server);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const logout = state().clearSession();
    release();
    await Promise.all([login, logout]);
    expect(secure.token).toBe('');
    expect(state().accessToken).toBe('');
    expect(state().authStatus).toBe('unauthenticated');
  });

  it('reports failed local saves and can retry without discarding in-memory history', async () => {
    const before = state().conversations;
    vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('storage full'));
    await expect(state().flushPersistence()).rejects.toThrow('storage full');
    expect(state().persistenceError).toContain('本地保存失败');
    expect(state().conversations).toBe(before);
    await state().flushPersistence();
    expect(state().persistenceError).toBeUndefined();
  });

  it('does not trust a saved snapshot to redirect the authenticated server', async () => {
    await state().clearSession();
    const saved = JSON.parse(storage.get(key())!);
    saved.settings.serverUrl = 'https://unrelated.example.com';
    storage.set(key(), JSON.stringify(saved));
    await state().setSession('token-a', user, server);
    expect(state().settings.serverUrl).toBe(server);
    expect(state().dataOwnerServerUrl).toBe(server);
  });
  it('restores independent drafts across conversation and account switches', async () => {
    const first = state().activeConversationId;
    state().setConversationDraft(first, 'unsent private draft');
    const second = state().newConversation(); state().setConversationDraft(second, 'another draft');
    await state().clearSession();
    await state().setSession('token-b', { ...user, id: 'another-user' }, server);
    expect(state().conversations.some((item) => item.draft)).toBe(false);
    await state().setSession('token-a', user, server);
    expect(state().conversations.find((item) => item.id === first)?.draft).toBe('unsent private draft');
    expect(state().conversations.find((item) => item.id === second)?.draft).toBe('another draft');
  });
  it('clears only the exact sent draft, never a newer edit', () => {
    const id = state().activeConversationId;
    state().setConversationDraft(id, 'old'); state().setConversationDraft(id, 'new');
    state().clearConversationDraft(id, 'old'); expect(state().conversations[0]?.draft).toBe('new');
    state().clearConversationDraft(id, 'new'); expect(state().conversations[0]?.draft).toBe('');
    state().setConversationDraft(id, 'x'.repeat(10_001)); expect(state().conversations[0]?.draft).toHaveLength(10_000);
  });
  it('freezes assistant instructions and keeps presets account-scoped', async () => {
    const id = state().saveAssistantPreset({ name: 'My helper', instructions: 'private instructions', description: 'purpose', starter: 'draft starter' });
    const conversationId = state().newAssistantConversation(state().assistantPresets[0]!);
    state().saveAssistantPreset({ name: 'Changed', instructions: 'new instruction', description: '', starter: '' }, id);
    state().deleteAssistantPreset(id);
    const conversation = state().conversations.find((item) => item.id === conversationId)!;
    expect(conversation.assistant).toEqual({ name: 'My helper', instructions: 'private instructions' });
    expect(conversation.draft).toBe('draft starter'); expect(conversation.messages).toEqual([]);
    state().saveAssistantPreset({ name: 'Saved', instructions: 'private template', description: '', starter: '' });
    await state().setSession('token-b', { ...user, id: 'other-user' }, server);
    expect(state().assistantPresets).toEqual([]);
    await state().setSession('token-a', user, server);
    expect(state().assistantPresets[0]?.name).toBe('Saved');
    expect(state().conversations.find((item) => item.id === conversationId)?.assistant?.instructions).toBe('private instructions');
    expect(storage.get('@nova-chat/settings/v1')).not.toContain('private');
  });
  it('salvages valid messages and preserves the exact corrupt snapshot before overwriting', async () => {
    state().beginTurn('preserve good message'); await state().clearSession();
    const snapshot = JSON.parse(storage.get(key())!);
    snapshot.conversations[0].messages.push(null, { role: 'user', content: 123 });
    const raw = JSON.stringify(snapshot); storage.set(key(), raw);
    await state().setSession('token-a', user, server);
    expect(state().conversations[0]?.messages[0]?.content).toBe('preserve good message');
    expect(state().conversations[0]?.messages).toHaveLength(2);
    expect(state().recoveryNotice).toContain('恢复副本'); expect(state().storageReadBlocked).toBe(false);
    expect(await state().exportRecoverySnapshot()).toBe(raw);
    expect(storage.get(key() + '/recovery')).toBe(raw);
  });
  it('never overwrites a snapshot after a transient read error, and can retry on next login', async () => {
    state().beginTurn('original data'); await state().clearSession(); const raw = storage.get(key());
    let failAccountRead = true;
    vi.mocked(AsyncStorage.getItem).mockImplementation(async (requestedKey) => {
      if (requestedKey === key() && failAccountRead) { failAccountRead = false; throw new Error('temporary I/O failure'); }
      return storage.get(requestedKey) ?? null;
    });
    await state().setSession('token-a', user, server);
    expect(state().storageReadBlocked).toBe(true);
    state().setConversationDraft(state().activeConversationId, 'new temporary draft');
    await expect(state().flushPersistence()).rejects.toThrow('不会覆盖'); expect(storage.get(key())).toBe(raw);
    await state().clearSession(); await state().setSession('token-a', user, server);
    expect(state().storageReadBlocked).toBe(false); expect(state().conversations[0]?.messages[0]?.content).toBe('original data');
  });
  it('blocks overwrites of unknown versions and refuses to replace an older recovery copy', async () => {
    await state().clearSession(); const snapshot = JSON.parse(storage.get(key())!); snapshot.version = 999;
    const raw = JSON.stringify(snapshot); storage.set(key(), raw);
    await state().setSession('token-a', user, server);
    expect(state().storageReadBlocked).toBe(true); expect(storage.get(key())).toBe(raw);
    await state().clearSession(); storage.set(key(), 'broken-json'); storage.set(key() + '/recovery', 'older-recovery');
    await state().setSession('token-a', user, server);
    expect(state().storageReadBlocked).toBe(true); expect(storage.get(key())).toBe('broken-json'); expect(storage.get(key() + '/recovery')).toBe('older-recovery');
  });
  it('archives unparsable JSON before starting fresh', async () => {
    await state().clearSession(); storage.set(key(), '{incomplete');
    await state().setSession('token-a', user, server);
    expect(state().storageReadBlocked).toBe(false); expect(state().recoveryNotice).toContain('无法解析');
    expect(storage.get(key() + '/recovery')).toBe('{incomplete');
  });

  it('refuses recovery exports with a different declared owner', async () => {
    storage.set(key() + '/recovery', JSON.stringify({ userId: 'another-user', conversations: [] }));
    await expect(state().exportRecoverySnapshot()).rejects.toThrow('归属不匹配');
    await state().clearSession();
    const raw = JSON.stringify({ version: 7, userId: 'another-user', conversations: [] });
    storage.set(key(), raw);
    await state().setSession('token-a', user, server);
    expect(state().storageReadBlocked).toBe(true);
    await expect(state().exportRecoverySnapshot()).rejects.toThrow('归属不匹配');
    expect(storage.get(key())).toBe(raw);
  });
  it('does not return an old account recovery copy after switching accounts during a read', async () => {
    let release!: (value: string) => void;
    vi.mocked(AsyncStorage.getItem).mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve; }));
    const pending = state().exportRecoverySnapshot();
    const rejected = expect(pending).rejects.toThrow('账号已切换');
    await state().setSession('token-b', { ...user, id: 'other-user' }, server);
    release(JSON.stringify({ userId: user.id, conversations: [] }));
    await rejected;
  });

});

it('keeps original knowledge snapshots through logout/restore while resetting library opt-in', async () => {
  await state().setSession('token-library', user, server);
  const turn = state().beginTurn('报销日期');
  const knowledge = { query: '报销日期', sources: [{ label: '资料1', documentId: '11111111-1111-4111-8111-111111111111', title: '报销', chunk: 1, excerpt: '每月25日。', updatedAt: 1 }] };
  state().updateSettings({ knowledgeBase: true });
  state().completeAssistant(turn.conversationId, turn.assistantMessageId, { knowledge });
  await state().flushPersistence();
  await state().clearSession();
  await state().setSession('token-library-new', user, server);
  expect(state().conversations.flatMap(c => c.messages).find(m => m.id === turn.assistantMessageId)?.knowledge).toEqual(knowledge);
  expect(state().settings.knowledgeBase).toBe(false);
  state().prepareRegeneration(turn.conversationId, turn.assistantMessageId);
  expect(state().conversations.flatMap(c => c.messages).find(m => m.id === turn.assistantMessageId)?.knowledge).toBeUndefined();
});

// Drafts share the account snapshot, never the global bootstrap or standard chat backup.
describe('account-scoped knowledge drafts', () => {
  const scope = () => JSON.stringify([state().dataOwnerId ?? '', state().dataOwnerServerUrl ?? '', state().accessToken]);
  const input = { title: '报销草稿', text: '本地未提交内容' };
  beforeEach(async () => {
    await state().clearSession(); await state().flushPersistence(); storage.clear(); vi.clearAllMocks();
    await state().setSession('token-a', user, server);
  });
  it('restores unsaved document edits and original revision across logout/reload', async () => {
    expect(state().setKnowledgeDraft({ ...input, id: '11111111-1111-4111-8111-111111111111', updatedAt: 2 }, scope())).toBe(true);
    const draft = state().knowledgeDraft;
    expect(state().knowledgeDraftSavedRevision).not.toBe(draft?.revision);
    await state().flushPersistence(); expect(state().knowledgeDraftSavedRevision).toBe(draft?.revision);
    await state().clearSession(); expect(state().knowledgeDraft).toBeUndefined();
    await state().setSession('token-a', user, server); expect(state().knowledgeDraft).toEqual(draft);
    expect(state().knowledgeDraftSavedRevision).toBe(draft?.revision);
  });
  it('never puts private draft contents into another account, gateway or bootstrap', async () => {
    state().setKnowledgeDraft(input, scope()); await state().flushPersistence();
    expect(storage.get('@nova-chat/settings/v1')).not.toContain(input.text);
    await state().setSession('b', { ...user, id: 'other' }, server); expect(state().knowledgeDraft).toBeUndefined();
    await state().setSession('c', user, 'https://different.example'); expect(state().knowledgeDraft).toBeUndefined();
    await state().setSession('a', user, server); expect(state().knowledgeDraft?.text).toBe(input.text);
  });
  it('does not overwrite/clear a newer draft with a stale open, edit or save completion', () => {
    const originalScope = scope(); state().setKnowledgeDraft(input, originalScope);
    const first = state().knowledgeDraft!;
    expect(state().setKnowledgeDraft({ ...input, text: '新的编辑' }, originalScope, first.revision)).toBe(true);
    const latest = state().knowledgeDraft;
    expect(state().setKnowledgeDraft(input, originalScope)).toBe(false);
    expect(state().setKnowledgeDraft(input, originalScope, first.revision)).toBe(false);
    expect(state().clearKnowledgeDraft(originalScope, first.revision)).toBe(false);
    expect(state().knowledgeDraft).toBe(latest);
  });
  it('rejects operations from an earlier authenticated session or a logged-out page', async () => {
    const oldScope = scope(); state().setKnowledgeDraft(input, oldScope); const revision = state().knowledgeDraft!.revision;
    await state().clearSession(); expect(state().setKnowledgeDraft(input, scope())).toBe(false);
    await state().setSession('new-token', user, server);
    expect(state().clearKnowledgeDraft(oldScope, revision)).toBe(false);
    expect(state().setKnowledgeDraft(input, oldScope, revision)).toBe(false);
    expect(state().knowledgeDraft?.text).toBe(input.text);
  });
  it('keeps the draft on a failed local write and only reports saved after successful retry', async () => {
    state().setKnowledgeDraft(input, scope()); const revision = state().knowledgeDraft!.revision;
    vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
    await expect(state().flushPersistence()).rejects.toThrow('disk full');
    expect(state().knowledgeDraft?.revision).toBe(revision); expect(state().knowledgeDraftSavedRevision).not.toBe(revision);
    expect(state().persistenceError).toContain('本地保存失败');
    await state().flushPersistence(); expect(state().knowledgeDraftSavedRevision).toBe(revision); expect(state().persistenceError).toBeUndefined();
  });
  it('does not mark new keystrokes saved when an older snapshot finishes writing', async () => {
    state().setKnowledgeDraft(input, scope()); const first = state().knowledgeDraft!.revision;
    let release!: () => void;
    vi.mocked(AsyncStorage.setItem).mockImplementationOnce(async (key, value) => { await new Promise<void>(resolve => { release = resolve; }); storage.set(key, value); });
    const flushing = state().flushPersistence(); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    state().setKnowledgeDraft({ ...input, text: '更新的字' }, scope(), first);
    release(); await flushing;
    expect(state().knowledgeDraftSavedRevision).toBe(first); expect(state().knowledgeDraftSavedRevision).not.toBe(state().knowledgeDraft!.revision);
    await state().flushPersistence(); expect(state().knowledgeDraftSavedRevision).toBe(state().knowledgeDraft!.revision);
  });
  it('merges rapid input events before re-render without losing the final edit or another field', () => {
    state().setKnowledgeDraft(input, scope()); const rendered = state().knowledgeDraft!;
    expect(state().patchKnowledgeDraft({ title: '新标题' }, scope(), rendered.editId)).toBe(true);
    expect(state().patchKnowledgeDraft({ text: '一' }, scope(), rendered.editId)).toBe(true);
    expect(state().patchKnowledgeDraft({ text: '一二三' }, scope(), rendered.editId)).toBe(true);
    expect(state().knowledgeDraft).toMatchObject({ title: '新标题', text: '一二三', editId: rendered.editId });
    expect(state().knowledgeDraft!.revision).not.toBe(rendered.revision);
  });
  it('rejects a late native input event after discard/recreate even within the same account', () => {
    state().setKnowledgeDraft(input, scope()); const previous = state().knowledgeDraft!;
    state().clearKnowledgeDraft(scope(), previous.revision); state().setKnowledgeDraft({ title: '', text: '' }, scope());
    expect(state().knowledgeDraft!.editId).not.toBe(previous.editId);
    expect(state().patchKnowledgeDraft({ text: 'stale input' }, scope(), previous.editId)).toBe(false);
    expect(state().knowledgeDraft!.text).toBe('');
  });
  it('persists explicit discard and leaves the rest of the account untouched', async () => {
    const conversations = state().conversations; state().setKnowledgeDraft(input, scope());
    expect(state().clearKnowledgeDraft(scope(), state().knowledgeDraft!.revision)).toBe(true);
    await state().flushPersistence(); await state().clearSession(); await state().setSession('a', user, server);
    expect(state().knowledgeDraft).toBeUndefined(); expect(state().conversations).toEqual(conversations);
  });
  it('rejects invalid lengths and incomplete original revisions without truncating good data', () => {
    state().setKnowledgeDraft(input, scope()); const draft = state().knowledgeDraft!;
    for (const invalid of [{ ...input, text: 'x'.repeat(120001) }, { ...input, title: 'x'.repeat(161) }, { ...input, updatedAt: 2 }, { ...input, id: 'not-an-id' }]) {
      expect(state().setKnowledgeDraft(invalid, scope(), draft.revision)).toBe(false); expect(state().knowledgeDraft).toEqual(draft);
    }
  });
  it('salvages valid chat records but preserves raw corrupt draft bytes for recovery', async () => {
    await state().clearSession(); const raw = JSON.stringify({ ...JSON.parse(storage.get(key())!), knowledgeDraft: { title: '不可丢弃原始资料', text: input.text, revision: 42 } }); storage.set(key(), raw);
    await state().setSession('a', user, server);
    expect(state().knowledgeDraft).toBeUndefined(); expect(state().recoveryNotice).toContain('恢复副本');
    expect(storage.get(key() + '/recovery')).toBe(raw);
    expect(state().storageReadBlocked).toBe(false);
  });
});
