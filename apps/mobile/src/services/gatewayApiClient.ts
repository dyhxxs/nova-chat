import { COMPANION_PROFILE_VERSION_HEADER, companionEventSchema, companionProfileInputSchema, companionProfileSchema, knowledgeImportInfoSchema, type CompanionEvent, type CompanionProfile, type CompanionProfileInput } from '@nova-chat/protocol';
import { z } from 'zod';
import { knowledgeDocumentSchema, knowledgeResultSchema, type KnowledgeResult, type KnowledgeDocument, type AttachmentRef, type ToolActivity } from '@nova-chat/protocol';
import { File, UploadType } from 'expo-file-system';
import { Platform } from 'react-native';
import { gatewayHttpErrorMessage } from '../lib/gatewayHttpError';
import { normalizeServerUrl, toRestUrl } from '../lib/connection';
import type { PendingAttachment, UserProfile } from '../types';
import { normalizeUserProfile } from '../lib/userDisplayName';
import { GatewayUploadResponseError, parseGatewayUploadResponse } from './gatewayUploadResponse';
import { appVersionHeaders, reportUpgradeRequired } from '../lib/appUpdate';
import type { AppUpdate } from '@nova-chat/protocol';

export class GatewayApiError extends Error {
  constructor(readonly code: string, message: string, readonly retryable: boolean, readonly status: number, readonly details?: AppUpdate) {
    super(message);
    this.name = 'GatewayApiError';
  }
}

export type SetupStatus = {
  needsBootstrap: boolean;
  bootstrapTokenRequired: boolean;
  registrationEnabled: boolean;
  providerConfigured?: boolean;
  appUpdate?: AppUpdate;
};

export type AttachmentUploadProgress = {
  bytesSent: number;
  totalBytes: number;
};

export type ProviderAdminSettings = {
  apiBaseUrlSet: boolean;
  apiMode: 'responses' | 'chat-completions';
  authMode: 'bearer' | 'api-key' | 'none';
  defaultModel: string;
  allowedModels: string[];
  apiKeySet: boolean;
  updatedAt?: number;
};

export type ProviderTestInput = {
  apiBaseUrl?: string;
  apiKey?: string;
  apiMode: 'responses' | 'chat-completions';
  authMode: 'bearer' | 'api-key' | 'none';
  defaultModel: string;
  allowedModels: string[];
};

export type GenerationJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type GenerationJob = {
  requestId: string;
  conversationId: string;
  status: GenerationJobStatus;
  text: string;
  model?: string;
  responseId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  attachments?: AttachmentRef[];
  segments?: string[];
  tools?: ToolActivity[];
  knowledge?: KnowledgeResult;
  error?: { code: string; message: string; retryable: boolean };
  createdAt: number;
  updatedAt: number;
};

type AuthResponse = { user: UserProfile; accessToken: string; expiresAt: number };

function normalizeAuthResponse(data: AuthResponse): AuthResponse {
  return { ...data, user: normalizeUserProfile(data.user) };
}

