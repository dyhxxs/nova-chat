import { DatabaseSync } from 'node:sqlite';
import type { SnapshotDatabase, SnapshotSqlExecutor } from '../../src/lib/sqliteSnapshotRepository';

/** Real SQL/transactions behind the small Expo async API surface; not a device test. */
export function testSnapshotDatabase(filename = ':memory:') {
  const sql = new DatabaseSync(filename);
  const metrics = { bodyReadBytes: 0, readQueries: 0, writeQueries: 0 };
  const faults = { read: false, writeNumber: 0, commit: false, initialize: false };
  const executor: SnapshotSqlExecutor = {
    getFirstAsync: async <T>(query: string, params: string[]) => {
      if (faults.read) { faults.read = false; throw new Error('injected SQLite read error'); }
      metrics.readQueries++;
      const row = (sql.prepare(query).get(...params) as T | undefined) ?? null;
      const body = (row as { body?: unknown } | null)?.body;
      if (typeof body === 'string') metrics.bodyReadBytes += Buffer.byteLength(body, 'utf8');
      return row;
    },
    runAsync: async (query, params) => {
      if (faults.writeNumber && --faults.writeNumber === 0) throw new Error('injected disk full');
      metrics.writeQueries++;
      return sql.prepare(query).run(...params);
    },
  };
  const db: SnapshotDatabase = {
    ...executor,
    execAsync: async (query) => {
      if (faults.initialize) { faults.initialize = false; throw new Error('injected initialization error'); }
      sql.exec(query);
    },
    withExclusiveTransactionAsync: async (task) => {
      sql.exec('BEGIN EXCLUSIVE');
      try {
        await task(executor);
        if (faults.commit) { faults.commit = false; throw new Error('injected commit error'); }
        sql.exec('COMMIT');
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
  return { sql, db, faults, metrics };
}
