import { registerKnowledgeRoutes } from './knowledgeRoutes.js';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import { z } from 'zod';
import {
  COMPANION_PROFILE_VERSION_HEADER,
  clientSocketMessageSchema,
  restGenerateSchema,
  trimChatMessages,
  companionProfileInputSchema,
  companionContextSchema,
  type CompanionProfile,
  type GenerateRequest,
  type ToolActivity,
  type ServerSocketMessage,
} from '@nova-chat/protocol';
import { bearerToken, tokenMatches } from './auth.js';
import type { AppConfig } from './config.js';
import { AppDatabase, type SessionPrincipal, type UserRecord } from './database.js';
import { toPublicError } from './errors.js';
import { ConcurrencyGate, SlidingWindowLimiter } from './limits.js';
import { resolveProviderSettings } from './providerSettings.js';
import { ModelProvider, type GenerationResult } from './provider.js';
import { toolCatalog } from './tools/index.js';
import { classifyAttachment, isSupportedMimeType, mimeTypeForName, normalizeMimeType } from './attachments.js';
import { isSupportedCompanionTemplate } from './companionAgent.js';

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(80),
  deviceId: z.string().min(8).max(128),
});
const registrationSchema = credentialsSchema.extend({
  displayName: z.string().trim().max(80).optional().transform((value) => value || '新用户'),
});
const passwordChangeSchema = z.object({ currentPassword: z.string().min(8).max(200), newPassword: z.string().min(8).max(200) });
const loginSchema = credentialsSchema.pick({ email: true, password: true, deviceId: true });
const bootstrapSchema = credentialsSchema.extend({ bootstrapToken: z.string().max(4096).default('') });
const profilePatchSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'No changes supplied' });
const userPatchSchema = z.object({
  role: z.enum(['admin', 'user']).optional(),
  disabled: z.boolean().optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'No changes supplied' });
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const jobScopeSchema = z.object({ conversationId: z.string().uuid() });

const providerSchema = z.object({
  apiBaseUrl: z.union([z.literal(''), z.string().trim().url().max(2048).refine((value) => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  })]).optional(),
  apiKey: z.string().max(4096).optional(),
  apiMode: z.enum(['responses', 'chat-completions']),
  authMode: z.enum(['bearer', 'api-key', 'none']),
  defaultModel: z.string().trim().min(1).max(100),
  allowedModels: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
});

type LegacyPrincipal = UserRecord & { sessionId: 'legacy' };
type Principal = SessionPrincipal | LegacyPrincipal;
type GenerationJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
type GenerationJob = {
  requestId: string;
  conversationId: string;
  principalId: string;
  principal: Principal;
  payload: GenerateRequest;
  controller: AbortController;
  status: GenerationJobStatus;
  text: string;
  tools?: ToolActivity[];
  result?: GenerationResult;
  error?: ReturnType<typeof toPublicError>;
  socket?: WebSocket;
  createdAt: number;
  updatedAt: number;
  promise: Promise<void>;
};

function send(socket: WebSocket | undefined, message: ServerSocketMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function legacyPrincipal(): LegacyPrincipal {
  return {
    id: 'legacy-access-token', sessionId: 'legacy', email: 'legacy@local', displayName: 'Legacy user',
    role: 'user', disabled: false, createdAt: 0, updatedAt: 0,
  };
}

function principalForToken(database: AppDatabase, config: AppConfig, token: string | undefined): Principal | undefined {
  const session = database.authenticate(token);
  if (session) return session;
  if (config.appAccessToken && tokenMatches(token, config.appAccessToken)) return legacyPrincipal();
  return undefined;
}

function publicUser(user: UserRecord) {
  return {
    id: user.id, email: user.email, displayName: user.displayName, role: user.role,
    disabled: user.disabled, createdAt: user.createdAt, updatedAt: user.updatedAt, lastLoginAt: user.lastLoginAt,
    avatarFileId: user.avatarFileId,
  };
}

function authResponse(user: UserRecord, session: { token: string; expiresAt: number }) {
  return { user: publicUser(user), accessToken: session.token, expiresAt: session.expiresAt };
}

function unauthorized(reply: FastifyReply) {
  return reply.code(401).send({ error: { code: 'unauthorized', message: '登录已失效，请重新登录。', retryable: false } });
}

function forbidden(reply: FastifyReply) {
  return reply.code(403).send({ error: { code: 'forbidden', message: '需要管理员权限。', retryable: false } });
}

function prepareGeneration(payload: GenerateRequest, config: AppConfig): GenerateRequest {
  // Trim on the gateway as a safety net too. Older clients and REST callers
  // may not use the mobile context builder, and a long conversation should
  // continue with its newest complete window instead of failing with HTTP 413.
  const messageBudget = Math.max(1, config.maxHistoryChars - payload.options.instructions.length);
  const messages = trimChatMessages(payload.messages, messageBudget, config.maxHistoryMessages);
  return messages.length ? { ...payload, messages } : payload;
}

type CompanionResolution =
  | { payload: GenerateRequest }
  | { error: { code: string; message: string } };

function companionContextFromProfile(profile: CompanionProfile) {
  return companionContextSchema.strip().parse(profile);
}

function resolveCompanionPayload(database: AppDatabase, principal: Principal, payload: GenerateRequest): CompanionResolution {
  if (!payload.companionId) return { payload };
  if (principal.sessionId === 'legacy') {
    return { error: { code: 'account_required', message: '持久化陪伴角色需要登录账户。' } };
  }
  const profile = database.getCompanion(principal.id, payload.companionId);
  if (!profile) return { error: { code: 'companion_not_found', message: '陪伴角色不存在或不属于当前账户。' } };
  return { payload: { ...payload, companion: companionContextFromProfile(profile), options: { ...payload.options, instructions: '', knowledgeBase: false, autoTools: true, webSearch: false, codeInterpreter: false, reasoningEffort: 'none', verbosity: 'low' } } };
}

/** Old apps strictly validate v1 profiles; new fields require an explicit opt-in. */
function publicCompanionProfile(request: FastifyRequest, profile: CompanionProfile) {
  if (request.headers[COMPANION_PROFILE_VERSION_HEADER] === '2') return profile;
  const legacy = { ...profile };
  return Object.fromEntries(Object.entries(legacy).filter(([key]) => key !== 'appearance' && key !== 'avatarFileId'));
}

function safeFileName(value: string): string {
  const base = path.basename(value || 'attachment');
  return Array.from(base)
    .map((character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '_' : character)
    .join('')
    .slice(0, 180) || 'attachment';
}

function extensionFor(mimeType: string): string {
  return ({
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'application/pdf': '.pdf',
  } as Record<string, string>)[mimeType] ?? '';
}

function fileKind(mimeType: string): 'image' | 'document' | undefined {
  if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mimeType)) return 'image';
  if (mimeType === 'application/pdf') return 'document';
  return undefined;
}

