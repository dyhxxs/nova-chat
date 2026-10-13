import AsyncStorage from '@react-native-async-storage/async-storage';

import { utf8Bytes } from '../lib/conversationBackup';
import type { StorageOverview, ArchiveCleanupResult } from '../lib/storageMaintenance';

// Web retains the existing backend; no experimental SQLite/WASM dependency.
export const snapshotStorage = {
  backend: 'AsyncStorage' as StorageOverview['backend'],
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, body: string) => AsyncStorage.setItem(key, body),
  getStorageOverview: async (key: string): Promise<StorageOverview> => {
    const raw = await AsyncStorage.getItem(key);
    const recovery = await AsyncStorage.getItem(key + '/recovery');
    return { backend: 'AsyncStorage', snapshotBytes: raw === null ? null : utf8Bytes(raw), recoveryBytes: utf8Bytes(recovery ?? ''),
      migrationBytes: 0, recoveryMigrationBytes: 0, archiveRevision: 0, cleanupSupported: false };
  },
  clearArchives: async (...args: [string, number, () => boolean]): Promise<ArchiveCleanupResult> => {
    void args;
    throw new Error('Web 存储不提供跨标签页原子清理，已禁用档案删除；请保留副本。');
  },
  getLegacyArchive: async (...args: [string]): Promise<string | null> => { void args; return null; },
};
