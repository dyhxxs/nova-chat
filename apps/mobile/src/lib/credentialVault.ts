export const CREDENTIAL_KEY = 'nova-chat-session-token';
export const AUTH_INTENT_KEY = '@nova-chat/auth-intent/v1';
export type CredentialOperation = 'read' | 'write' | 'delete';
export class CredentialStorageError extends Error {
  constructor(readonly operation: CredentialOperation, readonly logoutProtected = false) {
    super(operation === 'read'
      ? '无法读取登录凭据，已暂停自动登录。请重试；不要卸载应用或清除数据。'
      : operation === 'write'
        ? '登录凭据未可靠保存。当前登录可暂时使用，但重启后可能需要重新登录，旧登录也可能仍残留。请重试保存。'
        : logoutProtected
          ? '已阻止本次旧登录恢复，但退出清理尚未全部完成。请重试清理。'
          : '设备存储异常：退出未能可靠保存，重启可能恢复旧登录。请重试清理；完成前不要把设备交给他人。');
    this.name = 'CredentialStorageError';
  }
}
interface PlainStorage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<unknown> }
interface SecretStorage { getItemAsync(key: string): Promise<string | null>; setItemAsync(key: string, value: string): Promise<unknown>; deleteItemAsync(key: string): Promise<unknown> }
export type SavedCredential = { token: string; serverUrl?: string };

/** A non-secret fence prevents a failed delete or interrupted login from restoring an old token. */
export function createCredentialVault(plain: PlainStorage, secret: SecretStorage, nonce: () => string) {
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.catch(() => undefined).then(task); queue = result; return result;
  }
  async function fence(value: string) {
    await plain.setItem(AUTH_INTENT_KEY, value);
    if (await plain.getItem(AUTH_INTENT_KEY) !== value) throw new Error('Fence verification failed');
  }
  async function removeSecret() {
    await secret.deleteItemAsync(CREDENTIAL_KEY);
    if (await secret.getItemAsync(CREDENTIAL_KEY)) throw new Error('Delete verification failed');
  }
  const blocked = JSON.stringify({ version: 1, state: 'blocked' });
  return {
    load: () => serial(async (): Promise<SavedCredential> => {
      try {
        const rawFence = await plain.getItem(AUTH_INTENT_KEY);
        const intent = rawFence === null ? undefined : JSON.parse(rawFence) as { version?: unknown; state?: unknown; nonce?: unknown } | null;
        if (intent !== undefined && (!intent || intent.version !== 1 || !['blocked', 'active'].includes(String(intent.state)))) throw new Error('Invalid fence');
        if (intent?.state === 'blocked') {
          try { await removeSecret(); } catch { throw new CredentialStorageError('delete', true); }
          return { token: '' };
        }
        const raw = await secret.getItemAsync(CREDENTIAL_KEY);
        if (!raw) return { token: '' };
        // Upgrade compatibility only: legacy opaque tokens have no fence.
        if (intent === undefined && !raw.startsWith('{')) return { token: raw };
        const envelope = JSON.parse(raw) as { version?: unknown; token?: unknown; nonce?: unknown; serverUrl?: unknown } | null;
        if (!envelope || envelope.version !== 2 || typeof envelope.token !== 'string' || !envelope.token
          || typeof envelope.serverUrl !== 'string' || typeof envelope.nonce !== 'string' || !envelope.nonce
          || intent?.state !== 'active' || intent.nonce !== envelope.nonce) throw new Error('Incomplete login');
        return { token: envelope.token, serverUrl: envelope.serverUrl };
      } catch (error) {
        if (error instanceof CredentialStorageError) throw error;
        throw new CredentialStorageError('read');
      }
    }),
    save: (token: string, serverUrl: string) => serial(async () => {
      try {
        await fence(blocked);
        const id = nonce();
        const envelope = JSON.stringify({ version: 2, token, serverUrl, nonce: id });
        await secret.setItemAsync(CREDENTIAL_KEY, envelope);
        if (await secret.getItemAsync(CREDENTIAL_KEY) !== envelope) throw new Error('Credential verification failed');
        await fence(JSON.stringify({ version: 1, state: 'active', nonce: id }));
      } catch { throw new CredentialStorageError('write'); }
    }),
    clear: () => serial(async () => {
      const results = await Promise.allSettled([fence(blocked), removeSecret()]);
      if (results.some((result) => result.status === 'rejected')) throw new CredentialStorageError('delete', results.some((result) => result.status === 'fulfilled'));
    }),
  };
}
