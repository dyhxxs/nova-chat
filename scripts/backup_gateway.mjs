import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FORMAT_VERSION = 1;
const SUPPORTED_DATABASE_SCHEMA_VERSION = 1;
const REQUIRED_TABLES = [
  'users',
  'sessions',
  'provider_settings',
  'files',
  'audit_log',
  'knowledge_documents',
  'knowledge_index',
];

function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function pathExists(target) {
  try { await stat(target); return true; } catch { return false; }
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function normalizedStoragePath(value) {
  const candidate = String(value ?? '').trim();
  if (!candidate) throw new Error('database contains an empty attachment path');
  const slash = candidate.replaceAll('\\', '/');
  const looksAbsolute = path.isAbsolute(candidate) || /^\/[\s\S]/.test(slash) || /^[A-Za-z]:\//.test(slash);
  if (looksAbsolute) {
    const basename = slash.split('/').filter(Boolean).at(-1);
    if (!basename || basename === '.' || basename === '..') throw new Error('database contains an invalid absolute attachment path');
    return basename;
  }

  const relative = slash.replace(/^\.\//, '').replace(/^uploads\//, '');
  const parts = relative.split('/');
  if (!relative || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`database contains an unsafe attachment path: ${candidate}`);
  }
  return parts.join('/');
}

function backupFilePath(uploadsDir, storedPath) {
  const relative = normalizedStoragePath(storedPath);
  const resolved = path.resolve(uploadsDir, ...relative.split('/'));
  if (!isWithin(uploadsDir, resolved)) throw new Error(`attachment path escapes uploads directory: ${storedPath}`);
  return resolved;
}

async function copyTree(source, destination) {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`refusing to back up symbolic link: ${sourcePath}`);
    if (entry.isDirectory()) await copyTree(sourcePath, destinationPath);
    else if (entry.isFile()) await copyFile(sourcePath, destinationPath);
    else throw new Error(`refusing to back up unsupported upload entry: ${sourcePath}`);
  }
}

async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const currentPath = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`refusing to verify symbolic link: ${currentPath}`);
    if (entry.isDirectory()) files.push(...await listFiles(root, currentPath));
    else if (entry.isFile()) {
      const details = await stat(currentPath);
      files.push({ path: path.relative(root, currentPath).split(path.sep).join('/'), bytes: details.size });
    } else throw new Error(`refusing to verify unsupported upload entry: ${currentPath}`);
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function hashUploadFiles(uploadsDir, files) {
  return Promise.all(files.map(async (file) => ({
    path: file.path,
    bytes: file.bytes,
    sha256: await sha256File(path.join(uploadsDir, ...file.path.split('/'))),
  })));
}

