import { DatabaseSync } from 'node:sqlite';
import { COMPANION_DEFAULT_PERSONALITY, COMPANION_DEFAULT_SPEAKING_STYLE, COMPANION_DEFAULT_PERSONA_PROMPT } from '@nova-chat/protocol';
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
  it('upgrades exact old defaults on read while preserving stored custom profiles and appearance', async () => {
    const { database, dataDir } = await createDatabase();
    const owner = database.createUser({ email: 'persona@qa.local', password: 'temporary-test-password', displayName: 'QA' });
    const oldPersonality = ['成年、温暖又有主见，亲近但不过分迎合，偶尔会轻轻开玩笑。', '喜欢音乐、散步和琢磨好吃的，有日常的小爱好，也会表达自己的偏好。', '关心对方说过的小事；先接住当下的话题，不急着说教或给解决方案。'];
    const oldStyle = ['像熟悉的人发消息，口语、轻松；日常通常一到三句，一小段就好。', '直接接话，少用套话、总结和客套话；不把每次回复都变成提问。', '沿用对话里的场景和细节，偶尔用一个表情，有需要时再认真展开。'];
    const legacy = database.createCompanion(owner.id, { name: '小光', personality: oldPersonality, speakingStyle: oldStyle, appearance: '成年短发', memories: ['喜欢下雨天'], memoryEnabled: true });
    const initial = database.createCompanion(owner.id, { personality: ['温柔、耐心、细腻，有真实对话感。', '对用户的经历保持好奇，但不盘问、不窥探。', '可以轻微俏皮，但不油腻、不夸张、不持续卖萌。', '优先理解用户当下的感受，再决定是否提供建议。'], speakingStyle: ['默认使用自然、简洁的中文；除非用户要求，否则不要写成长篇文章。', '一次最多提出一个自然的追问，让用户容易继续表达。', '避免机械重复“我理解你的感受”；要结合用户具体内容回应。', '可以偶尔使用一个合适的表情，但不要每句话都使用表情。'], appearance: '成年齐肩发' });
    expect(database.getCompanion(owner.id, initial.id)).toMatchObject({ personality: [...COMPANION_DEFAULT_PERSONALITY], speakingStyle: [...COMPANION_DEFAULT_SPEAKING_STYLE], appearance: '成年齐肩发' });
    const customPersonality = [...oldPersonality, '40岁的木匠，不爱开玩笑。'];
    const custom = database.createCompanion(owner.id, { personality: customPersonality, speakingStyle: ['说话干脆，别安慰。'] });
    expect(database.getCompanion(owner.id, legacy.id)).toMatchObject({ name: '小光', personality: [...COMPANION_DEFAULT_PERSONALITY], speakingStyle: [...COMPANION_DEFAULT_SPEAKING_STYLE], appearance: '成年短发', memories: ['喜欢下雨天'], memoryEnabled: true });
    expect(database.getCompanion(owner.id, custom.id)).toMatchObject({ personality: customPersonality, speakingStyle: ['说话干脆，别安慰。'] });
    const stored = new DatabaseSync(path.join(dataDir, 'nova-chat.sqlite'));
    try {
      expect(stored.prepare('SELECT personality_json, speaking_style_json FROM companion_profiles WHERE id=?').get(legacy.id)).toEqual({ personality_json: JSON.stringify(oldPersonality), speaking_style_json: JSON.stringify(oldStyle) });
    } finally { stored.close(); }
    database.updateCompanion(owner.id, legacy.id, { name: '光光' });
    expect(database.getCompanion(owner.id, legacy.id)).toMatchObject({ name: '光光', personality: [...COMPANION_DEFAULT_PERSONALITY], appearance: '成年短发', memories: ['喜欢下雨天'] });
    expect(database.getCompanion(owner.id, custom.id)).toMatchObject({ personality: customPersonality });
  });

  it('keeps stored v4 profiles unchanged when reading the new default and patching only a name', async () => {
    const { database, dataDir } = await createDatabase();
    const owner = database.createUser({ email: 'v4@qa.local', password: 'temporary-test-password', displayName: 'QA' });
    const personality = [
  '成年角色，做视觉设计，性格慢热；熟悉以后会更放松，但有自己的生活，不总围着对方转。',
  '喜欢旧书店、老电影原声和不太甜的拿铁；会直接说喜欢、不喜欢和不知道，不为了讨好对方改口。',
  '心软但有主见，关心人会记得对方说过的小事。对方只是聊天时就一起聊，不自动安慰、说教或安排解决方案。',
];
    const speakingStyle = [
  '日常用简体中文，像手机上给朋友回消息：直接、口语、有自己的反应。默认一句话，必要时两句；用户要求详细时再展开。',
  '先直接回答用户问的事，不复述整句话，不套“听起来你……”“你已经很棒了”“我会一直陪着你”等话。不要刻意卖萌、堆语气词或每条加表情。',
  '不把普通聊天写成小说、情绪咨询或客服话术；不用文学化比喻、完整环境描写、长段内心独白或括号动作。',
  '沿用对话里已经出现的场景和小事。没有明确场景时，不为了显得生动而添加地点、光线、音乐、天气、书或饮料等道具。',
];
    const profile = database.createCompanion(owner.id, { name: 'Lumi', personality, speakingStyle, appearance: '自定义齐肩发', memories: ['周五面试'], memoryEnabled: true });
    database.updateCompanion(owner.id, profile.id, { name: '小光' });
    expect(database.getCompanion(owner.id, profile.id)).toMatchObject({ name: '小光', personality: [...COMPANION_DEFAULT_PERSONALITY], speakingStyle: [...COMPANION_DEFAULT_SPEAKING_STYLE], appearance: '自定义齐肩发', memories: ['周五面试'], memoryEnabled: true });
    const stored = new DatabaseSync(path.join(dataDir, 'nova-chat.sqlite'));
    try {
      expect(stored.prepare('SELECT personality_json, speaking_style_json FROM companion_profiles WHERE id=?').get(profile.id)).toEqual({ personality_json: JSON.stringify(personality), speaking_style_json: JSON.stringify(speakingStyle) });
    } finally { stored.close(); }
    const customPersonality = ['35岁的男烘焙师，喜欢摇滚。'];
    database.updateCompanion(owner.id, profile.id, { personality: customPersonality });
    expect(database.getCompanion(owner.id, profile.id)).toMatchObject({ personality: customPersonality, speakingStyle: [...COMPANION_DEFAULT_SPEAKING_STYLE] });
    const afterPatch = new DatabaseSync(path.join(dataDir, 'nova-chat.sqlite'));
    try {
      expect(afterPatch.prepare('SELECT personality_json, speaking_style_json FROM companion_profiles WHERE id=?').get(profile.id)).toEqual({ personality_json: JSON.stringify(customPersonality), speaking_style_json: JSON.stringify(speakingStyle) });
    } finally { afterPatch.close(); }
  });

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

  it('creates an isolated default companion and persists profile updates', async () => {
    const { database } = await createDatabase();
    const first = database.createUser({ email: 'first@example.com', password: 'first password 12345', displayName: 'First' });
    const second = database.createUser({ email: 'second@example.com', password: 'second password 12345', displayName: 'Second' });

    const firstCompanions = database.listCompanions(first.id);
    const secondCompanions = database.listCompanions(second.id);
    expect(firstCompanions).toHaveLength(2);
    expect(secondCompanions).toHaveLength(2);
    const firstCompanion = firstCompanions.find(p => p.name === 'Lumi')!;
    const secondCompanion = secondCompanions.find(p => p.name === 'Lumi')!;
    expect(firstCompanion).toMatchObject({ name: 'Lumi', templateId: 'cyber-companion-v1' });
    expect(firstCompanion.id).not.toBe(secondCompanion.id);
    expect(database.getCompanion(second.id, firstCompanion.id)).toBeUndefined();

    const updated = database.updateCompanion(first.id, firstCompanion.id, {
      name: '小光',
      personality: ['温柔', '有一点俏皮'],
      speakingStyle: ['简洁', '一次只问一个问题'],
      relationshipStage: 'familiar',
      memoryEnabled: true,
      memories: ['用户喜欢雨天散步。'],
    });
    expect(updated).toMatchObject({
      id: firstCompanion.id,
      name: '小光',
      relationshipStage: 'familiar',
      memoryEnabled: true,
      memories: ['用户喜欢雨天散步。'],
    });

    expect(database.deleteCompanion(first.id, firstCompanion.id)).toBe(true);
    expect(database.getCompanion(first.id, firstCompanion.id)).toBeUndefined();
    const recreated = database.listCompanions(first.id);
    expect(recreated).toHaveLength(1);
    expect(recreated[0]!.name).toBe('沈知意');
  });

  it('encrypts provider keys at rest and returns only secret-free configuration status', async () => {
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
    expect(publicSettings).toMatchObject({ apiKeySet: true, apiBaseUrlSet: true });
    expect(publicSettings).not.toHaveProperty('apiKeyPreview');
    expect(publicSettings.apiBaseUrl).toBe('');
    expect(JSON.stringify(publicSettings)).not.toContain(apiKey.slice(-4));
    expect(publicSettings).not.toHaveProperty('apiKey');
    expect(database.getPublicProviderSettings()).not.toHaveProperty('apiKey');

    database.close();
    databases.splice(databases.indexOf(database), 1);
    const files = await readdir(dataDir, { withFileTypes: true });
    const rawDatabase = Buffer.concat(await Promise.all(files.filter((entry) => entry.isFile()).map((entry) => readFile(path.join(dataDir, entry.name))))).toString('utf8');
    expect(rawDatabase).not.toContain(apiKey);
  });
});




