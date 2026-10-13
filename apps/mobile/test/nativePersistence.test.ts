import { accountScope } from '../src/lib/accountScope';
import { serializeAssistantBackup } from '../src/lib/assistantBackup';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { testSnapshotDatabase } from './helpers/snapshotDatabase';
const shared = vi.hoisted(() => ({
  fixture: undefined as ReturnType<typeof testSnapshotDatabase> | undefined,
  plain: new Map<string, string>(), secret: new Map<string, string>(),
}));
vi.hoisted(() => vi.stubEnv('EXPO_PUBLIC_GATEWAY_URL', ''));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => shared.plain.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { shared.plain.set(key, value); }),
  removeItem: vi.fn(async (key: string) => { shared.plain.delete(key); }),
} }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => shared.secret.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { shared.secret.set(key, value); }),
  deleteItemAsync: vi.fn(async (key: string) => { shared.secret.delete(key); }),
}));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn(async () => {
  shared.fixture ??= testSnapshotDatabase(); return shared.fixture.db;
}) }));
vi.mock('../src/services/snapshotStorage', async () => import('../src/services/snapshotStorage.native'));
import * as SecureStore from 'expo-secure-store';
import { AUTH_INTENT_KEY, CREDENTIAL_KEY } from '../src/lib/credentialVault';
import { SQLITE_MIGRATION_MARKER } from '../src/lib/sqliteSnapshotRepository';
import { snapshotStorage } from '../src/services/snapshotStorage.native';
import { useAppStore } from '../src/store/useAppStore';
const state = () => useAppStore.getState();
const user = { id: 'native-user', email: 'n@example.com', displayName: 'N', role: 'user' as const, disabled: false, createdAt: 1, updatedAt: 1 };
const server = 'https://native.example';
const key = '@nova-chat/account/v1/native-user:' + encodeURIComponent(server);
beforeEach(async () => {
  await state().clearSession(); await state().flushPersistence();
  await snapshotStorage.getLegacyArchive(key); // Initialize the real SQL schema.
  shared.fixture!.sql.exec('DELETE FROM account_snapshots_v1; DELETE FROM legacy_archives_v1; DELETE FROM archive_revisions_v1;');
  shared.plain.clear(); shared.secret.clear(); vi.clearAllMocks();
});
afterAll(async () => { await state().clearSession(); await state().flushPersistence(); shared.fixture?.sql.close(); vi.unstubAllEnvs(); });

describe('store through native Expo adapter using real SQLite', () => {
  it('migrates a v7 account, archives its exact input, and restores messages on another login', async () => {
    const original = JSON.stringify({ version: 7, userId: user.id, activeConversationId: 'old-chat', conversations: [{ id: 'old-chat', title: '旧对话', createdAt: 1, updatedAt: 1, messages: [{ id: 'msg', role: 'user', content: '保留旧历史', attachments: [], createdAt: 1, status: 'complete' }] }] });
    shared.plain.set(key, original);
    await state().setSession('token', user, server);
    expect(state().conversations[0]?.messages[0]?.content).toBe('保留旧历史');
    expect(shared.plain.get(key)).toBe(SQLITE_MIGRATION_MARKER);
    expect(await state().exportRecoverySnapshot('migration')).toBe(original);
    state().setConversationDraft('old-chat', 'SQLite 中的新草稿'); await state().flushPersistence();
    await state().clearSession(); await state().setSession('token', user, server);
    expect(state().conversations[0]?.draft).toBe('SQLite 中的新草稿');
    expect(await snapshotStorage.getLegacyArchive(key)).toBe(original);
  });
  it('blocks writes instead of losing a migrated account if SQLite read fails', async () => {
    await state().setSession('token', user, server); state().beginTurn('important original'); await state().clearSession();
    const original = await snapshotStorage.getItem(key); shared.fixture!.faults.read = true;
    await state().setSession('token', user, server);
    expect(state().storageReadBlocked).toBe(true);
    await expect(state().flushPersistence()).rejects.toThrow('不会覆盖');
    expect(await snapshotStorage.getItem(key)).toBe(original);
    await state().clearSession(); await state().setSession('token', user, server);
    expect(state().conversations.flatMap((chat) => chat.messages).some((msg) => msg.content === 'important original')).toBe(true);
  });
  it('refuses to export or overwrite a migration archive that declares another owner', async () => {
    shared.plain.set(key, JSON.stringify({ version: 7, userId: 'another-user', conversations: [] }));
    await state().setSession('token', user, server);
    expect(state().storageReadBlocked).toBe(true);
    await expect(state().exportRecoverySnapshot('migration')).rejects.toThrow('归属不匹配');
  });
});

