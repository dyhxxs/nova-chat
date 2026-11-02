import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { AppDatabase } from '../src/database.js';

const temporaryDirectories: string[] = [];
const databases: AppDatabase[] = [];

async function create() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'nova-chat-sync-test-'));
  temporaryDirectories.push(dataDir);
  const database = new AppDatabase(loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    SERVER_MASTER_KEY: 'sync-test-master-key-that-is-never-used-in-production',
  }));
  databases.push(database);
  const user = database.createUser({ email: 'sync@qa.local', password: 'temporary-test-password', displayName: 'QA' });
  return { database, user };
}

afterEach(async () => {
  while (databases.length) databases.pop()?.close();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('conversation sync storage', () => {
  it('stores, lists, updates, tombstones and clears conversations with a monotonic cursor', async () => {
    const { database, user } = await create();
    const payload = { id: 'conv-1', updatedAt: 1000, title: 'one', messages: [{ role: 'user', content: 'hi' }] };

    const first = database.saveSyncedConversation(user.id, 'conv-1', payload);
    expect(first).toBeGreaterThan(0);
    let listed = database.listSyncedConversations(user.id, 0);
    expect(listed.cursor).toBe(first);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({ id: 'conv-1', deleted: false });
    expect(listed.items[0]!.conversation).toEqual(payload);

    // A pull at the same cursor returns nothing new.
    expect(database.listSyncedConversations(user.id, first).items).toHaveLength(0);

    const second = database.saveSyncedConversation(user.id, 'conv-1', { ...payload, updatedAt: 2000 });
    expect(second).toBeGreaterThan(first);
    listed = database.listSyncedConversations(user.id, first);
    expect(listed.items).toHaveLength(1);
    expect((listed.items[0]!.conversation as { updatedAt: number }).updatedAt).toBe(2000);

    const third = database.deleteSyncedConversation(user.id, 'conv-1');
    expect(third).toBeTypeOf('number');
    const thirdRevision = third as number;
    expect(thirdRevision).toBeGreaterThan(second);
    listed = database.listSyncedConversations(user.id, second);
    expect(listed.items[0]).toMatchObject({ id: 'conv-1', deleted: true });

    // Re-creating after a tombstone revives the same id.
    const fourth = database.saveSyncedConversation(user.id, 'conv-1', { ...payload, updatedAt: 3000 });
    expect(fourth).toBeGreaterThan(thirdRevision);
    expect(database.listSyncedConversations(user.id, thirdRevision).items[0]).toMatchObject({ id: 'conv-1', deleted: false });

    // Clear tombstones every active conversation at once.
    database.saveSyncedConversation(user.id, 'conv-2', { id: 'conv-2', updatedAt: 4000 });
    const cleared = database.clearSyncedConversations(user.id);
    expect(cleared.deleted).toBe(2);
    const after = database.listSyncedConversations(user.id, fourth);
    expect(after.items).toHaveLength(2);
    expect(after.items.every((item) => item.deleted)).toBe(true);
  });

  it('isolates conversations per user and enforces the per-conversation size cap', async () => {
    const first = await create();
    const second = await create();
    first.database.saveSyncedConversation(first.user.id, 'conv-a', { id: 'conv-a', updatedAt: 1 });
    second.database.saveSyncedConversation(second.user.id, 'conv-a', { id: 'conv-a', updatedAt: 1 });
    expect(first.database.listSyncedConversations(first.user.id, 0).items).toHaveLength(1);
    expect(second.database.listSyncedConversations(second.user.id, 0).items).toHaveLength(1);
    expect(() => first.database.saveSyncedConversation(first.user.id, 'big', {
      id: 'big', updatedAt: 1, blob: 'x'.repeat(9 * 1024 * 1024),
    })).toThrow();
  });
});
