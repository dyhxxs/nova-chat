import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_INTENT_KEY, CREDENTIAL_KEY, CredentialStorageError, createCredentialVault } from '../src/lib/credentialVault';
let plain: Map<string, string>; let secret: Map<string, string>;
function fixture() {
  const storage = { getItem: vi.fn(async (key: string) => plain.get(key) ?? null), setItem: vi.fn(async (key: string, value: string) => { plain.set(key, value); }) };
  const secure = { getItemAsync: vi.fn(async (key: string) => secret.get(key) ?? null), setItemAsync: vi.fn(async (key: string, value: string) => { secret.set(key, value); }), deleteItemAsync: vi.fn(async (key: string) => { secret.delete(key); }) };
  let id = 0;
  return { storage, secure, vault: createCredentialVault(storage, secure, () => 'nonce-' + ++id) };
}
beforeEach(() => { plain = new Map(); secret = new Map(); });
describe('credential vault crash and failure safety', () => {
  it('round-trips gateway-bound credentials without storing a token in plain storage', async () => {
    const { vault } = fixture(); await vault.save('private-token', 'https://gateway.example');
    expect(await vault.load()).toEqual({ token: 'private-token', serverUrl: 'https://gateway.example' });
    expect(JSON.stringify([...plain])).not.toContain('private-token');
    expect(JSON.stringify([...plain])).not.toContain('gateway.example');
    expect(JSON.parse(secret.get(CREDENTIAL_KEY)!)).toMatchObject({ version: 2, token: 'private-token' });
  });
  it('reads legacy opaque tokens only when no fence exists', async () => {
    secret.set(CREDENTIAL_KEY, 'old-token'); const { vault } = fixture();
    expect(await vault.load()).toEqual({ token: 'old-token' });
    plain.set(AUTH_INTENT_KEY, JSON.stringify({ version: 1, state: 'active', nonce: 'n' }));
    await expect(vault.load()).rejects.toMatchObject({ operation: 'read' });
  });
  it('does not silently treat secure read failures as a normal logout', async () => {
    const { vault, secure } = fixture(); secret.set(CREDENTIAL_KEY, 'kept');
    secure.getItemAsync.mockRejectedValueOnce(new Error('private native error'));
    await expect(vault.load()).rejects.toThrow(CredentialStorageError);
    expect(await vault.load()).toEqual({ token: 'kept' });
  });
  it('rejects corrupt public intent instead of restoring the old secret', async () => {
    const { vault } = fixture(); secret.set(CREDENTIAL_KEY, 'old'); plain.set(AUTH_INTENT_KEY, '{broken');
    await expect(vault.load()).rejects.toMatchObject({ operation: 'read' });
    expect(secret.get(CREDENTIAL_KEY)).toBe('old');
  });
  it('does not write a new secret unless a verified blocked fence exists', async () => {
    const { vault, storage, secure } = fixture(); secret.set(CREDENTIAL_KEY, 'old');
    storage.setItem.mockRejectedValueOnce(new Error('disk full'));
    await expect(vault.save('new', 'https://a.example')).rejects.toMatchObject({ operation: 'write' });
    expect(secure.setItemAsync).not.toHaveBeenCalled(); expect(secret.get(CREDENTIAL_KEY)).toBe('old');
  });
  it('failed secret writes leave automatic login blocked and can be retried', async () => {
    const { vault, secure } = fixture(); secret.set(CREDENTIAL_KEY, 'old');
    secure.setItemAsync.mockRejectedValueOnce(new Error('keystore locked'));
    await expect(vault.save('new', 'https://a.example')).rejects.toMatchObject({ operation: 'write' });
    expect(await vault.load()).toEqual({ token: '' });
    await vault.save('new', 'https://a.example'); expect((await vault.load()).token).toBe('new');
  });
  it('detects no-op secure writes and does not activate an unverified credential', async () => {
    const { vault, secure } = fixture(); secure.setItemAsync.mockResolvedValueOnce(undefined);
    await expect(vault.save('new', 'https://a.example')).rejects.toMatchObject({ operation: 'write' });
    expect(JSON.parse(plain.get(AUTH_INTENT_KEY)!)).toMatchObject({ state: 'blocked' });
  });
  it('a crash/failure before the active fence cannot restore the written envelope', async () => {
    const { vault, storage } = fixture(); const set = storage.setItem.getMockImplementation()!;
    storage.setItem.mockImplementation(async (key, value) => { if (value.includes('active')) throw new Error('interrupted'); await set(key, value); });
    await expect(vault.save('new', 'https://a.example')).rejects.toThrow();
    expect(secret.has(CREDENTIAL_KEY)).toBe(true);
    expect(await fixture().vault.load()).toEqual({ token: '' });
  });
  it('a failed delete is fenced off across a new vault instance and cleanup retries', async () => {
    const { vault, secure } = fixture(); await vault.save('old', 'https://a.example');
    secure.deleteItemAsync.mockRejectedValueOnce(new Error('locked'));
    await expect(vault.clear()).rejects.toMatchObject({ operation: 'delete', logoutProtected: true });
    expect(secret.has(CREDENTIAL_KEY)).toBe(true);
    expect(await fixture().vault.load()).toEqual({ token: '' }); expect(secret.has(CREDENTIAL_KEY)).toBe(false);
  });
  it('blocked startup never returns a token even if cleanup continues to fail', async () => {
    const { vault, secure } = fixture(); secret.set(CREDENTIAL_KEY, 'old'); plain.set(AUTH_INTENT_KEY, JSON.stringify({ version: 1, state: 'blocked' }));
    secure.deleteItemAsync.mockRejectedValueOnce(new Error('locked'));
    await expect(vault.load()).rejects.toMatchObject({ operation: 'delete', logoutProtected: true });
  });
  it('tries deletion independently when the fence fails', async () => {
    const { vault, storage } = fixture(); await vault.save('old', 'https://a.example'); storage.setItem.mockRejectedValueOnce(new Error('full'));
    await expect(vault.clear()).rejects.toMatchObject({ logoutProtected: true }); expect(secret.has(CREDENTIAL_KEY)).toBe(false);
    expect((await fixture().vault.load()).token).toBe('');
  });
  it('explicitly warns that logout is not durable when BOTH stores fail', async () => {
    const { vault, storage, secure } = fixture(); await vault.save('old', 'https://a.example');
    storage.setItem.mockRejectedValueOnce(new Error('full')); secure.deleteItemAsync.mockRejectedValueOnce(new Error('locked'));
    await expect(vault.clear()).rejects.toMatchObject({ operation: 'delete', logoutProtected: false });
    await vault.clear(); expect((await vault.load()).token).toBe('');
  });
  it('serializes an in-flight save and logout so the old login never wins', async () => {
    const { vault, secure } = fixture(); let release!: () => void;
    secure.setItemAsync.mockImplementationOnce(async (key, value) => { await new Promise<void>((resolve) => { release = resolve; }); secret.set(key, value); });
    const saved = vault.save('slow', 'https://a.example');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const cleared = vault.clear(); release(); await Promise.all([saved, cleared]);
    expect((await fixture().vault.load()).token).toBe('');
  });
  it('rejects a mismatched or missing fence for a versioned envelope', async () => {
    const { vault } = fixture(); await vault.save('new', 'https://a.example');
    plain.set(AUTH_INTENT_KEY, JSON.stringify({ version: 1, state: 'active', nonce: 'other' }));
    await expect(vault.load()).rejects.toThrow(); plain.delete(AUTH_INTENT_KEY); await expect(vault.load()).rejects.toThrow();
  });
});