describe('store credential error visibility and retries', () => {
  it('keeps a usable memory session and exposes a write warning until retry succeeds', async () => {
    vi.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('native keychain details'));
    await state().setSession('private-token', user, server);
    expect(state().authStatus).toBe('authenticated'); expect(state().accessToken).toBe('private-token');
    expect(state().credentialOperation).toBe('write'); expect(state().credentialError).not.toContain('native keychain details');
    expect(state().credentialError).toContain('未可靠保存');
    await state().retryCredentialPersistence(); expect(state().credentialError).toBeUndefined();
    expect(JSON.parse(shared.secret.get(CREDENTIAL_KEY)!)).toMatchObject({ token: 'private-token', serverUrl: server });
  });
  it('shows logout failure on the unauthenticated state and blocks restart resurrection', async () => {
    await state().setSession('old-token', user, server);
    vi.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('locked'));
    await state().clearSession();
    expect(state().authStatus).toBe('unauthenticated'); expect(state().credentialOperation).toBe('delete');
    expect(JSON.parse(shared.plain.get(AUTH_INTENT_KEY)!)).toMatchObject({ state: 'blocked' });
    await state().hydrate(); expect(state().accessToken).toBe(''); expect(state().credentialError).toBeUndefined();
  });
  it('shows read failures instead of silently logging out and retries without deleting histories', async () => {
    await state().setSession('saved-token', user, server); state().beginTurn('saved history'); await state().flushPersistence();
    vi.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('locked'));
    await state().hydrate(); expect(state().credentialOperation).toBe('read'); expect(state().accessToken).toBe('');
    await state().retryCredentialPersistence(); expect(state().accessToken).toBe('saved-token'); expect(state().credentialError).toBeUndefined();
    await state().restoreUserState(user); expect(state().conversations.flatMap((chat) => chat.messages).some((msg) => msg.content === 'saved history')).toBe(true);
  });
  it('restores the credential-bound gateway even when global bootstrap is stale', async () => {
    await state().setSession('saved-token', user, server);
    shared.plain.set('@nova-chat/settings/v1', JSON.stringify({ version: 1, settings: { serverUrl: 'https://wrong.example' }, deviceId: 'device-id' }));
    await state().hydrate(); expect(state().settings.serverUrl).toBe(server); expect(state().accessToken).toBe('saved-token');
  });
});


describe('assistant import through authenticated native store', () => {
  const template = { id: 'shared-template', name: '迁移助手', description: '', instructions: 'instruction', starter: 'starter', updatedAt: 1 };
  it('imports without creating messages, preserves provenance on edit, and persists to the correct account', async () => {
    await state().setSession('token', user, server);
    const conversation = state().conversations;
    const json = serializeAssistantBackup([template]);
    expect(state().importAssistantBackup(json, accountScope(state()))).toEqual({ imported: 1, skipped: 0 });
    expect(state().conversations).toBe(conversation);
    const imported = state().assistantPresets[0]!;
    state().saveAssistantPreset({ ...imported, instructions: 'edited locally' }, imported.id);
    expect(state().importAssistantBackup(json, accountScope(state()))).toEqual({ imported: 0, skipped: 1 });
    await state().clearSession(); await state().setSession('other-token', { ...user, id: 'another-user' }, server);
    expect(state().assistantPresets).toEqual([]);
    await state().clearSession(); await state().setSession('token', user, server);
    expect(state().assistantPresets[0]).toMatchObject({ importSourceId: template.id, instructions: 'edited locally' });
  });
  it('refuses a preview from a different session and validates the whole file before mutating', async () => {
    await state().setSession('token', user, server); const scope = accountScope(state());
    const json = serializeAssistantBackup([template]);
    await state().setSession('new-token', user, server);
    expect(() => state().importAssistantBackup(json, scope)).toThrow('账号已切换');
    const bad = JSON.parse(json); bad.presets.push({ ...bad.presets[0], sourceId: 'bad', instructions: '' });
    expect(() => state().importAssistantBackup(JSON.stringify(bad), accountScope(state()))).toThrow();
    expect(state().assistantPresets).toEqual([]);
  });
});

