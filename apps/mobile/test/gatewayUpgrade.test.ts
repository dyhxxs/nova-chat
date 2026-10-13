import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => vi.stubEnv('EXPO_PUBLIC_GATEWAY_URL', 'https://8.8.8.8'));
afterAll(() => vi.unstubAllEnvs());
const storage = vi.hoisted(() => new Map<string, string>());
const secure = vi.hoisted(() => ({ raw: '', failRead: false, failDelete: false }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
  removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
} }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => { if (secure.failRead) throw new Error('temporarily unavailable'); return key === 'nova-chat-session-token' ? secure.raw || null : null; }),
  setItemAsync: vi.fn(async (_key: string, value: string) => { secure.raw = value; }),
  deleteItemAsync: vi.fn(async (key: string) => { if (key === 'nova-chat-session-token') { if (secure.failDelete) throw new Error('delete unavailable'); secure.raw = ''; } }),
}));
import { useAppStore } from '../src/store/useAppStore';
const state = () => useAppStore.getState();
const current = 'https://8.8.8.8';
const old = 'https://old-gateway.example.com';
const user = { id: 'owner', email: 'test@example.com', displayName: 'Owner', role: 'admin' as const, disabled: false, createdAt: 1, updatedAt: 1 };
const accountKey = (url: string) => `@nova-chat/account/v1/${encodeURIComponent(user.id)}:${encodeURIComponent(url)}`;

beforeEach(async () => {
  secure.failRead = false; secure.failDelete = false;
  await state().clearSession(); await state().flushPersistence();
  storage.clear(); secure.raw = ''; vi.clearAllMocks();
});

