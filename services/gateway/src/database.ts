import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from './config.js';

export type UserRole = 'admin' | 'user';
export type UserRecord = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  disabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number;
  avatarFileId?: string;
};
export type SessionPrincipal = UserRecord & { sessionId: string };
export type ProviderSettings = {
  apiBaseUrl: string;
  apiKey: string;
  apiMode: 'responses' | 'chat-completions';
  authMode: 'bearer' | 'api-key' | 'none';
  defaultModel: string;
  allowedModels: string[];
  updatedAt?: number;
};
export type PublicProviderSettings = Omit<ProviderSettings, 'apiKey'> & { apiKeySet: boolean; apiKeyPreview: string };
export type StoredFile = {
  id: string;
  userId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: 'image' | 'document';
  storagePath: string;
  createdAt: number;
};

type UserRow = {
  id: string; email: string; display_name: string; role: UserRole; disabled: number;
  created_at: number; updated_at: number; last_login_at: number | null; avatar_file_id: string | null;
};
type ProviderRow = {
  api_base_url: string; api_key_encrypted: string; api_mode: 'responses' | 'chat-completions';
  auth_mode: 'bearer' | 'api-key' | 'none'; default_model: string; allowed_models: string;
  updated_at: number | null;
};
type FileRow = {
  id: string; user_id: string; name: string; mime_type: string; size: number;
  kind: 'image' | 'document'; storage_path: string; created_at: number;
};

function id(): string { return randomUUID(); }
function tokenHash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function normalizeEmail(value: string): string { return value.trim().toLowerCase(); }
function userFromRow(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    disabled: row.disabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at ?? undefined,
    avatarFileId: row.avatar_file_id ?? undefined,
  };
}
function passwordDigest(password: string, salt: string): Buffer {
  return scryptSync(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), 64);
}
function safeEqualEncoded(left: string, right: Buffer): boolean {
  const decoded = Buffer.from(left, 'base64url');
  return decoded.length === right.length && timingSafeEqual(decoded, right);
}

export class AppDatabase {
  readonly uploadsDir: string;
  private readonly db: DatabaseSync;
  private readonly encryptionKey: Buffer;