function matchesFileSignature(mimeType: string, bytes: Buffer): boolean {
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === 'image/gif') return bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
  if (mimeType === 'image/webp') return bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (mimeType === 'application/pdf') return bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  return false;
}

function contentDispositionName(value: string): string {
  const ascii = Array.from(value)
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code > 126 || character === '"' || character === '\\' ? '_' : character;
    })
    .join('') || 'attachment';
  const encoded = encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function buildServer(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.body.password', 'req.body.currentPassword', 'req.body.newPassword', 'req.body.bootstrapToken', 'req.body.apiKey', 'req.body.apiBaseUrl', 'body.apiKey', 'body.apiBaseUrl', 'body.messages', 'body.options.instructions'],
    },
    // Long-running conversations are trimmed below, but the request itself must
    // be large enough to reach that code path.
    bodyLimit: 4 * 1024 * 1024,
    trustProxy: true,
  });
  const database = new AppDatabase(config);
  const provider = new ModelProvider(config, database, { warn: (bindings, message) => app.log.warn(bindings, message) });
  const limiter = new SlidingWindowLimiter(config.requestsPerMinute);
  const concurrency = new ConcurrencyGate(config.maxConcurrentPerDevice);
  const passwordLimiter = new SlidingWindowLimiter(5, 15 * 60_000);
  const socketValidators = new Map<WebSocket, () => boolean>();

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(rateLimit, { max: config.requestsPerMinute * 3, timeWindow: '1 minute' });
  await app.register(multipart, {
    limits: { files: 1, fileSize: config.maxFileBytes, fields: 4, parts: 5 },
  });

  const requireUser = (request: FastifyRequest, reply: FastifyReply): Principal | undefined => {
    const principal = principalForToken(database, config, bearerToken(request.headers.authorization));
    if (!principal) void unauthorized(reply);
    return principal;
  };
  const requireAdmin = (request: FastifyRequest, reply: FastifyReply): Principal | undefined => {
    const principal = requireUser(request, reply);
    if (!principal) return undefined;
    if (principal.role !== 'admin') { void forbidden(reply); return undefined; }
    return principal;
  };

  app.get('/health', async () => {
    const settings = database.getProviderSettings();
    return { ok: true, service: 'nova-chat-gateway', apiMode: settings.apiMode, defaultModel: settings.defaultModel };
  });

  app.get('/v1/tools', async (request, reply) => {
    if (!requireUser(request, reply)) return;
    return {
      tools: toolCatalog(config),
      defaultTimezone: config.defaultTimezone,
      searchProvider: config.braveSearchApiKey ? 'brave' : 'bing-rss-fallback',
      note: '这是配置能力列表，不代表外部服务实时可用。内置工具按需执行；系统时钟始终提供。',
    };
  });

  app.get('/v1/setup/status', async () => {
    const settings = database.getProviderSettings();
    return {
      needsBootstrap: !database.hasAdmin(),
      bootstrapTokenRequired: Boolean(config.adminBootstrapToken),
      registrationEnabled: config.registrationEnabled,
      // Configuration readiness only; never expose credentials or claim upstream availability.
      providerConfigured: Boolean(settings.apiBaseUrl && settings.defaultModel
        && settings.allowedModels.includes(settings.defaultModel)
        && (settings.authMode === 'none' || settings.apiKey)),
    };
  });

  app.post('/v1/auth/bootstrap', async (request, reply) => {
    if (database.hasAdmin()) return reply.code(409).send({ error: { code: 'already_configured', message: '管理员已经创建。', retryable: false } });
    const parsed = bootstrapSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'invalid_request', message: '请填写有效邮箱、名称和至少 8 位密码。', retryable: false } });
    if ((config.adminBootstrapToken || config.nodeEnv === 'production') && !tokenMatches(parsed.data.bootstrapToken, config.adminBootstrapToken)) {
      return reply.code(403).send({ error: { code: 'invalid_bootstrap_token', message: '管理员初始化口令无效。', retryable: false } });
    }
    try {
      const user = database.createUser({ ...parsed.data, role: 'admin' });
      const session = database.createSession(user.id, parsed.data.deviceId);
      database.audit(user.id, 'auth.bootstrap', user.id);
      return reply.code(201).send(authResponse(user, session));
    } catch {
      return reply.code(409).send({ error: { code: 'email_exists', message: '该邮箱已经注册。', retryable: false } });
    }
  });

  app.post('/v1/auth/register', async (request, reply) => {
    if (!database.hasAdmin()) return reply.code(409).send({ error: { code: 'setup_required', message: '请先创建管理员账户。', retryable: false } });
    if (!config.registrationEnabled) return reply.code(403).send({ error: { code: 'registration_disabled', message: '管理员已关闭注册。', retryable: false } });
    const parsed = registrationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'invalid_request', message: '请填写有效邮箱、名称和至少 8 位密码。', retryable: false } });
    try {
      const user = database.createUser(parsed.data);
      const session = database.createSession(user.id, parsed.data.deviceId);
      database.audit(user.id, 'auth.register', user.id);
      return reply.code(201).send(authResponse(user, session));
    } catch {
      return reply.code(409).send({ error: { code: 'email_exists', message: '该邮箱已经注册。', retryable: false } });
    }
  });

  app.post('/v1/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'invalid_request', message: '邮箱或密码格式不正确，密码至少 8 位。', retryable: false } });
    const user = database.verifyCredentials(parsed.data.email, parsed.data.password);
    if (!user) return reply.code(401).send({ error: { code: 'invalid_credentials', message: '邮箱或密码错误，或账户已被停用。', retryable: false } });
    const session = database.createSession(user.id, parsed.data.deviceId);
    database.audit(user.id, 'auth.login', user.id);
    return authResponse(user, session);
  });

  app.post('/v1/auth/logout', async (request, reply) => {
    const token = bearerToken(request.headers.authorization);
    const principal = principalForToken(database, config, token);
    if (!principal) return unauthorized(reply);
    if (principal.sessionId !== 'legacy') database.revokeSession(token);
    invalidateRevokedSessions();
    return { ok: true };
  });

  app.get('/v1/auth/sessions', async (request, reply) => {
    const principal = requireUser(request, reply);
    if (!principal) return;
    if (principal.sessionId === 'legacy') return forbidden(reply);
    return { sessions: database.listSessions(principal.id, principal.sessionId) };
  });

  app.delete('/v1/auth/sessions/:sessionId', async (request, reply) => {
    const principal = requireUser(request, reply);
    if (!principal) return;
    if (principal.sessionId === 'legacy') return forbidden(reply);
    const { sessionId } = request.params as { sessionId: string };
    if (!database.revokeOwnedSession(principal.id, sessionId)) {
      return reply.code(404).send({ error: { code: 'session_not_found', message: '登录会话不存在或已退出。', retryable: false } });
    }
    invalidateRevokedSessions();
    return { ok: true, currentSessionRevoked: sessionId === principal.sessionId };
  });

  app.post('/v1/auth/sessions/revoke-others', async (request, reply) => {
    const principal = requireUser(request, reply);
    if (!principal) return;
    if (principal.sessionId === 'legacy') return forbidden(reply);
    const revoked = database.revokeOtherSessions(principal.id, principal.sessionId);
    invalidateRevokedSessions();
    return { ok: true, revoked };
  });

  app.post('/v1/auth/password', async (request, reply) => {
    const principal = requireUser(request, reply);
    if (!principal) return;
    if (principal.sessionId === 'legacy') return forbidden(reply);
    const parsed = passwordChangeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'invalid_request', message: '密码长度需要为 8–200 个字符。', retryable: false } });
    const limit = passwordLimiter.consume(principal.id);
    if (!limit.allowed) return reply.header('retry-after', String(Math.ceil(limit.retryAfterMs / 1_000))).code(429)
      .send({ error: { code: 'rate_limited', message: '修改密码尝试过于频繁，请 15 分钟后重试。', retryable: true } });
    if (parsed.data.currentPassword.normalize('NFKC') === parsed.data.newPassword.normalize('NFKC')) {
      return reply.code(400).send({ error: { code: 'password_unchanged', message: '新密码不能与当前密码相同。', retryable: false } });
    }
    if (!database.changePassword(principal.id, parsed.data.currentPassword, parsed.data.newPassword)) {
      return reply.code(400).send({ error: { code: 'invalid_current_password', message: '当前密码不正确。', retryable: false } });
    }
    invalidateRevokedSessions();
    return { ok: true };
  });

  app.get('/v1/auth/me', async (request, reply) => {
    const principal = requireUser(request, reply);
    if (!principal) return;
    return { user: publicUser(principal) };
  });

  app.patch('/v1/auth/me', async (request, reply) => {
    const principal = requireUser(request, reply);
    if (!principal) return;
    if (principal.sessionId === 'legacy') {
      return reply.code(403).send({ error: { code: 'account_required', message: '编辑个人信息需要登录账户。', retryable: false } });
    }
    const parsed = profilePatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: '个人信息格式不正确。', retryable: false } });
    }
    const user = database.updateProfile(principal.id, parsed.data);
    if (!user) return reply.code(404).send({ error: { code: 'not_found', message: '用户不存在。', retryable: false } });
    return { user: publicUser(user) };
  });

  app.post('/v1/auth/me/avatar', async (request, reply) => {
    const principal = requireUser(request, reply);
    if (!principal) return;
    if (principal.sessionId === 'legacy') {
      return reply.code(403).send({ error: { code: 'account_required', message: '设置头像需要登录账户。', retryable: false } });
    }

    let fileId: string | undefined;
    let storagePath = '';
    try {
      const part = await request.file({ limits: { fileSize: MAX_AVATAR_BYTES, files: 1 } });
      if (!part) return reply.code(400).send({ error: { code: 'file_required', message: '请选择头像图片。', retryable: false } });
      const mimeType = part.mimetype.toLowerCase();
      if (fileKind(mimeType) !== 'image') {
        part.file.resume();
        return reply.code(415).send({ error: { code: 'unsupported_avatar', message: '头像仅支持 JPG、PNG、WebP 或 GIF 图片。', retryable: false } });
      }
      const bytes = await part.toBuffer();
      if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) {
        return reply.code(413).send({ error: { code: 'avatar_too_large', message: '头像不能为空且不能超过 5 MB。', retryable: false } });
      }
      if (!matchesFileSignature(mimeType, bytes)) {
        return reply.code(415).send({ error: { code: 'invalid_file_content', message: '图片内容与声明格式不一致。', retryable: false } });
      }

      fileId = randomUUID();
      storagePath = path.join(database.uploadsDir, `${fileId}${extensionFor(mimeType)}`);
      await writeFile(storagePath, bytes, { flag: 'wx' });
      database.createFile({
        id: fileId, userId: principal.id, name: safeFileName(part.filename || 'avatar'), mimeType,
        size: bytes.length, kind: 'image', storagePath,
      });
      const result = database.setUserAvatar(principal.id, fileId);
      if (!result) {
        const created = database.deleteFile(fileId);
        if (created) await unlink(created.storagePath).catch(() => undefined);
        return reply.code(404).send({ error: { code: 'not_found', message: '用户不存在。', retryable: false } });
      }
      if (result.previousAvatarFileId) {
        const previous = database.deleteFile(result.previousAvatarFileId);
        if (previous) await unlink(previous.storagePath).catch(() => undefined);
      }
      return reply.code(201).send({ user: publicUser(result.user) });
    } catch (error) {
      if (fileId) {
        const created = database.deleteFile(fileId);
        if (created) await unlink(created.storagePath).catch(() => undefined);
      } else if (storagePath) {
        await unlink(storagePath).catch(() => undefined);
      }
      if (error instanceof app.multipartErrors.RequestFileTooLargeError) {
        return reply.code(413).send({ error: { code: 'avatar_too_large', message: '头像不能超过 5 MB。', retryable: false } });
      }
      request.log.warn({ error: error instanceof Error ? error.name : 'unknown' }, 'avatar upload failed');
      return reply.code(500).send({ error: { code: 'upload_failed', message: '头像上传失败，请重试。', retryable: true } });
    }
  });

  app.delete('/v1/auth/me/avatar', async (request, reply) => {
    const principal = requireUser(request, reply);
    if (!principal) return;
    if (principal.sessionId === 'legacy') {
      return reply.code(403).send({ error: { code: 'account_required', message: '移除头像需要登录账户。', retryable: false } });
    }
    const result = database.clearUserAvatar(principal.id);
    if (!result) return reply.code(404).send({ error: { code: 'not_found', message: '用户不存在。', retryable: false } });
    if (result.previousAvatarFileId) {
      const previous = database.deleteFile(result.previousAvatarFileId);
      if (previous) await unlink(previous.storagePath).catch(() => undefined);
    }
    return { user: publicUser(result.user) };
  });

  app.get('/v1/companions', async (request, reply) => {
    const principal = requireUser(request, reply);
    if (!principal) return;
    if (principal.sessionId === 'legacy') return reply.code(403).send({ error: { code: 'account_required', message: '陪伴角色需要登录账户。', retryable: false } });
    return { companions: database.listCompanions(principal.id).map((profile) => publicCompanionProfile(request, profile)) };
  });

  app.post('/v1/companions', async (request, reply) => {
    const principal = requireUser(request, reply);
    if (!principal) return;
    if (principal.sessionId === 'legacy') return reply.code(403).send({ error: { code: 'account_required', message: '陪伴角色需要登录账户。', retryable: false } });
    const parsed = companionProfileInputSchema.safeParse(request.body ?? {});
    if (!parsed.success || !isSupportedCompanionTemplate(parsed.data.templateId)) {
      return reply.code(400).send({ error: { code: 'invalid_companion', message: '陪伴角色配置无效或暂不支持该模板。', retryable: false } });
    }
    if (parsed.data.avatarFileId) {
      const face = database.getFile(parsed.data.avatarFileId);
      if (!face || face.userId !== principal.id || face.kind !== 'image') return reply.code(400).send({ error: { code: 'invalid_companion_face', message: '请选择当前账户上传的照片。', retryable: false } });
    }
    return reply.code(201).send({ companion: publicCompanionProfile(request, database.createCompanion(principal.id, parsed.data)) });
  });

  app.get('/v1/companions/:id', async (request, reply) => {
    const principal = requireUser(request, reply);
    if (!principal) return;
    if (principal.sessionId === 'legacy') return reply.code(403).send({ error: { code: 'account_required', message: '陪伴角色需要登录账户。', retryable: false } });
    const id = (request.params as { id?: string }).id;
    const companion = id ? database.getCompanion(principal.id, id) : undefined;
    if (!companion) return reply.code(404).send({ error: { code: 'companion_not_found', message: '陪伴角色不存在。', retryable: false } });
    return { companion: publicCompanionProfile(request, companion) };
  });

  app.patch('/v1/companions/:id', async (request, reply) => {
    const principal = requireUser(request, reply);
    if (!principal) return;
    if (principal.sessionId === 'legacy') return reply.code(403).send({ error: { code: 'account_required', message: '陪伴角色需要登录账户。', retryable: false } });
    const parsed = companionProfileInputSchema.safeParse(request.body ?? {});
    const id = (request.params as { id?: string }).id;
    if (!id || !parsed.success || !isSupportedCompanionTemplate(parsed.data.templateId)) {
      return reply.code(400).send({ error: { code: 'invalid_companion', message: '陪伴角色配置无效或暂不支持该模板。', retryable: false } });
    }
    if (parsed.data.avatarFileId) {
      const face = database.getFile(parsed.data.avatarFileId);
      if (!face || face.userId !== principal.id || face.kind !== 'image') return reply.code(400).send({ error: { code: 'invalid_companion_face', message: '请选择当前账户上传的照片。', retryable: false } });
    }
    const companion = database.updateCompanion(principal.id, id, parsed.data);
    if (!companion) return reply.code(404).send({ error: { code: 'companion_not_found', message: '陪伴角色不存在。', retryable: false } });
    return { companion: publicCompanionProfile(request, companion) };
  });

  app.delete('/v1/companions/:id', async (request, reply) => {
    const principal = requireUser(request, reply);
    if (!principal) return;
    if (principal.sessionId === 'legacy') return reply.code(403).send({ error: { code: 'account_required', message: '陪伴角色需要登录账户。', retryable: false } });
    const id = (request.params as { id?: string }).id;
    if (!id || !database.deleteCompanion(principal.id, id)) {
      return reply.code(404).send({ error: { code: 'companion_not_found', message: '陪伴角色不存在。', retryable: false } });
    }
    return { ok: true };
  });

  app.get('/v1/admin/users', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return { users: database.listUsers().map(publicUser) };
  });

  app.patch('/v1/admin/users/:id', async (request, reply) => {
    const principal = requireAdmin(request, reply);
    if (!principal) return;
    const parsed = userPatchSchema.safeParse(request.body);
    const userId = (request.params as { id?: string }).id;
    if (!parsed.success || !userId) return reply.code(400).send({ error: { code: 'invalid_request', message: '用户更新内容无效。', retryable: false } });
    const current = database.getUserById(userId);
    if (!current) return reply.code(404).send({ error: { code: 'not_found', message: '用户不存在。', retryable: false } });
    const removesActiveAdmin = current.role === 'admin' && !current.disabled
      && (parsed.data.role === 'user' || parsed.data.disabled === true);
    if (removesActiveAdmin && database.activeAdminCount() <= 1) {
      return reply.code(409).send({ error: { code: 'last_admin', message: '必须至少保留一个启用的管理员。', retryable: false } });
    }
    const updated = database.updateUser(userId, parsed.data, principal.id)!;
    invalidateRevokedSessions();
    return { user: publicUser(updated) };
  });

  app.get('/v1/admin/companion-provider/:purpose', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const purpose = (request.params as { purpose: string }).purpose;
    if (purpose !== 'chat' && purpose !== 'image') return reply.code(400).send({ error: { code: 'invalid_purpose', message: '服务类型无效。', retryable: false } });
    return { provider: database.publicCompanionProviderSettings(purpose) };
  });
  app.put('/v1/admin/companion-provider/:purpose', async (request, reply) => {
    const principal = requireAdmin(request, reply);
    if (!principal) return;
    const purpose = (request.params as { purpose: string }).purpose;
    const parsed = providerSchema.safeParse(request.body);
    if ((purpose !== 'chat' && purpose !== 'image') || !parsed.success) return reply.code(400).send({ error: { code: 'invalid_request', message: '陪伴服务配置不正确。', retryable: false } });
    try { return { provider: database.setCompanionProviderSettings(purpose, parsed.data, principal.id) }; }
    catch (error) { const publicError = toPublicError(error); return reply.code(publicError.statusCode).send({ error: publicError }); }
  });

  app.post('/v1/admin/companion-provider/:purpose/test', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const purpose = (request.params as { purpose: string }).purpose;
    const parsed = providerSchema.pick({ apiBaseUrl: true, apiKey: true, apiMode: true, authMode: true }).partial().safeParse(request.body ?? {});
    if ((purpose !== 'chat' && purpose !== 'image') || !parsed.success) return reply.code(400).send({ error: { code: 'invalid_request', message: '陪伴服务配置不正确。', retryable: false } });
    const controller = new AbortController();
    request.raw.once('aborted', () => controller.abort());
    reply.raw.once('close', () => { if (!reply.raw.writableEnded) controller.abort(); });
    try {
      const current = database.getCompanionProviderSettings(purpose);
      const draft = resolveProviderSettings(current, { ...current, ...parsed.data, apiBaseUrl: parsed.data.apiBaseUrl, apiKey: parsed.data.apiKey });
      return { ok: true, models: await provider.listModels(controller.signal, draft) };
    } catch (error) {
      const publicError = toPublicError(error);
      request.log.warn({ event: 'companion_model_test_failed', purpose, errorCode: publicError.code, statusCode: publicError.statusCode }, 'Companion model discovery failed');
      return reply.code(publicError.statusCode).send({ error: publicError });
    }
  });

  app.get('/v1/admin/provider', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return { provider: database.getPublicProviderSettings() };
  });

  app.put('/v1/admin/provider', async (request, reply) => {
    const principal = requireAdmin(request, reply);
    if (!principal) return;
    const parsed = providerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'invalid_request', message: '模型服务配置不正确。', retryable: false } });
    try {
      return { provider: database.updateProviderSettings(parsed.data, principal.id) };
    } catch (error) {
      const publicError = toPublicError(error);
      return reply.code(publicError.statusCode).send({ error: publicError });
    }
  });

  app.post('/v1/admin/provider/test', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    // Fastify's request.signal is not the client-disconnect signal we need here
    // and may already be aborted after the request body has been parsed. Use
    // the same raw request/reply lifecycle hooks as the chat REST endpoint.
    const controller = new AbortController();
    request.raw.once('aborted', () => controller.abort());
    reply.raw.once('close', () => { if (!reply.raw.writableEnded) controller.abort(); });
    try {
      const rawBody = request.body;
      const hasDraft = Boolean(rawBody && typeof rawBody === 'object' && Object.keys(rawBody as object).length > 0);
      if (!hasDraft) return { ok: true, models: await provider.listModels(controller.signal) };
      const parsed = providerSchema.safeParse(rawBody);
      if (!parsed.success) return reply.code(400).send({ error: { code: 'invalid_request', message: '模型服务配置不正确。', retryable: false } });
      const draft = resolveProviderSettings(database.getProviderSettings(), parsed.data);
      return { ok: true, models: await provider.listModels(controller.signal, draft) };
    } catch (error) {
      const publicError = toPublicError(error);
      request.log.warn({ event: 'provider_model_test_failed', errorCode: publicError.code, statusCode: publicError.statusCode }, 'Provider model discovery failed');
      return reply.code(publicError.statusCode).send({ error: publicError });
    }
  });

  app.get('/v1/models', async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const settings = database.getPublicProviderSettings();
    return { models: settings.allowedModels, defaultModel: settings.defaultModel, apiMode: settings.apiMode };
  });

  registerKnowledgeRoutes(app, database, requireUser);

  app.post('/v1/files', async (request, reply) => {
    const principal = requireUser(request, reply);
    if (!principal) return;
    if (principal.sessionId === 'legacy') return reply.code(403).send({ error: { code: 'account_required', message: '上传附件需要登录账户。', retryable: false } });
    try {
      const part = await request.file({ limits: { fileSize: config.maxFileBytes, files: 1 } });
      if (!part) return reply.code(400).send({ error: { code: 'file_required', message: '请选择文件。', retryable: false } });
      const bytes = await part.toBuffer();
      if (!bytes.length || bytes.length > config.maxFileBytes) return reply.code(413).send({ error: { code: 'file_too_large', message: '文件为空或超过大小限制。', retryable: false } });
      const classified = classifyAttachment(part.filename, normalizeMimeType(part.mimetype), bytes);
      if (!classified) {
        const declaredMime = normalizeMimeType(part.mimetype);
        const likelySupported = Boolean(mimeTypeForName(part.filename)) || isSupportedMimeType(declaredMime);
        return reply.code(415).send({ error: { code: likelySupported ? 'invalid_file_content' : 'unsupported_file', message: '文件无法读取或暂不支持，请换一个文件后重试。', retryable: false } });
      }
      const fileId = randomUUID();
      const storagePath = path.join(database.uploadsDir, fileId + classified.extension);
      await writeFile(storagePath, bytes, { flag: 'wx' });
      try {
        const stored = database.createFile({
          id: fileId, userId: principal.id, name: safeFileName(part.filename), mimeType: classified.mimeType,
          size: bytes.length, kind: classified.kind, storagePath,
        });
        return reply.code(201).send({
          attachment: {
            id: stored.id, name: stored.name, mimeType: stored.mimeType, size: stored.size, kind: stored.kind,
          },
        });
      } catch (error) {
        await unlink(storagePath).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if (error instanceof app.multipartErrors.RequestFileTooLargeError) {
        return reply.code(413).send({ error: { code: 'file_too_large', message: `附件不能超过 ${Math.floor(config.maxFileBytes / 1024 / 1024)} MB。`, retryable: false } });
      }
      request.log.warn({ error: error instanceof Error ? error.name : 'unknown' }, 'file upload failed');
      return reply.code(500).send({ error: { code: 'upload_failed', message: '附件上传失败，请重试。', retryable: true } });
    }
  });

  app.get('/v1/files/:id', async (request, reply) => {
    const principal = requireUser(request, reply);
    if (!principal) return;
    const fileId = (request.params as { id?: string }).id;
    const stored = fileId ? database.getFile(fileId) : undefined;
    if (!stored || (stored.userId !== principal.id && principal.role !== 'admin')) {
      return reply.code(404).send({ error: { code: 'not_found', message: '附件不存在。', retryable: false } });
    }
    reply.header('cache-control', 'private, max-age=3600');
    reply.header('content-type', stored.mimeType);
    reply.header('content-length', stored.size);
    reply.header('content-disposition', `${stored.kind === 'image' ? 'inline' : 'attachment'}; ${contentDispositionName(stored.name)}`);
    return reply.send(createReadStream(stored.storagePath));
  });

  const validateGeneration = (): { code: string; message: string } | undefined => undefined;
  const jobs = new Map<string, GenerationJob>();
  function invalidateRevokedSessions() {
    for (const validate of socketValidators.values()) validate();
    for (const job of jobs.values()) {
      if ((job.status === 'queued' || job.status === 'running') && job.principal.sessionId !== 'legacy'
        && !database.hasActiveSession(job.principal.sessionId, job.principalId)) job.controller.abort();
    }
  }
  // REST-only jobs also stop when their session expires, even without a socket.
  const sessionSweep = setInterval(invalidateRevokedSessions, 15_000);
  sessionSweep.unref();
  const JOB_RETENTION_MS = 30 * 60 * 1_000;

  const jobResponse = (job: GenerationJob) => ({
    requestId: job.requestId,
    conversationId: job.conversationId,
    status: job.status,
    text: job.result?.text || job.text,
    model: job.payload.companionId ? undefined : job.result?.model,
    responseId: job.payload.companionId ? undefined : job.result?.responseId,
    usage: job.payload.companionId ? undefined : job.result?.usage,
    attachments: job.result?.attachments,
    tools: job.tools,
    knowledge: job.result?.knowledge,
    error: job.error ? {
      code: job.error.code,
      message: job.error.message,
      retryable: job.error.retryable,
    } : undefined,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });

  database.cleanupGenerationSnapshots();
  const snapshotCleanup = setInterval(() => database.cleanupGenerationSnapshots(), 60 * 60_000);
  snapshotCleanup.unref();
  const snapshotWrites = new Map<string, number>();
  const persistJob = (job: GenerationJob, force = false) => {
    if (!force && Date.now() - (snapshotWrites.get(job.requestId) ?? 0) < 250) return;
    database.saveGenerationSnapshot(job.principalId, job.conversationId, job.requestId, jobResponse(job));
    snapshotWrites.set(job.requestId, Date.now());
  };
  const retentionTimers = new Set<ReturnType<typeof setTimeout>>();
  const retainJob = (job: GenerationJob) => {
    const timer = setTimeout(() => {
      retentionTimers.delete(timer);
      if (jobs.get(job.requestId) === job && job.status !== 'queued' && job.status !== 'running') { jobs.delete(job.requestId); snapshotWrites.delete(job.requestId); }
    }, JOB_RETENTION_MS);
    timer.unref();
    retentionTimers.add(timer);
  };

  const executeJob = async (job: GenerationJob) => {
    job.status = 'running';
    job.updatedAt = Date.now();
    persistJob(job, true);
    try {
      const result = await provider.generate(
        job.payload,
        job.principal,
        job.controller.signal,
        (delta) => {
          job.text += delta;
          job.updatedAt = Date.now();
          persistJob(job);
          send(job.socket, { type: 'delta', requestId: job.requestId, delta });
        },
        (activity) => {
          const tools = job.tools ?? [];
          job.tools = [...tools.filter((item) => item.id !== activity.id), activity].slice(-24);
          job.updatedAt = Date.now();
          persistJob(job, true);
          send(job.socket, { type: 'tool', requestId: job.requestId, activity });
        },
      );
      job.result = result;
      // JSON responses may not emit through the streaming callback in every
      // provider implementation, while streamed responses already populated
      // job.text. Keep the authoritative final text in both cases.
      job.text = result.text || job.text;
      job.status = 'completed';
      job.updatedAt = Date.now();
      persistJob(job, true);
      send(job.socket, {
        type: 'done', requestId: job.requestId, model: job.payload.companionId ? undefined : result.model, responseId: job.payload.companionId ? undefined : result.responseId,
        usage: job.payload.companionId ? undefined : result.usage, attachments: result.attachments, tools: result.tools, knowledge: result.knowledge,
      });
    } catch (error) {
      const publicError = toPublicError(error);
      job.error = publicError;
      job.status = publicError.code === 'cancelled' ? 'cancelled' : 'failed';
      job.updatedAt = Date.now();
      persistJob(job, true);
      if (job.status === 'cancelled') send(job.socket, { type: 'cancelled', requestId: job.requestId });
      else {
        app.log.warn({ code: publicError.code, requestId: job.requestId, userId: job.principalId }, 'generation failed');
        send(job.socket, {
          type: 'error', requestId: job.requestId, code: publicError.code,
          message: publicError.message, retryable: publicError.retryable,
        });
      }
    } finally {
      concurrency.release(job.principalId);
      retainJob(job);
    }
  };

  const createJob = (payload: GenerateRequest, principal: Principal, socket?: WebSocket): GenerationJob | undefined => {
    if (jobs.has(payload.requestId) || database.hasGenerationRequest(payload.requestId)) return undefined;
    const now = Date.now();
    const job: GenerationJob = {
      requestId: payload.requestId,
      conversationId: payload.conversationId,
      principalId: principal.id,
      principal,
      payload,
      controller: new AbortController(),
      status: 'queued',
      text: '',
      socket,
      createdAt: now,
      updatedAt: now,
      promise: Promise.resolve(),
    };
    jobs.set(job.requestId, job);
    persistJob(job, true);
    job.promise = executeJob(job);
    return job;
  };

  const findOwnedJob = (requestId: string, principal: Principal, conversationId: string): GenerationJob | undefined => {
    const job = jobs.get(requestId);
    if (!job || (job.principalId !== principal.id)) return undefined;
    // A request id is not sufficient to restore or cancel a generation. Keep
    // the durable job scoped to the conversation that created it as well.
    if (job.conversationId !== conversationId) return undefined;
    return job;
  };

  const parseJobScope = (request: FastifyRequest, reply: FastifyReply): string | undefined => {
    const parsed = jobScopeSchema.safeParse(request.query);
    if (!parsed.success) {
      reply.code(400).send({ error: { code: 'invalid_conversation_scope', message: '缺少有效的会话标识。', retryable: false } });
      return undefined;
    }
    return parsed.data.conversationId;
  };

  app.get('/v1/chat/jobs/:requestId', async (request, reply) => {
    const principal = requireUser(request, reply);
    if (!principal) return;
    const conversationId = parseJobScope(request, reply);
    if (!conversationId) return;
    const requestId = (request.params as { requestId?: string }).requestId ?? '';
    const job = findOwnedJob(requestId, principal, conversationId);
    if (!job) {
      const saved = database.getGenerationSnapshot(principal.id, conversationId, requestId);
      if (saved) return saved;
    }
    if (!job) return reply.code(404).send({ error: { code: 'job_not_found', message: '生成任务不存在或已过期。', retryable: false } });
    return jobResponse(job);
  });

  app.post('/v1/chat/jobs/:requestId/cancel', async (request, reply) => {
    const principal = requireUser(request, reply);
    if (!principal) return;
    const conversationId = parseJobScope(request, reply);
    if (!conversationId) return;
    const requestId = (request.params as { requestId?: string }).requestId ?? '';
    const job = findOwnedJob(requestId, principal, conversationId);
    if (!job) return reply.code(404).send({ error: { code: 'job_not_found', message: '生成任务不存在或已过期。', retryable: false } });
    if (job.status === 'queued' || job.status === 'running') job.controller.abort();
    return { ok: true, status: job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled' ? job.status : 'cancelling' };
  });

  app.post('/v1/chat', async (request, reply) => {
    const principal = requireUser(request, reply);
    if (!principal) return;
    const parsed = restGenerateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'invalid_request', message: '请求格式不正确。', retryable: false } });
    const resolved = resolveCompanionPayload(database, principal, parsed.data);
    if ('error' in resolved) return reply.code(resolved.error.code === 'account_required' ? 403 : 404).send({ error: { ...resolved.error, retryable: false } });
    const payload = prepareGeneration(resolved.payload, config);
    const invalid = validateGeneration();
    if (invalid) return reply.code(invalid.code === 'history_too_large' ? 413 : 400).send({ error: { ...invalid, retryable: false } });
    const key = principal.id;
    const rate = limiter.consume(key);
    if (!rate.allowed) return reply.code(429).header('retry-after', Math.ceil(rate.retryAfterMs / 1000)).send({ error: { code: 'rate_limited', message: '请求过于频繁，请稍后再试。', retryable: true } });
    if (!concurrency.acquire(key)) return reply.code(429).send({ error: { code: 'too_many_concurrent', message: '该账户的并发请求已达到上限。', retryable: true } });
    const job = createJob(payload, principal);
    if (!job) {
      concurrency.release(key);
      return reply.code(409).send({ error: { code: 'duplicate_request', message: '重复的请求标识。', retryable: false } });
    }
    try {
      await job.promise;
      if (request.raw.aborted || reply.raw.destroyed) return;
      if (job.status === 'completed' && job.result) return { requestId: payload.requestId, ...job.result, ...(payload.companionId ? { model: undefined, responseId: undefined, usage: undefined } : {}) };
      const publicError = job.error ?? toPublicError(new Error('generation failed'));
      return reply.code(publicError.statusCode === 499 ? 408 : publicError.statusCode).send({ error: publicError });
    } catch (error) {
      const publicError = toPublicError(error);
      request.log.warn({ code: publicError.code, statusCode: publicError.statusCode }, 'generation failed');
      return reply.code(publicError.statusCode === 499 ? 408 : publicError.statusCode).send({ error: publicError });
    }
  });

  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  app.server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/v1/chat/stream') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => sockets.emit('connection', ws, request));
  });

  sockets.on('connection', (socket) => {
    let principal: Principal | undefined;
    let deviceId = '';
    let sessionToken = '';
    const revalidate = () => {
      if (!principal) return true;
      const current = principalForToken(database, config, sessionToken);
      if (!current) {
        send(socket, { type: 'error', code: 'unauthorized', message: '登录已失效，请重新登录。', retryable: false });
        socket.close(4401, 'session revoked or expired');
        socketValidators.delete(socket);
        return false;
      }
      // A role change takes effect on the next frame, not the next login.
      principal = current;
      return true;
    };
    socketValidators.set(socket, revalidate);
    const helloTimer = setTimeout(() => {
      send(socket, { type: 'error', code: 'hello_timeout', message: '连接握手超时。', retryable: true });
      socket.close(4408, 'hello timeout');
    }, 10_000);
    const heartbeat = setInterval(() => { if (revalidate()) send(socket, { type: 'pong' }); }, 15_000);
    const detachJobs = () => {
      clearTimeout(helloTimer);
      clearInterval(heartbeat);
      socketValidators.delete(socket);
      for (const job of jobs.values()) if (job.socket === socket) job.socket = undefined;
      // A mobile app entering the background is not a cancellation. The job
      // remains owned by the authenticated user and can be polled after resume.
    };
    socket.on('close', detachJobs);
    socket.on('error', detachJobs);
    socket.on('message', (raw: RawData) => {
      void (async () => {
        if (!revalidate()) return;
        let json: unknown;
        try { json = JSON.parse(raw.toString()); }
        catch { send(socket, { type: 'error', code: 'invalid_json', message: '消息格式无效。', retryable: false }); return; }
        const parsed = clientSocketMessageSchema.safeParse(json);
        if (!parsed.success) { send(socket, { type: 'error', code: 'invalid_message', message: '消息内容无效。', retryable: false }); return; }
        const message = parsed.data;
        if (!principal) {
          if (message.type !== 'hello') { send(socket, { type: 'error', code: 'unauthorized', message: '请先登录。', retryable: false }); socket.close(4401, 'unauthorized'); return; }
          principal = principalForToken(database, config, message.accessToken);
          if (!principal) { send(socket, { type: 'error', code: 'unauthorized', message: '登录已失效，请重新登录。', retryable: false }); socket.close(4401, 'unauthorized'); return; }
          sessionToken = message.accessToken;
          deviceId = message.deviceId;
          clearTimeout(helloTimer);
          send(socket, { type: 'ready' });
          return;
        }
        if (message.type === 'ping') { send(socket, { type: 'pong' }); return; }
        if (message.type === 'hello') return;
        if (message.type === 'cancel') {
          const job = findOwnedJob(message.requestId, principal, message.conversationId);
          if (job && (job.status === 'queued' || job.status === 'running')) job.controller.abort();
          return;
        }
        const resolved = resolveCompanionPayload(database, principal, message.payload);
        if ('error' in resolved) {
          send(socket, { type: 'error', requestId: message.payload.requestId, code: resolved.error.code, message: resolved.error.message, retryable: false });
          return;
        }
        const payload = prepareGeneration(resolved.payload, config);
        if (payload.deviceId !== deviceId) { send(socket, { type: 'error', requestId: payload.requestId, code: 'device_mismatch', message: '设备标识不一致。', retryable: false }); return; }
        if (jobs.has(payload.requestId) || database.hasGenerationRequest(payload.requestId)) { send(socket, { type: 'error', requestId: payload.requestId, code: 'duplicate_request', message: '重复的请求标识。', retryable: false }); return; }
        const invalid = validateGeneration();
        if (invalid) { send(socket, { type: 'error', requestId: payload.requestId, ...invalid, retryable: false }); return; }
        const key = principal.id;
        const rate = limiter.consume(key);
        if (!rate.allowed) { send(socket, { type: 'error', requestId: payload.requestId, code: 'rate_limited', message: '请求过于频繁，请稍后再试。', retryable: true }); return; }
        if (!concurrency.acquire(key)) { send(socket, { type: 'error', requestId: payload.requestId, code: 'too_many_concurrent', message: '该账户的并发请求已达到上限。', retryable: true }); return; }
        const job = createJob(payload, principal, socket);
        if (!job) { concurrency.release(key); send(socket, { type: 'error', requestId: payload.requestId, code: 'duplicate_request', message: '重复的请求标识。', retryable: false }); return; }
        send(socket, { type: 'started', requestId: payload.requestId });
      })().catch((error: unknown) => {
        app.log.error({ err: error }, 'WebSocket frame processing failed');
        send(socket, { type: 'error', code: 'internal_error', message: '网关处理消息失败，请稍后重试。', retryable: true });
        socket.close(1011, 'internal error');
      });
    });
  });

  app.addHook('onClose', async () => {
    clearInterval(sessionSweep);
    clearInterval(snapshotCleanup);
    for (const job of jobs.values()) if (job.status === 'queued' || job.status === 'running') job.controller.abort();
    await Promise.allSettled([...jobs.values()].map((job) => job.promise));
    for (const timer of retentionTimers) clearTimeout(timer);
    retentionTimers.clear();
    for (const client of sockets.clients) client.terminate();
    sockets.close();
    database.close();
  });

  return app;
}
