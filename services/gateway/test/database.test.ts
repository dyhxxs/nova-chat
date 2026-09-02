import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { AppDatabase } from '../src/database.js';

const temporaryDirectories: string[] = [];
const databases: AppDatabase[] = [];

async function createDatabase() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'nova-chat-database-test-'));
  temporaryDirectories.push(dataDir);
  const database = new AppDatabase(loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    SERVER_MASTER_KEY: 'database-test-master-key-that-is-never-used-in-production',
  }));
  databases.push(database);
  return { database, dataDir };
}

afterEach(async () => {
  while (databases.length) databases.pop()?.close();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('AppDatabase', () => {
  it('creates users, verifies normalized credentials, and never exposes password material', async () => {
    const { database } = await createDatabase();
    const created = database.createUser({
      email: '  FRIEND@Example.com ',
      password: 'correct horse battery staple',
      displayName: 'Friend',
    });

    expect(created.email).toBe('friend@example.com');
    expect(database.verifyCredentials('friend@example.com', 'wrong password')).toBeUndefined();
    expect(database.verifyCredentials('FRIEND@example.com', 'correct horse battery staple')?.id).toBe(created.id);

    const users = database.listUsers();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: created.id, email: 'friend@example.com', displayName: 'Friend', role: 'user' });
    expect(users[0]).not.toHaveProperty('passwordHash');
    expect(users[0]).not.toHaveProperty('password_hash');
    expect(users[0]).not.toHaveProperty('passwordSalt');
    expect(users[0]).not.toHaveProperty('password_salt');
  });

  it('stores only hashed session tokens and revokes sessions when a user is disabled', async () => {
    const { database, dataDir } = await createDatabase();
    const user = database.createUser({ email: 'user@example.com', password: 'a very secure password', displayName: 'User' });
    const session = database.createSession(user.id, 'device-database-test');

    expect(database.authenticate(session.token)).toMatchObject({ id: user.id, sessionId: expect.any(String) });
    const files = await readdir(dataDir, { withFileTypes: true });
    const rawBeforeDisable = Buffer.concat(await Promise.all(files.filter((entry) => entry.isFile()).map((entry) => readFile(path.join(dataDir, entry.name))))).toString('utf8');
    expect(rawBeforeDisable).not.toContain(session.token);

    database.updateUser(user.id, { disabled: true }, user.id);
    expect(database.authenticate(session.token)).toBeUndefined();
    expect(database.verifyCredentials(user.email, 'a very secure password')).toBeUndefined();
  });

  it('encrypts provider keys at rest and returns only a masked public view', async () => {
    const { database, dataDir } = await createDatabase();
    const admin = database.createUser({ email: 'admin@example.com', password: 'a very secure admin password', displayName: 'Admin', role: 'admin' });
    const apiKey = 'third-party-secret-key-should-never-be-plain-text';

    const publicSettings = database.updateProviderSettings({
      apiBaseUrl: 'https://provider.example/v1',
      apiKey,
      apiMode: 'responses',
      authMode: 'bearer',
      defaultModel: 'gpt-5.6-sol',
      allowedModels: ['gpt-5.6-sol'],
    }, admin.id);

    expect(database.getProviderSettings().apiKey).toBe(apiKey);
    expect(publicSettings).toMatchObject({ apiKeySet: true, apiKeyPreview: `••••${apiKey.slice(-4)}` });
    expect(publicSettings).not.toHaveProperty('apiKey');
    expect(database.getPublicProviderSettings()).not.toHaveProperty('apiKey');

    database.close();
    databases.splice(databases.indexOf(database), 1);
    const files = await readdir(dataDir, { withFileTypes: true });
    const rawDatabase = Buffer.concat(await Promise.all(files.filter((entry) => entry.isFile()).map((entry) => readFile(path.join(dataDir, entry.name))))).toString('utf8');
    expect(rawDatabase).not.toContain(apiKey);
  });
});