export async function requestJson<T>(
  serverUrl: string,
  route: string,
  options: RequestInit & { accessToken?: string; timeoutMs?: number } = {},
): Promise<T> {
  const base = normalizeServerUrl(serverUrl);
  if (!base) throw new GatewayApiError('invalid_server_url', '请先填写服务器地址。', false, 0);
  const controller = new AbortController();
  const { accessToken, timeoutMs = 15_000, signal: externalSignal, headers, ...init } = options;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const forwardAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    const hasBody = init.body !== undefined && init.body !== null;
    const isFormData = hasBody && init.body instanceof FormData;
    const response = await fetch(toRestUrl(base, route), {
      ...init,
      headers: {
        ...appVersionHeaders,
        ...(hasBody && !isFormData ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(route.startsWith('/v1/companions') ? { [COMPANION_PROFILE_VERSION_HEADER]: '3' } : {}),
        ...(headers ?? {}),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let data: any;
    try { data = text ? JSON.parse(text) : undefined; } catch { /* A proxy can return HTML, including HTTP 200. */ }
    if (!response.ok) {
      reportUpgradeRequired(base, data?.error ?? {});
      throw new GatewayApiError(
        String(data?.error?.code ?? `http_${response.status}`),
        String(data?.error?.message ?? gatewayHttpErrorMessage(response.status)),
        Boolean(data?.error?.retryable ?? response.status >= 500),
        response.status,
        data?.error?.details,
      );
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new GatewayApiError('invalid_gateway_response', '服务器返回的不是有效网关数据，请联系管理员检查入口地址和反向代理。', true, response.status);
    }
    return data as T;
  } catch (error) {
    if (error instanceof GatewayApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      if (externalSignal?.aborted) throw new GatewayApiError('aborted', '请求已取消。', false, 0);
      throw new GatewayApiError('timeout', '连接服务器超时。', true, 0);
    }
    throw new GatewayApiError('network_error', '无法连接服务器，请检查地址、网络和部署状态。', true, 0);
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', forwardAbort);
  }
}

export function fetchSetupStatus(serverUrl: string): Promise<SetupStatus> {
  return requestJson(serverUrl, '/v1/setup/status');
}

export function fetchAppUpdate(serverUrl: string, signal?: AbortSignal): Promise<{ update: AppUpdate | null }> {
  return requestJson(serverUrl, '/v1/app/update', { signal });
}

export async function login(serverUrl: string, input: { email: string; password: string; deviceId: string }): Promise<AuthResponse> {
  return normalizeAuthResponse(await requestJson<AuthResponse>(serverUrl, '/v1/auth/login', { method: 'POST', body: JSON.stringify(input) }));
}

export async function register(serverUrl: string, input: { email: string; password: string; displayName?: string; deviceId: string }): Promise<AuthResponse> {
  return normalizeAuthResponse(await requestJson<AuthResponse>(serverUrl, '/v1/auth/register', { method: 'POST', body: JSON.stringify(input) }));
}

export async function bootstrapAdmin(serverUrl: string, input: { email: string; password: string; displayName: string; deviceId: string; bootstrapToken: string }): Promise<AuthResponse> {
  return normalizeAuthResponse(await requestJson<AuthResponse>(serverUrl, '/v1/auth/bootstrap', { method: 'POST', body: JSON.stringify(input) }));
}

export async function getMe(serverUrl: string, accessToken: string, signal?: AbortSignal): Promise<UserProfile> {
  const data = await requestJson<{ user: UserProfile }>(serverUrl, '/v1/auth/me', { accessToken, signal });
  return normalizeUserProfile(data.user);
}

export function logout(serverUrl: string, accessToken: string): Promise<{ ok: true }> {
  return requestJson(serverUrl, '/v1/auth/logout', { method: 'POST', accessToken });
}

const companionsResponseSchema = z.object({ companions: z.array(companionProfileSchema).max(100) });
const companionResponseSchema = z.object({ companion: companionProfileSchema });

function parseCompanionResponse<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new GatewayApiError('invalid_companion_response', '服务器返回的陪伴角色格式不正确，请升级 Gateway。', false, 200);
  return parsed.data;
}

export async function listCompanions(serverUrl: string, accessToken: string, signal?: AbortSignal): Promise<CompanionProfile[]> {
  return parseCompanionResponse(companionsResponseSchema, await requestJson(serverUrl, '/v1/companions', { accessToken, signal })).companions;
}

export async function createCompanion(serverUrl: string, accessToken: string, input: CompanionProfileInput): Promise<CompanionProfile> {
  const safeInput = companionProfileInputSchema.parse(input);
  return parseCompanionResponse(companionResponseSchema, await requestJson(serverUrl, '/v1/companions', { method: 'POST', accessToken, body: JSON.stringify(safeInput) })).companion;
}

export async function updateCompanion(serverUrl: string, accessToken: string, id: string, input: CompanionProfileInput): Promise<CompanionProfile> {
  const safeInput = companionProfileInputSchema.parse(input);
  return parseCompanionResponse(companionResponseSchema, await requestJson(serverUrl, `/v1/companions/${encodeURIComponent(id)}`, { method: 'PATCH', accessToken, body: JSON.stringify(safeInput) })).companion;
}

export function deleteCompanion(serverUrl: string, accessToken: string, id: string): Promise<{ ok: true }> {
  return requestJson(serverUrl, `/v1/companions/${encodeURIComponent(id)}`, { method: 'DELETE', accessToken });
}

export async function listCompanionEvents(serverUrl: string, accessToken: string, companionId: string, conversationId: string, after = 0, signal?: AbortSignal): Promise<CompanionEvent[]> {
  const data = await requestJson<{ events: unknown[] }>(serverUrl, `/v1/companions/${encodeURIComponent(companionId)}/events?conversationId=${encodeURIComponent(conversationId)}&after=${Math.max(0, Math.floor(after))}`, { accessToken, signal });
  return z.array(companionEventSchema).parse(data.events ?? []);
}

const sessionListSchema = z.object({ sessions: z.array(z.object({
  id: z.string().uuid(), deviceId: z.string().max(128), createdAt: z.number().finite(), expiresAt: z.number().finite(), current: z.boolean(),
})) });
export type LoginSession = z.infer<typeof sessionListSchema>['sessions'][number];

export async function listLoginSessions(serverUrl: string, accessToken: string, signal?: AbortSignal): Promise<LoginSession[]> {
  const data = await requestJson(serverUrl, '/v1/auth/sessions', { accessToken, signal });
  const parsed = sessionListSchema.safeParse(data);
  if (!parsed.success) throw new GatewayApiError('invalid_gateway_response', '服务器返回的登录会话列表格式不正确，请升级 Gateway。', false, 200);
  return parsed.data.sessions;
}

async function securityMutation<T>(schema: z.ZodType<T>, request: Promise<unknown>): Promise<T> {
  const parsed = schema.safeParse(await request);
  if (!parsed.success) throw new GatewayApiError('invalid_gateway_response', '服务器未返回有效的安全操作确认，请刷新会话列表检查结果。', false, 200);
  return parsed.data;
}

export function revokeLoginSession(serverUrl: string, accessToken: string, sessionId: string): Promise<{ ok: true; currentSessionRevoked: boolean }> {
  return securityMutation(z.object({ ok: z.literal(true), currentSessionRevoked: z.boolean() }), requestJson(serverUrl, `/v1/auth/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE', accessToken }));
}

export function revokeOtherLoginSessions(serverUrl: string, accessToken: string): Promise<{ ok: true; revoked: number }> {
  return securityMutation(z.object({ ok: z.literal(true), revoked: z.number().int().nonnegative() }), requestJson(serverUrl, '/v1/auth/sessions/revoke-others', { method: 'POST', accessToken }));
}

export function changeAccountPassword(serverUrl: string, accessToken: string, currentPassword: string, newPassword: string): Promise<{ ok: true }> {
  return securityMutation(z.object({ ok: z.literal(true) }), requestJson(serverUrl, '/v1/auth/password', { method: 'POST', accessToken, body: JSON.stringify({ currentPassword, newPassword }) }));
}

export async function updateProfile(serverUrl: string, accessToken: string, patch: { displayName: string }): Promise<UserProfile> {
  const data = await requestJson<{ user: UserProfile }>(serverUrl, '/v1/auth/me', {
    method: 'PATCH', body: JSON.stringify(patch), accessToken,
  });
  return normalizeUserProfile(data.user);
}

export async function removeAvatar(serverUrl: string, accessToken: string): Promise<UserProfile> {
  const data = await requestJson<{ user: UserProfile }>(serverUrl, '/v1/auth/me/avatar', {
    method: 'DELETE', accessToken,
  });
  return normalizeUserProfile(data.user);
}

export function parseUploadJson<T>(serverUrl: string, status: number, body: string): T {
  let data: any = {};
  try { data = body ? JSON.parse(body) : {}; } catch { data = {}; }
  if (status < 200 || status >= 300) {
    reportUpgradeRequired(serverUrl, data?.error ?? {});
    throw new GatewayApiError(
      String(data?.error?.code ?? `http_${status}`),
      String(data?.error?.message ?? `服务器返回了 ${status}。`),
      Boolean(data?.error?.retryable ?? status >= 500),
      status,
      data?.error?.details,
    );
  }
  return data as T;
}

export async function uploadAvatar(serverUrl: string, accessToken: string, file: PendingAttachment): Promise<UserProfile> {
  if (Platform.OS === 'web') {
    const form = new FormData();
    form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as any);
    const data = await requestJson<{ user: UserProfile }>(serverUrl, '/v1/auth/me/avatar', {
      method: 'POST', body: form, accessToken, timeoutMs: 90_000,
    });
    return normalizeUserProfile(data.user);
  }

  const base = normalizeServerUrl(serverUrl);
  if (!base) throw new GatewayApiError('invalid_server_url', '请先填写服务器地址。', false, 0);
  let localFile: File;
  try {
    localFile = new File(file.uri);
    if (!localFile.exists) throw new Error('Local file does not exist or cannot be read.');
  } catch {
    throw new GatewayApiError('local_file_unavailable', `无法读取“${file.name}”，请重新选择该图片。`, false, 0);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const result = await localFile.upload(toRestUrl(base, '/v1/auth/me/avatar'), {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'file',
      mimeType: file.mimeType,
      headers: { ...appVersionHeaders, authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
      sessionType: 'foreground',
    });
    return normalizeUserProfile(parseUploadJson<{ user: UserProfile }>(base, result.status, result.body).user);
  } catch (error) {
    if (error instanceof GatewayApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GatewayApiError('upload_timeout', '头像上传超时，请稍后重试。', true, 0);
    }
    if (looksLikeLocalFileError(error)) {
      throw new GatewayApiError('local_file_unavailable', `无法读取“${file.name}”，请重新选择该图片。`, false, 0);
    }
    throw new GatewayApiError('upload_network_error', '头像上传失败，请检查网络和服务器状态。', true, 0);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchGatewayModels(serverUrl: string, accessToken: string, signal?: AbortSignal): Promise<{ models: string[]; defaultModel: string; apiMode: string }> {
  return requestJson(serverUrl, '/v1/models', { accessToken, signal });
}

function serverLabel(serverUrl: string): string {
  const normalized = normalizeServerUrl(serverUrl);
  if (!normalized) return '当前服务器';
  try { return new URL(normalized).host; } catch { return normalized; }
}

function looksLikeLocalFileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return [
    'enoent',
    'no such file',
    'file not found',
    'cannot open file',
    'could not open file',
    'permission denied',
    'read access',
    'content uri',
  ].some((fragment) => message.includes(fragment));
}

async function uploadAttachmentOnWeb(
  serverUrl: string,
  accessToken: string,
  file: PendingAttachment,
  onProgress?: (progress: AttachmentUploadProgress) => void,
): Promise<AttachmentRef> {
  const form = new FormData();
  form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as any);
  onProgress?.({ bytesSent: 0, totalBytes: file.size ?? 0 });
  const data = await requestJson<{ attachment: AttachmentRef }>(serverUrl, '/v1/files', {
    method: 'POST', body: form, accessToken, timeoutMs: 90_000,
  });
  onProgress?.({ bytesSent: file.size ?? 0, totalBytes: file.size ?? 0 });
  return data.attachment;
}

export async function uploadAttachment(
  serverUrl: string,
  accessToken: string,
  file: PendingAttachment,
  onProgress?: (progress: AttachmentUploadProgress) => void,
): Promise<AttachmentRef> {
  if (Platform.OS === 'web') return uploadAttachmentOnWeb(serverUrl, accessToken, file, onProgress);

  const base = normalizeServerUrl(serverUrl);
  if (!base) throw new GatewayApiError('invalid_server_url', '请先填写服务器地址。', false, 0);

  let localFile: File;
  try {
    localFile = new File(file.uri);
    if (!localFile.exists) {
      throw new Error('Local file does not exist or cannot be read.');
    }
  } catch {
    throw new GatewayApiError('local_file_unavailable', `无法读取“${file.name}”，请重新选择该文件。`, false, 0);
  }

  const controller = new AbortController();
  const timeoutMs = 90_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await localFile.upload(toRestUrl(base, '/v1/files'), {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'file',
      mimeType: file.mimeType,
      headers: { ...appVersionHeaders, authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
      sessionType: 'foreground',
    });
    return parseGatewayUploadResponse(result.status, result.body);
  } catch (error) {
    if (error instanceof GatewayApiError) throw error;
    if (error instanceof GatewayUploadResponseError) {
      reportUpgradeRequired(base, error);
      throw new GatewayApiError(error.code, error.message, error.retryable, error.status, error.details);
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GatewayApiError(
        'upload_timeout',
        `附件上传到 ${serverLabel(base)} 超时，请保持应用在前台后重试。`,
        true,
        0,
      );
    }
    if (looksLikeLocalFileError(error)) {
      throw new GatewayApiError('local_file_unavailable', `无法读取“${file.name}”，请重新选择该文件。`, false, 0);
    }
    throw new GatewayApiError(
      'upload_network_error',
      `无法上传附件到 ${serverLabel(base)}，请确认手机和电脑连接同一 Wi-Fi，且电脑端网关仍在运行。`,
      true,
      0,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function listUsers(serverUrl: string, accessToken: string): Promise<UserProfile[]> {
  const data = await requestJson<{ users: UserProfile[] }>(serverUrl, '/v1/admin/users', { accessToken });
  return data.users.map(normalizeUserProfile);
}

export async function updateUser(serverUrl: string, accessToken: string, userId: string, patch: Partial<Pick<UserProfile, 'role' | 'disabled' | 'displayName'>>): Promise<UserProfile> {
  const data = await requestJson<{ user: UserProfile }>(serverUrl, `/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH', body: JSON.stringify(patch), accessToken,
  });
  return normalizeUserProfile(data.user);
}

const providerSummarySchema = z.object({
  apiBaseUrlSet: z.boolean(), apiKeySet: z.boolean(),
  apiMode: z.enum(['responses', 'chat-completions']),
  authMode: z.enum(['bearer', 'api-key', 'none']),
  defaultModel: z.string(), allowedModels: z.array(z.string()), updatedAt: z.number().optional(),
});

function privateProviderSummary(value: unknown): ProviderAdminSettings {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  // Strip legacy server URL/key/preview and every unknown field before returning to any UI.
  const result = providerSummarySchema.safeParse({
    ...source,
    apiBaseUrlSet: typeof source.apiBaseUrlSet === 'boolean' ? source.apiBaseUrlSet : Boolean(source.apiBaseUrl),
  });
  if (!result.success) throw new GatewayApiError('invalid_provider_response', '模型服务状态格式不正确，请更新网关。', false, 502);
  return result.data;
}

export async function getProviderSettings(serverUrl: string, accessToken: string): Promise<ProviderAdminSettings> {
  const data = await requestJson<{ provider: ProviderAdminSettings }>(serverUrl, '/v1/admin/provider', { accessToken });
  return privateProviderSummary(data.provider);
}

export async function saveProviderSettings(
  serverUrl: string,
  accessToken: string,
  input: ProviderTestInput,
): Promise<ProviderAdminSettings> {
  const data = await requestJson<{ provider: ProviderAdminSettings }>(serverUrl, '/v1/admin/provider', {
    method: 'PUT', body: JSON.stringify(input), accessToken,
  });
  return privateProviderSummary(data.provider);
}

export async function testProvider(serverUrl: string, accessToken: string, input?: ProviderTestInput): Promise<string[]> {
  const data = await requestJson<{ ok: true; models: string[] }>(serverUrl, '/v1/admin/provider/test', {
    method: 'POST', accessToken, timeoutMs: 30_000, ...(input ? { body: JSON.stringify(input) } : {}),
  });
  return data.models;
}

function generationJobRoute(requestId: string, conversationId: string, action?: 'cancel'): string {
  const route = `/v1/chat/jobs/${encodeURIComponent(requestId)}${action === 'cancel' ? '/cancel' : ''}`;
  return `${route}?conversationId=${encodeURIComponent(conversationId)}`;
}

export function getGenerationJob(
  serverUrl: string,
  accessToken: string,
  requestId: string,
  conversationId: string,
  signal?: AbortSignal,
): Promise<GenerationJob> {
  return requestJson<GenerationJob>(serverUrl, generationJobRoute(requestId, conversationId), {
    accessToken,
    timeoutMs: 15_000,
    signal,
  });
}

export function cancelGenerationJob(
  serverUrl: string,
  accessToken: string,
  requestId: string,
  conversationId: string,
): Promise<{ ok: true; status: GenerationJobStatus | 'cancelling' }> {
  return requestJson<{ ok: true; status: GenerationJobStatus | 'cancelling' }>(
    serverUrl,
    generationJobRoute(requestId, conversationId, 'cancel'),
    { method: 'POST', accessToken, timeoutMs: 10_000 },
  );
}

const knowledgeListSchema = z.object({
  documents: z.array(knowledgeDocumentSchema).max(100),
  usage: z.object({ documents: z.number(), chars: z.number() }),
  limits: z.object({ documents: z.number(), totalChars: z.number(), documentChars: z.number() }),
});
export async function listKnowledge(serverUrl: string, accessToken: string) {
  return knowledgeListSchema.parse(await requestJson(serverUrl, '/v1/knowledge', { accessToken }));
}
export async function getKnowledge(serverUrl: string, accessToken: string, id: string) {
  const data = await requestJson(serverUrl, '/v1/knowledge/' + encodeURIComponent(id), { accessToken });
  return z.object({ document: knowledgeDocumentSchema.extend({ text: z.string().max(120_000) }) }).parse(data).document;
}
export async function saveKnowledge(serverUrl: string, accessToken: string, input: { title: string; text: string; expectedUpdatedAt?: number }, id?: string) {
  const data = await requestJson(serverUrl, '/v1/knowledge' + (id ? '/' + encodeURIComponent(id) : ''), { accessToken, method: id ? 'PUT' : 'POST', body: JSON.stringify(input), timeoutMs: 30_000 });
  return z.object({ document: knowledgeDocumentSchema, duplicate: z.boolean() }).parse(data);
}
export async function importKnowledge(serverUrl: string, accessToken: string, fileId: string) {
  return z.object({ document: knowledgeDocumentSchema, duplicate: z.boolean(), importInfo: knowledgeImportInfoSchema.optional() }).parse(await requestJson(serverUrl, '/v1/knowledge/import', { accessToken, method: 'POST', body: JSON.stringify({ fileId }), timeoutMs: 30_000 }));
}
export function deleteKnowledge(serverUrl: string, accessToken: string, id: string): Promise<{ ok: true }> {
  return requestJson(serverUrl, '/v1/knowledge/' + encodeURIComponent(id), { accessToken, method: 'DELETE' });
}
export async function searchKnowledge(serverUrl: string, accessToken: string, query: string): Promise<KnowledgeResult> {
  return knowledgeResultSchema.parse(await requestJson(serverUrl, '/v1/knowledge/search?q=' + encodeURIComponent(query), { accessToken }));
}
export type { KnowledgeDocument };

export async function getCompanionProviderSettings(serverUrl: string, accessToken: string, purpose: 'chat' | 'image'): Promise<ProviderAdminSettings> {
  const data = await requestJson<{ provider: ProviderAdminSettings }>(serverUrl, `/v1/admin/companion-provider/${purpose}`, { accessToken });
  return privateProviderSummary(data.provider);
}
export async function saveCompanionProviderSettings(serverUrl: string, accessToken: string, purpose: 'chat' | 'image', input: ProviderTestInput): Promise<ProviderAdminSettings> {
  const data = await requestJson<{ provider: ProviderAdminSettings }>(serverUrl, `/v1/admin/companion-provider/${purpose}`, { method: 'PUT', accessToken, body: JSON.stringify(input) });
  return privateProviderSummary(data.provider);
}

export async function testCompanionProvider(serverUrl: string, accessToken: string, purpose: 'chat' | 'image', input?: Pick<ProviderTestInput, 'apiBaseUrl' | 'apiKey' | 'apiMode' | 'authMode'>): Promise<string[]> {
  const data = await requestJson(serverUrl, `/v1/admin/companion-provider/${purpose}/test`, {
    method: 'POST', accessToken, timeoutMs: 30_000, ...(input ? { body: JSON.stringify(input) } : {}),
  });
  return z.object({ ok: z.literal(true), models: z.array(z.string().min(1).max(100)).max(1000) }).parse(data).models;
}

export async function getCompanion(serverUrl: string, accessToken: string, id: string): Promise<CompanionProfile> {
  return parseCompanionResponse(companionResponseSchema, await requestJson(serverUrl, `/v1/companions/${encodeURIComponent(id)}`, { accessToken })).companion;
}

export function registerCompanionPushDevice(serverUrl: string, accessToken: string, token: string, signal?: AbortSignal): Promise<{ ok: true }> {
  return requestJson(serverUrl, '/v1/companion-notifications/device', { accessToken, method: 'PUT',
    body: JSON.stringify({ token, serverUrl: normalizeServerUrl(serverUrl) }), signal });
}
