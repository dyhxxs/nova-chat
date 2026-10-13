export interface StorageOverview {
  backend: 'SQLite' | 'AsyncStorage';
  snapshotBytes: number | null;
  recoveryBytes: number;
  migrationBytes: number;
  recoveryMigrationBytes: number;
  archiveRevision: number;
  cleanupSupported: boolean;
}
export interface ArchiveCleanupResult { logicalBytesRemoved: number }
/** Ephemeral preview. Never persist it or infer that opening a share sheet saved a backup. */
export interface ArchiveCleanupPlan {
  overview: StorageOverview;
  confirm: () => Promise<ArchiveCleanupResult>;
}
export function retainedArchiveBytes(info: StorageOverview): number {
  return info.recoveryBytes + info.migrationBytes + info.recoveryMigrationBytes;
}
export function formatStorageBytes(bytes: number | null): string {
  if (bytes === null) return '尚无已保存快照';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KiB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MiB';
}