describe('authenticated storage maintenance', () => {
  async function loginWithArchive() {
    shared.plain.set(key, JSON.stringify({ version: 7, userId: user.id, conversations: [] }));
    await state().setSession('token', user, server);
  }
  it('requires authentication and blocks cleanup while local restoration is blocked', async () => {
    await expect(state().getStorageOverview()).rejects.toThrow('登录');
    await expect(state().prepareArchiveCleanup()).rejects.toThrow('登录');
    await loginWithArchive(); useAppStore.setState({ storageReadBlocked: true });
    await expect(state().prepareArchiveCleanup()).rejects.toThrow('读取');
    useAppStore.setState({ storageReadBlocked: false });
    expect(await state().exportRecoverySnapshot('migration')).not.toBeNull();
  });
  it('saves pending drafts before preview and preserves live state after confirmation', async () => {
    await loginWithArchive(); const id = state().activeConversationId;
    state().setConversationDraft(id, 'unsent private draft');
    const plan = await state().prepareArchiveCleanup();
    expect(JSON.parse((await snapshotStorage.getItem(key))!).conversations[0].draft).toBe('unsent private draft');
    expect(plan.overview.migrationBytes).toBeGreaterThan(0);
    await plan.confirm(); expect(await state().exportRecoverySnapshot('migration')).toBeNull();
    expect(state().conversations[0]?.draft).toBe('unsent private draft');
    await expect(plan.confirm()).rejects.toThrow('已使用');
  });
  it.each(['account', 'gateway', 'token'])('rejects a pending cleanup after a change of %s', async (change) => {
    await loginWithArchive(); const plan = await state().prepareArchiveCleanup();
    await state().setSession(change === 'token' ? 'new-token' : 'token', change === 'account' ? { ...user, id: 'different' } : user, change === 'gateway' ? 'https://different.example' : server);
    await expect(plan.confirm()).rejects.toThrow('账号');
    expect(await snapshotStorage.getLegacyArchive(key)).not.toBeNull();
  });
  it('refuses a preview if flushing current state fails', async () => {
    await loginWithArchive(); shared.fixture!.faults.commit = true;
    await expect(state().prepareArchiveCleanup()).rejects.toThrow();
    expect(await state().exportRecoverySnapshot('migration')).not.toBeNull();
  });
  it('flushes content created after the cleanup preview before deleting any archive', async () => {
    await loginWithArchive(); const plan = await state().prepareArchiveCleanup();
    state().setConversationDraft(state().activeConversationId, 'draft after preview');
    await plan.confirm();
    expect(JSON.parse((await snapshotStorage.getItem(key))!).conversations[0].draft).toBe('draft after preview');
    expect(await snapshotStorage.getLegacyArchive(key)).toBeNull();
  });
  it('retains all archives if confirmation-time persistence fails', async () => {
    await loginWithArchive(); const plan = await state().prepareArchiveCleanup();
    shared.fixture!.faults.commit = true;
    await expect(plan.confirm()).rejects.toThrow();
    expect(await snapshotStorage.getLegacyArchive(key)).not.toBeNull();
    expect((await state().getStorageOverview()).archiveRevision).toBe(plan.overview.archiveRevision);
  });
  it('exports all retained recovery migration text before cleanup without mixing it with the newer recovery', async () => {
    await loginWithArchive(); const original = JSON.stringify({ userId: user.id, original: 'older recovery' });
    shared.plain.set(key + '/recovery', original);
    expect(await state().exportRecoverySnapshot('recoveryMigration')).toBe(original);
    await snapshotStorage.setItem(key + '/recovery', 'newer recovery');
    expect(await state().exportRecoverySnapshot('recoveryMigration')).toBe(original);
    expect(await state().exportRecoverySnapshot('recovery')).toBe('newer recovery');
  });
  it('refuses a recovery migration export with a different declared owner', async () => {
    await loginWithArchive();
    shared.plain.set(key + '/recovery', JSON.stringify({ userId: 'different-account' }));
    await expect(state().exportRecoverySnapshot('recoveryMigration')).rejects.toThrow('归属不匹配');
  });
  it('rejects a cleanup if a new repair arrives after the preview', async () => {
    await loginWithArchive(); const plan = await state().prepareArchiveCleanup();
    await snapshotStorage.setItem(key + '/recovery', 'newly recovered input');
    await expect(plan.confirm()).rejects.toThrow('已变化');
    expect(await snapshotStorage.getItem(key + '/recovery')).toBe('newly recovered input');
  });
});


describe('companion identity in native persistence', () => {
  it('restores the role and continues the same conversation after another login', async () => {
    await state().setSession('token', user, server);
    const id = state().newCompanionConversation('12121212-1212-4212-8212-121212121212', '小雨');
    state().beginTurn('今天好吗？', [], id);
    await state().flushPersistence(); await state().clearSession();
    await state().setSession('token', user, server);
    expect(state().conversations.find(chat => chat.id === id)).toMatchObject({ kind: 'companion', companionId: '12121212-1212-4212-8212-121212121212', companionName: '小雨' });
    expect(state().newCompanionConversation('12121212-1212-4212-8212-121212121212', '雨')).toBe(id);
    expect(state().conversations.filter(chat => chat.companionId === '12121212-1212-4212-8212-121212121212')).toHaveLength(1);
    expect(state().conversations.find(chat => chat.id === id)?.messages[0]?.content).toBe('今天好吗？');
    expect(state().activeConversationId).toBe(id);
  });
});