describe('APK upgrade storage integration', () => {
  it('switches gateways, fences the old token, and preserves old scoped conversations byte-for-byte', async () => {
    await state().setSession('old-token', user, old);
    state().beginTurn('old account private history');
    await state().flushPersistence();
    const original = storage.get(accountKey(old));
    await state().hydrate(); await state().flushPersistence();
    expect(state().settings.serverUrl).toBe(current);
    expect(state().authStatus).toBe('unauthenticated');
    expect(state().accessToken).toBe(''); expect(secure.raw).toBe('');
    expect(state().gatewayChanged).toBe(true);
    expect(state().conversations.flatMap(c => c.messages)).toEqual([]);
    expect(storage.get(accountKey(old))).toBe(original);
    expect(storage.has(accountKey(current))).toBe(false);
    expect(JSON.parse(storage.get('@nova-chat/settings/v1')!).settings.serverUrl).toBe(current);
    await state().setSession('new-token', user, current);
    expect(state().gatewayChanged).toBe(false);
    expect(state().conversations.flatMap(c => c.messages)).toEqual([]);
    expect(storage.get(accountKey(old))).toBe(original);
  });
  it('keeps existing ordinary and companion histories, photos, favorites and settings across repeated same-origin upgrades', async () => {
    await state().setSession('existing-phone-token', user, current);
    state().updateSettings({ instructions: '我的个人设置', model: 'saved-model', webSearch: true });
    const photo = { id: '11111111-1111-4111-8111-111111111111', name: '旧版照片.png', mimeType: 'image/png', size: 128, kind: 'image' as const };
    const normal = state().beginTurn('旧版的普通聊天', [photo]);
    state().appendAssistantDelta(normal.conversationId, normal.assistantMessageId, '之前保存的回复');
    state().completeAssistant(normal.conversationId, normal.assistantMessageId, { attachments: [photo], model: 'saved-model' });
    state().toggleMessageStarred(normal.conversationId, normal.assistantMessageId);
    state().toggleConversationPinned(normal.conversationId);
    state().setConversationDraft(normal.conversationId, '还没发送的草稿');
    state().saveAssistantPreset({ name: '我的助手', description: '旧版创建的助手', starter: '你好', instructions: '保存的助手指令' });
    const companionId = state().newCompanionConversation('22222222-2222-4222-8222-222222222222', '小夏');
    const companion = state().beginTurn('陪伴的历史记录', [], companionId);
    state().appendAssistantDelta(companionId, companion.assistantMessageId, '我记得我们之前的聊天');
    state().completeAssistant(companionId, companion.assistantMessageId, { attachments: [photo] });
    await state().flushPersistence();
    // Snapshot v7 is the format already shipped in 1.1.23; an APK version change
    // must retain the account namespace and every persisted record.
    const originalSnapshot = storage.get(accountKey(current))!;
    expect(JSON.parse(originalSnapshot).version).toBe(7);
    const conversations = JSON.parse(JSON.stringify(state().conversations));
    const presets = JSON.parse(JSON.stringify(state().assistantPresets));
    const settings = { ...state().settings };
    const deviceId = state().deviceId;
    for (let restart = 0; restart < 3; restart += 1) {
      await state().hydrate();
      // Startup loads private records only after the saved session identifies its owner.
      await state().restoreUserState(user); await state().flushPersistence();
      expect(state().conversations).toEqual(conversations);
      expect(state().assistantPresets).toEqual(presets);
      expect(state().settings).toEqual(settings);
      expect(state().deviceId).toBe(deviceId);
      expect(state().accessToken).toBe('existing-phone-token');
      expect(state().dataOwnerId).toBe(user.id);
      expect(state().dataOwnerServerUrl).toBe(current);
      expect(state().gatewayChanged).toBe(false);
      expect(JSON.parse(storage.get(accountKey(current))!)).toEqual(JSON.parse(originalSnapshot));
    }
  });
  it('restores an existing session for the same bundled origin', async () => {
    await state().setSession('current-token', user, current); await state().flushPersistence();
    const original = secure.raw;
    await state().hydrate();
    expect(state().accessToken).toBe('current-token');
    expect(state().authStatus).toBe('unknown');
    expect(state().gatewayChanged).toBe(false); expect(secure.raw).toBe(original);
  });
  it('does not destroy unreadable credentials while selecting the new bundled gateway', async () => {
    await state().setSession('old-token', user, old); await state().flushPersistence();
    const original = secure.raw; secure.failRead = true;
    await state().hydrate(); await state().flushPersistence();
    expect(state().accessToken).toBe(''); expect(state().settings.serverUrl).toBe(current);
    expect(state().credentialOperation).toBe('read'); expect(secure.raw).toBe(original);
    secure.failRead = false;
    await state().retryCredentialPersistence(); await state().flushPersistence();
    expect(state().accessToken).toBe(''); expect(secure.raw).toBe('');
    expect(state().credentialError).toBeUndefined();
  });
  it('does not forward an unbound legacy token after a read failure changes saved settings', async () => {
    storage.set('@nova-chat/settings/v1', JSON.stringify({ version: 1, settings: { serverUrl: old }, deviceId: 'existing-device' }));
    secure.raw = 'old-legacy-token'; secure.failRead = true;
    await state().hydrate(); await state().flushPersistence();
    expect(secure.raw).toBe('old-legacy-token');
    secure.failRead = false;
    await state().retryCredentialPersistence(); await state().flushPersistence();
    expect(state().accessToken).toBe(''); expect(state().settings.serverUrl).toBe(current);
    expect(secure.raw).toBe('');
  });
  it('never restores an old token when secure deletion fails during an upgrade', async () => {
    await state().setSession('old-token', user, old); await state().flushPersistence();
    secure.failDelete = true;
    await state().hydrate();
    await expect(state().flushPersistence()).rejects.toThrow();
    expect(state().accessToken).toBe(''); expect(state().authStatus).toBe('unauthenticated');
    expect(state().credentialOperation).toBe('delete');
    expect(JSON.parse(storage.get('@nova-chat/auth-intent/v1')!).state).toBe('blocked');
    await state().hydrate();
    expect(state().accessToken).toBe(''); expect(state().settings.serverUrl).toBe(current);
    secure.failDelete = false;
    await state().retryCredentialPersistence();
    expect(secure.raw).toBe(''); expect(state().credentialError).toBeUndefined();
  });
});
