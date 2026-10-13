import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteSnapshotRepository, SQLITE_MIGRATION_MARKER } from '../src/lib/sqliteSnapshotRepository';
import { formatStorageBytes, retainedArchiveBytes } from '../src/lib/storageMaintenance';
import { testSnapshotDatabase } from './helpers/snapshotDatabase';
const key = '@nova-chat/account/v1/maintenance:https%3A%2F%2Fa.example';
let fixture: ReturnType<typeof testSnapshotDatabase>;
let legacy: Map<string, string>;
let store: { getItem: ReturnType<typeof vi.fn<(key: string) => Promise<string | null>>>; setItem: ReturnType<typeof vi.fn<(key: string, value: string) => Promise<void>>> };
let repository: ReturnType<typeof createSqliteSnapshotRepository>;
beforeEach(() => {
  fixture = testSnapshotDatabase(); legacy = new Map();
  store = { getItem: vi.fn(async (key) => legacy.get(key) ?? null), setItem: vi.fn(async (key, body) => { legacy.set(key, body); }) };
  repository = createSqliteSnapshotRepository(async () => fixture.db, store);
});
afterEach(() => fixture.sql.close());
async function archived() {
  legacy.set(key, '原始🙂'); legacy.set(key + '/recovery', '损坏原文');
  const info = await repository.getStorageOverview(key);
  await repository.setItem(key, 'current state');
  return info;
}
describe('bounded native bridge traffic', () => {
  it('reads only the new value for verification and does not rewrite a valid marker', async () => {
    await repository.setItem(key, 'large旧'.repeat(1_000_000));
    fixture.metrics.bodyReadBytes = 0; store.setItem.mockClear();
    await repository.setItem(key, 'next🙂');
    expect(fixture.metrics.bodyReadBytes).toBe(Buffer.byteLength('next🙂'));
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it('reports UTF-8 sizes without copying settled snapshot bodies to JS', async () => {
    await archived(); fixture.metrics.bodyReadBytes = 0;
    const info = await repository.getStorageOverview(key);
    expect(info).toMatchObject({ snapshotBytes: 13, migrationBytes: 10, recoveryBytes: 12, recoveryMigrationBytes: 12 });
    expect(fixture.metrics.bodyReadBytes).toBe(0);
    expect(retainedArchiveBytes(info)).toBe(34);
  });
});
describe('explicit transactional archive lifecycle', () => {
  it('includes an unmigrated legacy recovery copy in the preview', async () => {
    const info = await archived();
    expect(info.archiveRevision).toBe(2);
    expect(legacy.get(key + '/recovery')).toBe(SQLITE_MIGRATION_MARKER);
  });
  it('removes all three retained bodies without deleting active data or other accounts', async () => {
    const info = await archived();
    await repository.setItem(key + '-other', 'other private data');
    expect(await repository.clearArchives(key, info.archiveRevision, () => true)).toEqual({ logicalBytesRemoved: 34 });
    expect(await repository.getItem(key)).toBe('current state');
    expect(await repository.getItem(key + '-other')).toBe('other private data');
    expect(await repository.getItem(key + '/recovery')).toBe('');
    expect(await repository.getLegacyArchive(key)).toBeNull();
    expect(await repository.getLegacyArchive(key + '/recovery')).toBeNull();
    expect(retainedArchiveBytes(await repository.getStorageOverview(key))).toBe(0);
    await repository.setItem(key + '/recovery', 'new repair');
    expect(await repository.getItem(key + '/recovery')).toBe('new repair');
    expect(await repository.getLegacyArchive(key + '/recovery')).toBeNull();
  });
  it('rejects a changed recovery revision without removing either archive', async () => {
    const info = await archived(); await repository.setItem(key + '/recovery', 'new recovery');
    await expect(repository.clearArchives(key, info.archiveRevision, () => true)).rejects.toThrow('已变化');
    expect(await repository.getLegacyArchive(key)).toBe('原始🙂');
    expect(await repository.getItem(key + '/recovery')).toBe('new recovery');
  });
  it('uses durable revisions across repository instances', async () => {
    const info = await archived(); const second = createSqliteSnapshotRepository(async () => fixture.db, store);
    await second.setItem(key + '/recovery', 'another writer');
    await expect(repository.clearArchives(key, info.archiveRevision, () => true)).rejects.toThrow('已变化');
  });
  it('does not delete the only recoverable copy when there is no active snapshot', async () => {
    await repository.setItem(key + '/recovery', 'only copy'); const info = await repository.getStorageOverview(key);
    await expect(repository.clearArchives(key, info.archiveRevision, () => true)).rejects.toThrow('活动快照');
    expect(await repository.getItem(key + '/recovery')).toBe('only copy');
  });
  it('keeps the missing-record protection after archive cleanup', async () => {
    const info = await archived(); await repository.clearArchives(key, info.archiveRevision, () => true);
    fixture.sql.prepare('DELETE FROM account_snapshots_v1 WHERE key = ?').run(key);
    await expect(repository.setItem(key, 'blank')).rejects.toThrow('refusing empty restore');
  });
  it('refuses cleanup when a migrated recovery row is unexpectedly missing', async () => {
    const info = await archived(); fixture.sql.prepare('DELETE FROM account_snapshots_v1 WHERE key = ?').run(key + '/recovery');
    await expect(repository.clearArchives(key, info.archiveRevision, () => true)).rejects.toThrow('refusing empty restore');
    expect(await repository.getLegacyArchive(key)).toBe('原始🙂');
  });
  it('refuses stale authority before performing any deletion', async () => {
    const info = await archived();
    await expect(repository.clearArchives(key, info.archiveRevision, () => false)).rejects.toThrow('账号');
    expect(await repository.getLegacyArchive(key)).toBe('原始🙂');
  });
  it('rolls back if authority changes during the transaction', async () => {
    const info = await archived(); let current = true;
    const transact = fixture.db.withExclusiveTransactionAsync;
    fixture.db.withExclusiveTransactionAsync = (task) => transact(async (tx) => task({ ...tx, runAsync: async (sql, args) => {
      const result = await tx.runAsync(sql, args);
      if (sql.startsWith('DELETE FROM legacy_archives')) current = false;
      return result;
    } }));
    await expect(repository.clearArchives(key, info.archiveRevision, () => current)).rejects.toThrow('账号');
    expect(await repository.getLegacyArchive(key)).toBe('原始🙂');
    expect(await repository.getItem(key + '/recovery')).toBe('损坏原文');
  });
  it.each(['write', 'commit'])('rolls back all retained bodies and the revision after a %s failure', async (fault) => {
    const info = await archived(); if (fault === 'write') fixture.faults.writeNumber = 2; else fixture.faults.commit = true;
    await expect(repository.clearArchives(key, info.archiveRevision, () => true)).rejects.toThrow();
    const after = await repository.getStorageOverview(key);
    expect(after.archiveRevision).toBe(info.archiveRevision);
    expect(retainedArchiveBytes(after)).toBe(34);
  });
  it('does not permit a cleanup preview to be replayed', async () => {
    const info = await archived(); await repository.clearArchives(key, info.archiveRevision, () => true);
    await expect(repository.clearArchives(key, info.archiveRevision, () => true)).rejects.toThrow('已变化');
  });
  it('retains cleanup revisions and recovery tombstones after closing and reopening the database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nova-maintenance-r3-'));
    const filename = join(directory, 'snapshots.db');
    let disk = testSnapshotDatabase(filename);
    try {
      legacy.set(key, 'migration original'); legacy.set(key + '/recovery', 'recovery original');
      const first = createSqliteSnapshotRepository(async () => disk.db, store);
      const preview = await first.getStorageOverview(key);
      await first.setItem(key, 'current data');
      await first.clearArchives(key, preview.archiveRevision, () => true);
      disk.sql.close(); disk = testSnapshotDatabase(filename);
      const reopened = createSqliteSnapshotRepository(async () => disk.db, store);
      const info = await reopened.getStorageOverview(key);
      expect(info.archiveRevision).toBe(preview.archiveRevision + 1);
      expect(retainedArchiveBytes(info)).toBe(0);
      expect(await reopened.getItem(key)).toBe('current data');
      expect(await reopened.getItem(key + '/recovery')).toBe('');
      await expect(reopened.clearArchives(key, preview.archiveRevision, () => true)).rejects.toThrow('已变化');
      await reopened.setItem(key + '/recovery', 'new repair after reopen');
      expect(await reopened.getItem(key + '/recovery')).toBe('new repair after reopen');
      expect(await reopened.getLegacyArchive(key + '/recovery')).toBeNull();
    } finally {
      disk.sql.close();
      // Remove only known files in this unique test directory; never recurse.
      for (const suffix of ['', '-wal', '-shm']) rmSync(filename + suffix, { force: true });
      rmdirSync(directory);
    }
  });
  it('rejects maintenance requests for recovery or global keys', async () => {
    await expect(repository.getStorageOverview(key + '/recovery')).rejects.toThrow('account key');
    await expect(repository.getStorageOverview('token')).rejects.toThrow('Not an account');
  });
  it('formats logical sizes without claiming actual physical reclamation', () => {
    expect(formatStorageBytes(null)).toBe('尚无已保存快照'); expect(formatStorageBytes(0)).toBe('0 B');
    expect(formatStorageBytes(1024)).toBe('1.0 KiB'); expect(formatStorageBytes(1024 * 1024)).toBe('1.00 MiB');
  });
});