  constructor(private readonly config: AppConfig) {
    mkdirSync(config.dataDir, { recursive: true });
    this.uploadsDir = path.join(config.dataDir, 'uploads');
    mkdirSync(this.uploadsDir, { recursive: true });
    this.db = new DatabaseSync(path.join(config.dataDir, 'nova-chat.sqlite'));
    this.encryptionKey = createHash('sha256').update(config.serverMasterKey || 'nova-chat-development-key').digest();
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.migrate();
    if (config.adminAutoCreate && config.nodeEnv !== 'test') this.ensureDefaultAdmin();
    this.cleanupExpiredSessions();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin','user')),
        disabled INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_login_at INTEGER,
        avatar_file_id TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        device_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_token_idx ON sessions(token_hash);
      CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS provider_settings (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        api_base_url TEXT NOT NULL,
        api_key_encrypted TEXT NOT NULL,
        api_mode TEXT NOT NULL,
        auth_mode TEXT NOT NULL,
        default_model TEXT NOT NULL,
        allowed_models TEXT NOT NULL,
        updated_at INTEGER,
        updated_by TEXT
      );
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('image','document')),
        storage_path TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS files_user_idx ON files(user_id, created_at);
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id TEXT,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    const userColumns = this.db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
    if (!userColumns.some((column) => column.name === 'avatar_file_id')) {
      this.db.exec('ALTER TABLE users ADD COLUMN avatar_file_id TEXT');
    }
  }

  close() { this.db.close(); }
  cleanupExpiredSessions(now = Date.now()) { this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now); }
  hasAdmin(): boolean { return Boolean(this.db.prepare("SELECT 1 FROM users WHERE role='admin' LIMIT 1").get()); }

  private ensureDefaultAdmin() {
    const email = normalizeEmail(this.config.adminEmail);
    const existing = this.db.prepare('SELECT id FROM users WHERE email=?').get(email);
    if (existing) return;
    this.createUser({
      email,
      password: this.config.adminPassword,
      displayName: this.config.adminDisplayName,
      role: 'admin',
    });
  }
  activeAdminCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND disabled=0").get() as { count: number };
    return Number(row.count);
  }

  createUser(input: { email: string; password: string; displayName: string; role?: UserRole }): UserRecord {
    const now = Date.now();
    const salt = randomBytes(16).toString('base64url');
    const digest = passwordDigest(input.password, salt).toString('base64url');
    const userId = id();
    this.db.prepare(`INSERT INTO users
      (id,email,display_name,password_hash,password_salt,role,disabled,created_at,updated_at)
      VALUES (?,?,?,?,?,?,0,?,?)`).run(
      userId, normalizeEmail(input.email), input.displayName.trim(), digest, salt, input.role ?? 'user', now, now,
    );
    return this.getUserById(userId)!;
  }

  verifyCredentials(email: string, password: string): UserRecord | undefined {
    const row = this.db.prepare(`SELECT id,email,display_name,role,disabled,created_at,updated_at,last_login_at,avatar_file_id,password_hash,password_salt
      FROM users WHERE email=?`).get(normalizeEmail(email)) as (UserRow & { password_hash: string; password_salt: string }) | undefined;
    if (!row || row.disabled === 1 || !safeEqualEncoded(row.password_hash, passwordDigest(password, row.password_salt))) return undefined;
    const now = Date.now();
    this.db.prepare('UPDATE users SET last_login_at=?, updated_at=? WHERE id=?').run(now, now, row.id);
    return this.getUserById(row.id);
  }

  createSession(userId: string, deviceId: string): { token: string; expiresAt: number } {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + this.config.sessionDays * 24 * 60 * 60 * 1000;
    this.db.prepare('INSERT INTO sessions (id,user_id,token_hash,device_id,expires_at,created_at) VALUES (?,?,?,?,?,?)')
      .run(id(), userId, tokenHash(token), deviceId, expiresAt, Date.now());
    return { token, expiresAt };
  }

  authenticate(token: string | undefined): SessionPrincipal | undefined {
    if (!token) return undefined;
    const row = this.db.prepare(`SELECT s.id AS session_id,u.id,u.email,u.display_name,u.role,u.disabled,u.created_at,u.updated_at,u.last_login_at,u.avatar_file_id
      FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0`).get(tokenHash(token), Date.now()) as (UserRow & { session_id: string }) | undefined;
    return row ? { ...userFromRow(row), sessionId: row.session_id } : undefined;
  }

  revokeSession(token: string | undefined) { if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token)); }
  revokeUserSessions(userId: string) { this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId); }

  getUserById(userId: string): UserRecord | undefined {
    const row = this.db.prepare('SELECT id,email,display_name,role,disabled,created_at,updated_at,last_login_at,avatar_file_id FROM users WHERE id=?')
      .get(userId) as UserRow | undefined;
    return row ? userFromRow(row) : undefined;
  }

  listUsers(): UserRecord[] {
    return (this.db.prepare('SELECT id,email,display_name,role,disabled,created_at,updated_at,last_login_at,avatar_file_id FROM users ORDER BY created_at DESC').all() as UserRow[])
      .map(userFromRow);
  }

  updateUser(userId: string, patch: { role?: UserRole; disabled?: boolean; displayName?: string }, actorUserId?: string): UserRecord | undefined {
    const current = this.getUserById(userId);
    if (!current) return undefined;
    const nextRole = patch.role ?? current.role;
    const nextDisabled = patch.disabled ?? current.disabled;
    const nextName = patch.displayName?.trim() || current.displayName;
    this.db.prepare('UPDATE users SET role=?,disabled=?,display_name=?,updated_at=? WHERE id=?')
      .run(nextRole, nextDisabled ? 1 : 0, nextName, Date.now(), userId);
    if (nextDisabled) this.revokeUserSessions(userId);
    this.audit(actorUserId, 'user.update', userId);
    return this.getUserById(userId);
  }

  updateProfile(userId: string, patch: { displayName?: string }): UserRecord | undefined {
    const current = this.getUserById(userId);
    if (!current) return undefined;
    const nextName = patch.displayName?.trim() || current.displayName;
    this.db.prepare('UPDATE users SET display_name=?,updated_at=? WHERE id=?')
      .run(nextName, Date.now(), userId);
    this.audit(userId, 'user.profile.update', userId);
    return this.getUserById(userId);
  }

  setUserAvatar(userId: string, avatarFileId: string): { user: UserRecord; previousAvatarFileId?: string } | undefined {
    const current = this.getUserById(userId);
    if (!current) return undefined;
    this.db.prepare('UPDATE users SET avatar_file_id=?,updated_at=? WHERE id=?')
      .run(avatarFileId, Date.now(), userId);
    this.audit(userId, 'user.avatar.update', userId);
    return { user: this.getUserById(userId)!, previousAvatarFileId: current.avatarFileId };
  }

  clearUserAvatar(userId: string): { user: UserRecord; previousAvatarFileId?: string } | undefined {
    const current = this.getUserById(userId);
    if (!current) return undefined;
    this.db.prepare('UPDATE users SET avatar_file_id=NULL,updated_at=? WHERE id=?')
      .run(Date.now(), userId);
    this.audit(userId, 'user.avatar.remove', userId);
    return { user: this.getUserById(userId)!, previousAvatarFileId: current.avatarFileId };
  }

  private encrypt(secret: string): string {
    if (!secret) return '';
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
  }

  private decrypt(value: string): string {
    if (!value) return '';
    const [version, iv, tag, encrypted] = value.split('.');
    if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('Invalid encrypted provider key');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
  }

  getProviderSettings(): ProviderSettings {
    const row = this.db.prepare('SELECT api_base_url,api_key_encrypted,api_mode,auth_mode,default_model,allowed_models,updated_at FROM provider_settings WHERE id=1').get() as ProviderRow | undefined;
    if (!row) return {
      apiBaseUrl: this.config.openAIBaseUrl,
      apiKey: this.config.openAIKey,
      apiMode: this.config.apiMode,
      authMode: this.config.providerAuthMode,
      defaultModel: this.config.defaultModel,
      allowedModels: this.config.allowedModels,
    };
    return {
      apiBaseUrl: row.api_base_url,
      apiKey: this.decrypt(row.api_key_encrypted),
      apiMode: row.api_mode,
      authMode: row.auth_mode,
      defaultModel: row.default_model,
      allowedModels: row.allowed_models.split(',').map((item) => item.trim()).filter(Boolean),
      updatedAt: row.updated_at ?? undefined,
    };
  }

  getPublicProviderSettings(): PublicProviderSettings {
    const settings = this.getProviderSettings();
    return {
      apiBaseUrl: settings.apiBaseUrl,
      apiMode: settings.apiMode,
      authMode: settings.authMode,
      defaultModel: settings.defaultModel,
      allowedModels: settings.allowedModels,
      updatedAt: settings.updatedAt,
      apiKeySet: Boolean(settings.apiKey),
      apiKeyPreview: settings.apiKey ? `••••${settings.apiKey.slice(-4)}` : '',
    };
  }

  updateProviderSettings(input: Omit<ProviderSettings, 'apiKey' | 'updatedAt'> & { apiKey?: string }, actorUserId: string): PublicProviderSettings {
    const current = this.getProviderSettings();
    const apiKey = input.apiKey === undefined ? current.apiKey : input.apiKey.trim();
    const now = Date.now();
    this.db.prepare(`INSERT INTO provider_settings
      (id,api_base_url,api_key_encrypted,api_mode,auth_mode,default_model,allowed_models,updated_at,updated_by)
      VALUES (1,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET api_base_url=excluded.api_base_url,api_key_encrypted=excluded.api_key_encrypted,
      api_mode=excluded.api_mode,auth_mode=excluded.auth_mode,default_model=excluded.default_model,
      allowed_models=excluded.allowed_models,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).run(
      input.apiBaseUrl.replace(/\/$/, ''), this.encrypt(apiKey), input.apiMode, input.authMode,
      input.defaultModel.trim(), input.allowedModels.join(','), now, actorUserId,
    );
    this.audit(actorUserId, 'provider.update', 'provider');
    return this.getPublicProviderSettings();
  }

  createFile(input: Omit<StoredFile, 'createdAt'>): StoredFile {
    const createdAt = Date.now();
    this.db.prepare('INSERT INTO files (id,user_id,name,mime_type,size,kind,storage_path,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(input.id, input.userId, input.name, input.mimeType, input.size, input.kind, input.storagePath, createdAt);
    return { ...input, createdAt };
  }

  getFile(fileId: string): StoredFile | undefined {
    const row = this.db.prepare('SELECT id,user_id,name,mime_type,size,kind,storage_path,created_at FROM files WHERE id=?').get(fileId) as FileRow | undefined;
    return row ? { id: row.id, userId: row.user_id, name: row.name, mimeType: row.mime_type, size: row.size, kind: row.kind, storagePath: row.storage_path, createdAt: row.created_at } : undefined;
  }

  deleteFile(fileId: string): StoredFile | undefined {
    const stored = this.getFile(fileId);
    if (!stored) return undefined;
    this.db.prepare('DELETE FROM files WHERE id=?').run(fileId);
    return stored;
  }

  audit(actorUserId: string | undefined, action: string, target: string) {
    this.db.prepare('INSERT INTO audit_log (actor_user_id,action,target,created_at) VALUES (?,?,?,?)').run(actorUserId ?? null, action, target, Date.now());
  }
}