describe('persisted persona prompts and built-in installation', () => {
  it('installs Shen once, preserves user edits and does not recreate her after deletion', async () => {
    const { database, dataDir } = await createDatabase();
    const user = database.createUser({ email: 'templates@qa.local', password: 'temporary-test-password', displayName: 'QA' });
    const first = database.listCompanions(user.id);
    const shen = first.find(profile => profile.templateId === 'shen-zhiyi-v1')!;
    expect(shen.personaPrompt).toContain('【炸毛机制】');
    expect(shen.personaPrompt).toContain('【示范：下意识露软】');
    expect(first.find(profile => profile.name === 'Lumi')?.personaPrompt).toBe(COMPANION_DEFAULT_PERSONA_PROMPT);
    database.updateCompanion(user.id, shen.id, { name: '知意', personaPrompt: '你是知意。用户修改的完整人设。' });
    expect(database.listCompanions(user.id).find(profile => profile.id === shen.id)?.personaPrompt).toBe('你是知意。用户修改的完整人设。');
    expect(database.listCompanions(user.id)).toHaveLength(2);
    database.close(); databases.splice(databases.indexOf(database), 1);
    const restarted = new AppDatabase(loadConfig({ NODE_ENV: 'test', DATA_DIR: dataDir, SERVER_MASTER_KEY: 'database-test-master-key-that-is-never-used-in-production' }));
    databases.push(restarted);
    expect(restarted.listCompanions(user.id).find(profile => profile.id === shen.id)?.name).toBe('知意');
    expect(restarted.deleteCompanion(user.id, shen.id)).toBe(true);
    expect(restarted.listCompanions(user.id)).toHaveLength(1);
    expect(restarted.listCompanions(user.id).some(profile => profile.templateId === 'shen-zhiyi-v1')).toBe(false);
  });
  it('keeps a full multiline prompt through partial patches and separates it from custom legacy text', async () => {
    const { database } = await createDatabase();
    const user = database.createUser({ email: 'prompt@qa.local', password: 'temporary-test-password', displayName: 'QA' });
    const personaPrompt = '你是阿川。\n【性格】\n35岁烘焙师，直接、少话。\n【示范】\n用户：忙吗？\n阿川：刚出炉，等会儿。';
    const profile = database.createCompanion(user.id, { name: '阿川', personality: ['35岁烘焙师'], speakingStyle: ['直接'], personaPrompt });
    expect(profile.personaPrompt).toBe(personaPrompt);
    expect(database.updateCompanion(user.id, profile.id, { name: '川', userName: '小李' })?.personaPrompt).toBe(personaPrompt);
    expect(database.updateCompanion(user.id, profile.id, { personaPrompt: '' })?.personaPrompt).toBe('');
    const custom = database.createCompanion(user.id, { personality: ['40岁木匠'], speakingStyle: ['只用粤语'] });
    expect(custom.personaPrompt).toBe('');
  });

  it('stores attachment paths relative to uploads and returns portable absolute paths', async () => {
    const { database, dataDir } = await createDatabase();
    const user = database.createUser({ email: 'paths@qa.local', password: 'temporary-test-password', displayName: 'QA' });
    const fileId = 'portable-file';
    const absolutePath = path.join(database.uploadsDir, `${fileId}.txt`);
    await import('node:fs/promises').then(({ writeFile }) => writeFile(absolutePath, 'portable'));
    const stored = database.createFile({ id: fileId, userId: user.id, name: 'file.txt', mimeType: 'text/plain', size: 8, kind: 'document', storagePath: absolutePath });
    expect(stored.storagePath).toBe(absolutePath);
    expect(database.getFile(fileId)?.storagePath).toBe(absolutePath);

    const raw = new DatabaseSync(path.join(dataDir, 'nova-chat.sqlite'));
    try {
      expect(raw.prepare('SELECT storage_path FROM files WHERE id=?').get(fileId)).toEqual({ storage_path: `${fileId}.txt` });
      expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
    } finally { raw.close(); }
  });

  it('migrates legacy absolute attachment paths when reopening a database', async () => {
    const { database, dataDir } = await createDatabase();
    const user = database.createUser({ email: 'legacy-paths@qa.local', password: 'temporary-test-password', displayName: 'QA' });
    const fileId = 'legacy-file';
    const absolutePath = path.join(database.uploadsDir, `${fileId}.txt`);
    await import('node:fs/promises').then(({ writeFile }) => writeFile(absolutePath, 'legacy'));
    database.createFile({ id: fileId, userId: user.id, name: 'legacy.txt', mimeType: 'text/plain', size: 6, kind: 'document', storagePath: absolutePath });
    const raw = new DatabaseSync(path.join(dataDir, 'nova-chat.sqlite'));
    raw.prepare('UPDATE files SET storage_path=? WHERE id=?').run(absolutePath, fileId);
    raw.exec('PRAGMA user_version=0');
    raw.close();
    database.close();
    databases.splice(databases.indexOf(database), 1);

    const reopened = new AppDatabase(loadConfig({ NODE_ENV: 'test', DATA_DIR: dataDir, SERVER_MASTER_KEY: 'database-test-master-key-that-is-never-used-in-production' }));
    databases.push(reopened);
    expect(reopened.getFile(fileId)?.storagePath).toBe(absolutePath);
    const migrated = new DatabaseSync(path.join(dataDir, 'nova-chat.sqlite'));
    try {
      expect(migrated.prepare('SELECT storage_path FROM files WHERE id=?').get(fileId)).toEqual({ storage_path: `${fileId}.txt` });
      expect(migrated.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
    } finally { migrated.close(); }
  });

  it('rejects a database schema newer than the gateway before attempting migrations', async () => {
    const { database, dataDir } = await createDatabase();
    database.close();
    databases.splice(databases.indexOf(database), 1);
    const raw = new DatabaseSync(path.join(dataDir, 'nova-chat.sqlite'));
    raw.exec('PRAGMA user_version=99');
    raw.close();
    expect(() => new AppDatabase(loadConfig({ NODE_ENV: 'test', DATA_DIR: dataDir, SERVER_MASTER_KEY: 'database-test-master-key-that-is-never-used-in-production' })))
      .toThrow('newer than this Gateway supports');
  });
});