function inspectDatabase(databasePath, uploadsDir, rewritePaths) {
  const db = new DatabaseSync(databasePath);
  let transactionOpen = false;
  try {
    db.exec('PRAGMA foreign_keys=ON;');
    if (rewritePaths) {
      db.exec('BEGIN IMMEDIATE');
      transactionOpen = true;
    }

    const rows = db.prepare('SELECT id,storage_path,size FROM files').all();
    const update = rewritePaths ? db.prepare('UPDATE files SET storage_path=? WHERE id=?') : undefined;
    for (const row of rows) {
      const portable = normalizedStoragePath(row.storage_path);
      if (rewritePaths && portable !== row.storage_path) update.run(portable, row.id);
    }
    if (transactionOpen) {
      db.exec('COMMIT');
      transactionOpen = false;
    }

    const integrity = db.prepare('PRAGMA integrity_check').get()?.integrity_check;
    if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity ?? 'unknown result'}`);
    const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeys.length) throw new Error(`SQLite foreign key check found ${foreignKeys.length} violation(s)`);

    const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all();
    const tables = new Set(tableRows.map((row) => row.name));
    for (const required of REQUIRED_TABLES) {
      if (!tables.has(required)) throw new Error(`SQLite backup is missing required table: ${required}`);
    }

    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
    if (version > SUPPORTED_DATABASE_SCHEMA_VERSION) {
      throw new Error(`SQLite schema version ${version} is newer than this backup tool supports (${SUPPORTED_DATABASE_SCHEMA_VERSION})`);
    }
    return { version, fileRows: rows.map((row) => ({ path: normalizedStoragePath(row.storage_path), bytes: Number(row.size) })) };
  } catch (error) {
    if (transactionOpen) db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}

async function validateBackupDirectory(backupDir, { rewritePaths = false } = {}) {
  const databasePath = path.join(backupDir, 'nova-chat.sqlite');
  const uploadsDir = path.join(backupDir, 'uploads');
  if (!(await pathExists(databasePath))) throw new Error(`backup is missing ${databasePath}`);
  if (!(await pathExists(uploadsDir))) await mkdir(uploadsDir, { recursive: true });

  const database = inspectDatabase(databasePath, uploadsDir, rewritePaths);
  let missingFiles = 0;
  let declaredBytes = 0;
  for (const file of database.fileRows) {
    const filePath = backupFilePath(uploadsDir, file.path);
    try {
      const details = await stat(filePath);
      if (!details.isFile()) throw new Error('not a regular file');
      if (details.size !== file.bytes) throw new Error(`expected ${file.bytes} bytes, got ${details.size}`);
      declaredBytes += details.size;
    } catch (error) {
      missingFiles += 1;
      throw new Error(`attachment ${file.path} failed validation: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  const uploadFiles = await listFiles(uploadsDir);
  const uploadBytes = uploadFiles.reduce((total, file) => total + file.bytes, 0);
  const uploadEntries = await hashUploadFiles(uploadsDir, uploadFiles);
  return {
    schemaVersion: database.version,
    databaseFiles: database.fileRows.length,
    declaredAttachmentBytes: declaredBytes,
    missingFiles,
    uploadFiles: uploadFiles.length,
    uploadBytes,
    uploadEntries,
  };
}

function manifestFor(summary, databaseDetails, createdAt) {
  return {
    formatVersion: FORMAT_VERSION,
    createdAt,
    schemaVersion: summary.schemaVersion,
    database: {
      file: 'nova-chat.sqlite',
      bytes: databaseDetails.size,
      sha256: databaseDetails.sha256,
    },
    uploads: {
      files: summary.uploadFiles,
      bytes: summary.uploadBytes,
      entries: summary.uploadEntries,
    },
    checks: {
      sqliteIntegrity: 'ok',
      foreignKeys: 0,
      databaseAttachments: summary.databaseFiles,
    },
  };
}

