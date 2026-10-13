import { mkdtempSync, rmdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteSnapshotRepository, SQLITE_MIGRATION_MARKER } from '../src/lib/sqliteSnapshotRepository';
import { testSnapshotDatabase } from './helpers/snapshotDatabase';
const key = '@nova-chat/account/v1/user:https%3A%2F%2Fa.example';
let fixture: ReturnType<typeof testSnapshotDatabase>;
let legacy: Map<string, string>;
let store: { getItem: ReturnType<typeof vi.fn<(key: string) => Promise<string | null>>>; setItem: ReturnType<typeof vi.fn<(key: string, value: string) => Promise<void>>> };
let repository: ReturnType<typeof createSqliteSnapshotRepository>;
beforeEach(() => {
  fixture = testSnapshotDatabase(); legacy = new Map();
  store = { getItem: vi.fn(async (key) => legacy.get(key) ?? null), setItem: vi.fn(async (key, value) => { legacy.set(key, value); }) };
  repository = createSqliteSnapshotRepository(async () => fixture.db, store);
});
afterEach(() => fixture.sql.close());

describe('SQLite account snapshot migration (real SQLite)', () => {
  it('preserves exact >6 MiB source once and reads subsequent larger updates', async () => {
    const raw = JSON.stringify({ version: 7, text: '历史🙂'.repeat(900_000) });
    expect(Buffer.byteLength(raw)).toBeGreaterThan(6 * 1024 * 1024);
    legacy.set(key, raw);
    expect(await repository.getItem(key)).toBe(raw);
    expect(legacy.get(key)).toBe(SQLITE_MIGRATION_MARKER);
    expect(await repository.getLegacyArchive(key)).toBe(raw);
    await repository.setItem(key, raw + ' ');
    expect(await repository.getItem(key)).toBe(raw + ' ');
    expect(await repository.getLegacyArchive(key)).toBe(raw);
  });
  it('rolls back both archive and live snapshot if the second insert fails', async () => {
    legacy.set(key, 'original'); fixture.faults.writeNumber = 2;
    await expect(repository.getItem(key)).rejects.toThrow('disk full');
    expect(legacy.get(key)).toBe('original');
    expect(await repository.getLegacyArchive(key)).toBeNull();
    expect(fixture.sql.prepare('SELECT count(*) AS n FROM account_snapshots_v1').get()?.n).toBe(0);
    expect(await repository.getItem(key)).toBe('original');
  });
  it('does not touch the old source when transaction commit fails', async () => {
    legacy.set(key, 'original'); fixture.faults.commit = true;
    await expect(repository.getItem(key)).rejects.toThrow('commit error');
    expect(legacy.get(key)).toBe('original');
    expect(await repository.getLegacyArchive(key)).toBeNull();
  });
  it('retries marker failure after commit without losing the original archive', async () => {
    legacy.set(key, 'original'); store.setItem.mockRejectedValueOnce(new Error('legacy full'));
    await expect(repository.getItem(key)).rejects.toThrow('legacy full');
    expect(legacy.get(key)).toBe('original');
    expect(await repository.getLegacyArchive(key)).toBe('original');
    expect(await repository.getItem(key)).toBe('original');
    expect(legacy.get(key)).toBe(SQLITE_MIGRATION_MARKER);
  });
  it('rejects a marker write that did not actually persist', async () => {
    legacy.set(key, 'original'); store.setItem.mockResolvedValueOnce(undefined);
    await expect(repository.getItem(key)).rejects.toThrow('verification failed');
    expect(await repository.getLegacyArchive(key)).toBe('original');
  });
  it('never falls back to stale legacy data when SQLite cannot be read', async () => {
    await repository.setItem(key, 'new'); legacy.set(key, 'stale'); fixture.faults.read = true;
    await expect(repository.getItem(key)).rejects.toThrow('read error');
    expect(legacy.get(key)).toBe('stale');
    expect(await repository.getItem(key)).toBe('new');
  });
  it.each(['nova-chat:sqlite:v1', 'nova-chat:sqlite:v99'])('blocks missing database row for %s', async (marker) => {
    legacy.set(key, marker);
    await expect(repository.getItem(key)).rejects.toThrow('refusing empty restore');
    await expect(repository.setItem(key, 'blank')).rejects.toThrow();
    expect(legacy.get(key)).toBe(marker);
  });
  it('blocks a missing live record even if the marker was lost but archive remains', async () => {
    legacy.set(key, 'original'); await repository.getItem(key);
    fixture.sql.prepare('DELETE FROM account_snapshots_v1 WHERE key = ?').run(key); legacy.delete(key);
    await expect(repository.getItem(key)).rejects.toThrow('refusing empty restore');
    expect(await repository.getLegacyArchive(key)).toBe('original');
  });
  it('serializes concurrent migration and writes, isolates owners and recovery keys', async () => {
    legacy.set(key, 'first');
    const other = key + '-other'; const recovery = key + '/recovery';
    const result = await Promise.all([repository.getItem(key), repository.setItem(key, 'second'), repository.setItem(other, 'private'), repository.setItem(recovery, 'broken')]);
    expect(result[0]).toBe('first');
    expect(await repository.getItem(key)).toBe('second');
    expect(await repository.getItem(other)).toBe('private');
    expect(await repository.getItem(recovery)).toBe('broken');
    expect(await repository.getLegacyArchive(key)).toBe('first');
  });
  it('archives a source even when the first call is setItem', async () => {
    legacy.set(key, 'unread original'); await repository.setItem(key, 'new');
    expect(await repository.getLegacyArchive(key)).toBe('unread original');
    expect(await repository.getItem(key)).toBe('new');
  });
  it('retains the last committed value when an update rolls back', async () => {
    await repository.setItem(key, 'previous'); fixture.faults.commit = true;
    await expect(repository.setItem(key, 'failed')).rejects.toThrow();
    expect(await repository.getItem(key)).toBe('previous');
  });
  it('retries initialization errors and rejects global/token keys', async () => {
    fixture.faults.initialize = true;
    await expect(repository.getItem(key)).rejects.toThrow('initialization');
    expect(await repository.getItem(key)).toBeNull();
    await expect(repository.setItem('nova-chat-session-token', 'secret')).rejects.toThrow('Not an account');
  });
  it('propagates legacy read failure instead of treating it as an empty account', async () => {
    store.getItem.mockRejectedValueOnce(new Error('CursorWindow'));
    await expect(repository.getItem(key)).rejects.toThrow('CursorWindow');
    expect(fixture.sql.prepare('SELECT count(*) AS n FROM account_snapshots_v1').get()?.n).toBe(0);
  });
  it('keeps a large migration archive and current snapshot across a file-backed database reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nova-snapshot-r2-'));
    const filename = join(directory, 'snapshots.db');
    let disk = testSnapshotDatabase(filename);
    try {
      const raw = JSON.stringify({ text: '历史🙂'.repeat(800_000) });
      legacy.set(key, raw);
      const first = createSqliteSnapshotRepository(async () => disk.db, store);
      expect(await first.getItem(key)).toBe(raw);
      await first.setItem(key, 'latest committed snapshot');
      disk.sql.close();
      disk = testSnapshotDatabase(filename);
      const reopened = createSqliteSnapshotRepository(async () => disk.db, store);
      expect(await reopened.getItem(key)).toBe('latest committed snapshot');
      expect(await reopened.getLegacyArchive(key)).toBe(raw);
      expect(legacy.get(key)).toBe(SQLITE_MIGRATION_MARKER);
    } finally {
      disk.sql.close();
      // Only known files in the uniquely created test directory; no recursive removal.
      for (const suffix of ['', '-wal', '-shm']) {
        rmSync(filename + suffix, { force: true });
      }
      rmdirSync(directory);
    }
  });

});
