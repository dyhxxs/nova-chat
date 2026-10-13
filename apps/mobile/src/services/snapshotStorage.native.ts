import AsyncStorage from '@react-native-async-storage/async-storage';
import { openDatabaseAsync } from 'expo-sqlite';
import { createSqliteSnapshotRepository } from '../lib/sqliteSnapshotRepository';

// Metro selects this module on Android/iOS. Open lazily after authentication.
export const snapshotStorage = createSqliteSnapshotRepository(
  () => openDatabaseAsync('nova-account-snapshots-v1.db'),
  AsyncStorage,
);
