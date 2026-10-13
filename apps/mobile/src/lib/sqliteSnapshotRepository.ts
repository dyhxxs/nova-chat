import { retainedArchiveBytes, type ArchiveCleanupResult, type StorageOverview } from './storageMaintenance';

/** Raw account snapshots only. Tokens never enter this database. */
export const SQLITE_MIGRATION_MARKER = 'nova-chat:sqlite:v1';
const MARKER_PREFIX = 'nova-chat:sqlite:';
const ACCOUNT_PREFIX = '@nova-chat/account/v1/';
const RECOVERY_SUFFIX = '/recovery';
export interface SnapshotSqlExecutor {
  getFirstAsync<T>(sql: string, params: string[]): Promise<T | null>;
  runAsync(sql: string, params: string[]): Promise<unknown>;
}
export interface SnapshotDatabase extends SnapshotSqlExecutor {
  execAsync(sql: string): Promise<void>;
  withExclusiveTransactionAsync(task: (tx: SnapshotSqlExecutor) => Promise<void>): Promise<void>;
}
export interface LegacySnapshotStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
}
type Row = { body: string };
const ownerKey = (key: string) => key.endsWith(RECOVERY_SUFFIX) ? key.slice(0, -RECOVERY_SUFFIX.length) : key;

export function createSqliteSnapshotRepository(open: () => Promise<SnapshotDatabase>, legacy: LegacySnapshotStorage) {
  let connection: Promise<SnapshotDatabase> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  function database() {
    if (!connection) connection = open().then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        CREATE TABLE IF NOT EXISTS account_snapshots_v1 (key TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS legacy_archives_v1 (key TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS archive_revisions_v1 (key TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL);
      `);
      return db;
    }).catch((error: unknown) => { connection = undefined; throw error; });
    return connection;
  }
  function serial<T>(key: string, task: (db: SnapshotDatabase) => Promise<T>): Promise<T> {
    if (!key.startsWith(ACCOUNT_PREFIX) || key.length <= ACCOUNT_PREFIX.length) return Promise.reject(new Error('Not an account snapshot key'));
    const result = queue.catch(() => undefined).then(async () => task(await database()));
    queue = result;
    return result;
  }
  function requireBaseKey(key: string) {
    if (key.endsWith(RECOVERY_SUFFIX)) throw new Error('Maintenance requires an account key, not a recovery key');
  }
  async function revise(tx: SnapshotSqlExecutor, key: string) {
    await tx.runAsync('INSERT INTO archive_revisions_v1 (key, revision) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET revision = revision + 1', [ownerKey(key)]);
  }
  async function markMigrated(key: string) {
    // Never rewrite an already verified small marker on each large snapshot save.
    if (await legacy.getItem(key) === SQLITE_MIGRATION_MARKER) return;
    await legacy.setItem(key, SQLITE_MIGRATION_MARKER);
    if (await legacy.getItem(key) !== SQLITE_MIGRATION_MARKER) throw new Error('Migration marker verification failed');
  }
  async function ensureMigrated(db: SnapshotDatabase, key: string): Promise<boolean> {
    // Presence query deliberately does not copy the old full JSON across the native bridge.
    const row = await db.getFirstAsync<{ present: number }>('SELECT 1 AS present FROM account_snapshots_v1 WHERE key = ?', [key]);
    if (row) { await markMigrated(key); return true; }
    const archived = await db.getFirstAsync<{ present: number }>('SELECT 1 AS present FROM legacy_archives_v1 WHERE key = ?', [key]);
    const raw = await legacy.getItem(key);
    if (archived || raw?.startsWith(MARKER_PREFIX)) throw new Error('Migrated snapshot missing; refusing empty restore');
    if (raw === null) return false;
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync('INSERT INTO legacy_archives_v1 (key, body) VALUES (?, ?)', [key, raw]);
      await tx.runAsync('INSERT INTO account_snapshots_v1 (key, body) VALUES (?, ?)', [key, raw]);
      const saved = await tx.getFirstAsync<Row>('SELECT body FROM account_snapshots_v1 WHERE key = ?', [key]);
      const archive = await tx.getFirstAsync<Row>('SELECT body FROM legacy_archives_v1 WHERE key = ?', [key]);
      if (saved?.body !== raw || archive?.body !== raw) throw new Error('Migration verification failed');
      await revise(tx, key);
    });
    // Always after the SQLite commit; failed marker writes preserve the original archive.
    await markMigrated(key);
    return true;
  }
  async function overview(tx: SnapshotSqlExecutor, key: string): Promise<StorageOverview> {
    const sizes = await tx.getFirstAsync<Pick<StorageOverview, 'snapshotBytes' | 'recoveryBytes' | 'migrationBytes' | 'recoveryMigrationBytes'>>(`SELECT
      (SELECT length(CAST(body AS BLOB)) FROM account_snapshots_v1 WHERE key = ?) AS snapshotBytes,
      COALESCE((SELECT length(CAST(body AS BLOB)) FROM account_snapshots_v1 WHERE key = ?), 0) AS recoveryBytes,
      COALESCE((SELECT length(CAST(body AS BLOB)) FROM legacy_archives_v1 WHERE key = ?), 0) AS migrationBytes,
      COALESCE((SELECT length(CAST(body AS BLOB)) FROM legacy_archives_v1 WHERE key = ?), 0) AS recoveryMigrationBytes`,
    [key, key + RECOVERY_SUFFIX, key, key + RECOVERY_SUFFIX]);
    const revision = await tx.getFirstAsync<{ revision: number }>('SELECT revision FROM archive_revisions_v1 WHERE key = ?', [key]);
    return { backend: 'SQLite', snapshotBytes: sizes?.snapshotBytes ?? null, recoveryBytes: sizes?.recoveryBytes ?? 0,
      migrationBytes: sizes?.migrationBytes ?? 0, recoveryMigrationBytes: sizes?.recoveryMigrationBytes ?? 0,
      archiveRevision: revision?.revision ?? 0, cleanupSupported: true };
  }
  return {
    backend: 'SQLite' as const,
    getItem: (key: string) => serial(key, async (db) => {
      if (!await ensureMigrated(db, key)) return null;
      const row = await db.getFirstAsync<Row>('SELECT body FROM account_snapshots_v1 WHERE key = ?', [key]);
      if (!row) throw new Error('Migrated snapshot missing; refusing empty restore');
      return row.body;
    }),
    setItem: (key: string, body: string) => serial(key, async (db) => {
      const existed = await ensureMigrated(db, key);
      await db.withExclusiveTransactionAsync(async (tx) => {
        await tx.runAsync('INSERT INTO account_snapshots_v1 (key, body) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body', [key, body]);
        const saved = await tx.getFirstAsync<Row>('SELECT body FROM account_snapshots_v1 WHERE key = ?', [key]);
        if (saved?.body !== body) throw new Error('Snapshot verification failed');
        if (key.endsWith(RECOVERY_SUFFIX)) await revise(tx, key);
      });
      if (!existed) await markMigrated(key);
    }),
    getLegacyArchive: (key: string) => serial(key, async (db) => (await db.getFirstAsync<Row>('SELECT body FROM legacy_archives_v1 WHERE key = ?', [key]))?.body ?? null),
    getStorageOverview: (key: string) => serial(key, async (db) => {
      requireBaseKey(key);
      await ensureMigrated(db, key);
      // Include old recovery copies too, rather than claiming they occupy no space.
      await ensureMigrated(db, key + RECOVERY_SUFFIX);
      let info!: StorageOverview;
      await db.withExclusiveTransactionAsync(async (tx) => { info = await overview(tx, key); });
      return info;
    }),
    clearArchives: (key: string, expectedRevision: number, isCurrent: () => boolean) => serial(key, async (db): Promise<ArchiveCleanupResult> => {
      requireBaseKey(key);
      const guard = () => { if (!isCurrent()) throw new Error('账号或读取状态已变化，请重新预览。'); };
      guard();
      await ensureMigrated(db, key);
      await ensureMigrated(db, key + RECOVERY_SUFFIX);
      let logicalBytesRemoved = 0;
      await db.withExclusiveTransactionAsync(async (tx) => {
        const info = await overview(tx, key);
        if (!Number.isSafeInteger(expectedRevision) || info.archiveRevision !== expectedRevision) throw new Error('保留档案已变化，请重新预览后确认。');
        if (!info.snapshotBytes) throw new Error('缺少已保存的活动快照，不能清理恢复档案。');
        logicalBytesRemoved = retainedArchiveBytes(info);
        guard();
        await tx.runAsync('DELETE FROM legacy_archives_v1 WHERE key = ? OR key = ?', [key, key + RECOVERY_SUFFIX]);
        // Keep an empty row as a deliberate tombstone. Removing the row while its
        // migration marker remains would block future recovery writes as data loss.
        await tx.runAsync('UPDATE account_snapshots_v1 SET body = ? WHERE key = ?', ['', key + RECOVERY_SUFFIX]);
        await revise(tx, key);
        if (retainedArchiveBytes(await overview(tx, key)) !== 0) throw new Error('档案清理校验失败，已回滚。');
        guard();
      });
      return { logicalBytesRemoved };
    }),
  };
}