export async function backupGatewayData({ dataDir, outputDir }) {
  const sourceDir = path.resolve(dataDir);
  const destination = path.resolve(outputDir);
  if (isWithin(sourceDir, destination) || isWithin(destination, sourceDir)) {
    throw new Error('backup destination must not overlap DATA_DIR; use a separate disk or directory');
  }
  if (await pathExists(destination)) throw new Error(`backup destination already exists: ${destination}`);

  const sourceDatabase = path.join(sourceDir, 'nova-chat.sqlite');
  const sourceUploads = path.join(sourceDir, 'uploads');
  if (!(await pathExists(sourceDatabase))) throw new Error(`database not found: ${sourceDatabase}`);
  if (!(await pathExists(sourceUploads))) throw new Error(`uploads directory not found: ${sourceUploads}`);

  const partial = `${destination}.partial-${randomUUID()}`;
  await mkdir(partial, { recursive: true });
  try {
    const targetDatabase = path.join(partial, 'nova-chat.sqlite');
    const source = new DatabaseSync(sourceDatabase);
    try {
      source.exec('PRAGMA busy_timeout=10000');
      source.exec(`VACUUM INTO ${sqlString(targetDatabase)}`);
    } finally {
      source.close();
    }
    await copyTree(sourceUploads, path.join(partial, 'uploads'));

    // This also makes backups from pre-schema-1 installations portable. The
    // original database is never modified.
    const summary = await validateBackupDirectory(partial, { rewritePaths: true });
    const databaseDetails = await stat(targetDatabase);
    const createdAt = new Date().toISOString();
    const manifest = manifestFor(summary, { size: databaseDetails.size, sha256: await sha256File(targetDatabase) }, createdAt);
    await writeFile(path.join(partial, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await rename(partial, destination);
    return { backupDir: destination, ...manifest };
  } catch (error) {
    await rm(partial, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function verifyBackup(backupDir) {
  const destination = path.resolve(backupDir);
  const manifestPath = path.join(destination, 'manifest.json');
  if (!(await pathExists(manifestPath))) throw new Error(`backup is missing ${manifestPath}`);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.formatVersion !== FORMAT_VERSION) throw new Error(`unsupported backup format: ${manifest.formatVersion}`);

  const summary = await validateBackupDirectory(destination);
  const databasePath = path.join(destination, 'nova-chat.sqlite');
  const databaseDetails = await stat(databasePath);
  const actualSha256 = await sha256File(databasePath);
  if (databaseDetails.size !== manifest.database?.bytes || actualSha256 !== manifest.database?.sha256) {
    throw new Error('backup manifest does not match the SQLite file');
  }
  if (summary.uploadFiles !== manifest.uploads?.files || summary.uploadBytes !== manifest.uploads?.bytes) {
    throw new Error('backup manifest does not match the uploads directory');
  }
  if (JSON.stringify(summary.uploadEntries) !== JSON.stringify(manifest.uploads?.entries)) {
    throw new Error('backup manifest does not match attachment hashes');
  }
  return { backupDir: destination, ...summary, verified: true };
}

export async function restoreGatewayData({ backupDir, dataDir }) {
  const source = path.resolve(backupDir);
  const destination = path.resolve(dataDir);
  if (isWithin(source, destination) || isWithin(destination, source)) {
    throw new Error('restore DATA_DIR must not overlap the backup directory');
  }
  if (await pathExists(destination)) throw new Error(`restore DATA_DIR must not already exist: ${destination}`);

  await verifyBackup(source);
  const parent = path.dirname(destination);
  const partial = `${destination}.partial-${randomUUID()}`;
  await mkdir(partial, { recursive: true });
  try {
    await copyFile(path.join(source, 'nova-chat.sqlite'), path.join(partial, 'nova-chat.sqlite'));
    await copyTree(path.join(source, 'uploads'), path.join(partial, 'uploads'));
    const summary = await validateBackupDirectory(partial);
    await mkdir(parent, { recursive: true });
    await rename(partial, destination);
    return { dataDir: destination, restored: true, ...summary };
  } catch (error) {
    await rm(partial, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(args) {
  if (args.includes('--verify')) {
    const backupDir = option(args, '--backup-dir') ?? option(args, '--output-dir');
    if (!backupDir) throw new Error('usage: npm run gateway:backup:verify -- --backup-dir <directory>');
    console.log(JSON.stringify(await verifyBackup(backupDir), null, 2));
    return;
  }
  if (args.includes('--restore')) {
    const backupDir = option(args, '--backup-dir');
    const dataDir = option(args, '--data-dir');
    if (!backupDir || !dataDir) throw new Error('usage: npm run gateway:backup:restore -- --backup-dir <directory> --data-dir <new-DATA_DIR>');
    console.log(JSON.stringify(await restoreGatewayData({ backupDir, dataDir }), null, 2));
    return;
  }
  const dataDir = option(args, '--data-dir');
  const outputDir = option(args, '--output-dir');
  if (!dataDir || !outputDir) throw new Error('usage: npm run gateway:backup -- --data-dir <DATA_DIR> --output-dir <backup-directory>');
  console.log(JSON.stringify(await backupGatewayData({ dataDir, outputDir }), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`gateway backup failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });
}
