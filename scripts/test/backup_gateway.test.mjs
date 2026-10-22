import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { backupGatewayData, restoreGatewayData, verifyBackup } from '../backup_gateway.mjs';

const temporaryDirectories = [];

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'nova-gateway-backup-test-'));
  temporaryDirectories.push(root);
  const dataDir = path.join(root, 'data');
  const uploadsDir = path.join(dataDir, 'uploads');
  await mkdir(uploadsDir, { recursive: true });
  const attachmentPath = path.join(uploadsDir, 'fixture.txt');
  await writeFile(attachmentPath, 'abc');

  const database = new DatabaseSync(path.join(dataDir, 'nova-chat.sqlite'));
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id));
    CREATE TABLE provider_settings (id INTEGER PRIMARY KEY);
    CREATE TABLE files (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), storage_path TEXT NOT NULL, size INTEGER NOT NULL);
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE knowledge_documents (id TEXT PRIMARY KEY);
    CREATE TABLE knowledge_index (id TEXT PRIMARY KEY);
  `);
  database.prepare('INSERT INTO users(id) VALUES(?)').run('user-1');
  database.prepare('INSERT INTO files(id,user_id,storage_path,size) VALUES(?,?,?,?)').run('file-1', 'user-1', attachmentPath, 3);
  database.exec('PRAGMA user_version=1');
  database.close();
  return { root, dataDir, attachmentPath };
}

test.afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test('creates a portable SQLite plus uploads backup and verifies it after relocation', async () => {
  const { root, dataDir, attachmentPath } = await createFixture();
  const backupDir = path.join(root, 'backup');
  const result = await backupGatewayData({ dataDir, outputDir: backupDir });
  assert.equal(result.uploads.files, 1);
  assert.equal(result.uploads.bytes, 3);

  const source = new DatabaseSync(path.join(dataDir, 'nova-chat.sqlite'));
  assert.equal(source.prepare('SELECT storage_path FROM files WHERE id=?').get('file-1').storage_path, attachmentPath);
  source.close();

  const backup = new DatabaseSync(path.join(backupDir, 'nova-chat.sqlite'));
  assert.equal(backup.prepare('SELECT storage_path FROM files WHERE id=?').get('file-1').storage_path, 'fixture.txt');
  backup.close();

  const verified = await verifyBackup(backupDir);
  assert.equal(verified.verified, true);
  assert.equal(verified.databaseFiles, 1);

  const manifest = JSON.parse(await readFile(path.join(backupDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.checks.sqliteIntegrity, 'ok');
  assert.equal(manifest.checks.foreignKeys, 0);
  assert.equal(manifest.uploads.entries[0].path, 'fixture.txt');
  assert.equal(manifest.uploads.entries[0].sha256.length, 64);
});

test('rejects overlapping backup destinations and leaves no partial backup', async () => {
  const { dataDir } = await createFixture();
  await assert.rejects(
    backupGatewayData({ dataDir, outputDir: path.join(dataDir, 'backup') }),
    /must not overlap DATA_DIR/,
  );
});

test('rejects a database schema newer than the backup tool', async () => {
  const { root, dataDir } = await createFixture();
  const database = new DatabaseSync(path.join(dataDir, 'nova-chat.sqlite'));
  database.exec('PRAGMA user_version=99');
  database.close();
  await assert.rejects(
    backupGatewayData({ dataDir, outputDir: path.join(root, 'backup') }),
    /newer than this backup tool supports/,
  );
});

test('restores a verified backup into a new data directory', async () => {
  const { root, dataDir } = await createFixture();
  const backupDir = path.join(root, 'backup');
  const restoredDir = path.join(root, 'restored-data');
  await backupGatewayData({ dataDir, outputDir: backupDir });
  const result = await restoreGatewayData({ backupDir, dataDir: restoredDir });
  assert.equal(result.restored, true);
  assert.equal(result.uploadFiles, 1);
  const restored = new DatabaseSync(path.join(restoredDir, 'nova-chat.sqlite'));
  assert.equal(restored.prepare('SELECT storage_path FROM files WHERE id=?').get('file-1').storage_path, 'fixture.txt');
  restored.close();
  assert.equal(await readFile(path.join(restoredDir, 'uploads', 'fixture.txt'), 'utf8'), 'abc');
});

test('detects an attachment replacement even when its byte length is unchanged', async () => {
  const { root, dataDir } = await createFixture();
  const backupDir = path.join(root, 'backup');
  await backupGatewayData({ dataDir, outputDir: backupDir });
  await writeFile(path.join(backupDir, 'uploads', 'fixture.txt'), 'xyz');
  await assert.rejects(verifyBackup(backupDir), /attachment hashes/);
});
