import type { AttachmentRef } from '@nova-chat/protocol';
import { File, UploadType } from 'expo-file-system';
import { Platform } from 'react-native';
import { normalizeServerUrl, toRestUrl } from '../lib/connection';
import type { PendingAttachment, UserProfile } from '../types';
import { normalizeUserProfile } from '../lib/userDisplayName';
import { GatewayUploadResponseError, parseGatewayUploadResponse } from './gatewayUploadResponse';

export class GatewayApiError extends Error {
  constructor(readonly code: string, message: string, readonly retryable: boolean, readonly status: number) {
    super(message);
    this.name = 'GatewayApiError';
  }
}

export type SetupStatus = {
  needsBootstrap: boolean;
  bootstrapTokenRequired: boolean;
  registrationEnabled: boolean;
};

export type AttachmentUploadProgress = {
  bytesSent: number;
  totalBytes: number;
};

export type ProviderAdminSettings = {
  apiBaseUrl: string;
  apiMode: 'responses' | 'chat-completions';
  authMode: 'bearer' | 'api-key' | 'none';
  defaultModel: string;
  allowedModels: string[];
  apiKeySet: boolean;
  apiKeyPreview: string;
  updatedAt?: number;
};

export type ProviderTestInput = {
  apiBaseUrl: string;
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
  error?: { code: string; message: string; retryable: boolean };
  createdAt: number;
  updatedAt: number;
};

type AuthResponse = { user: UserProfile; accessToken: string; expiresAt: number };

function normalizeAuthResponse(data: AuthResponse): AuthResponse {
  return { ...data, user: normalizeUserProfile(data.user) };
}

async function requestJson<T>(
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
    const response = await fetch(toRestUrl(base, route), {
      ...init,
      headers: {
        ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(headers ?? {}),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    if (!response.ok) {
      throw new GatewayApiError(
        String(data?.error?.code ?? `http_${response.status}`),
        String(data?.error?.message ?? `服务器返回了 ${response.status}。`),
        Boolean(data?.error?.retryable ?? response.status >= 500),
        response.status,
      );
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

export async function login(serverUrl: string, input: { email: string; password: string; deviceId: string }): Promise<AuthResponse> {
  return normalizeAuthResponse(await requestJson<AuthResponse>(serverUrl, '/v1/auth/login', { method: 'POST', body: JSON.stringify(input) }));
}

export async function register(serverUrl: string, input: { email: string; password: string; displayName: string; deviceId: string }): Promise<AuthResponse> {
  return normalizeAuthResponse(await requestJson<AuthResponse>(serverUrl, '/v1/auth/register', { method: 'POST', body: JSON.stringify(input) }));
}

export async function bootstrapAdmin(serverUrl: string, input: { email: string; password: string; displayName: string; deviceId: string; bootstrapToken: string }): Promise<AuthResponse> {
  return normalizeAuthResponse(await requestJson<AuthResponse>(serverUrl, '/v1/auth/bootstrap', { method: 'POST', body: JSON.stringify(input) }));
}

export async function getMe(serverUrl: string, accessToken: string): Promise<UserProfile> {
  const data = await requestJson<{ user: UserProfile }>(serverUrl, '/v1/auth/me', { accessToken });
  return normalizeUserProfile(data.user);
}

export function logout(serverUrl: string, accessToken: string): Promise<{ ok: true }> {
  return requestJson(serverUrl, '/v1/auth/logout', { method: 'POST', accessToken });
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

function parseUploadJson<T>(status: number, body: string): T {
  let data: any = {};
  try { data = body ? JSON.parse(body) : {}; } catch { data = {}; }
  if (status < 200 || status >= 300) {
    throw new GatewayApiError(
      String(data?.error?.code ?? `http_${status}`),
      String(data?.error?.message ?? `服务器返回了 ${status}。`),
      Boolean(data?.error?.retryable ?? status >= 500),
      status,
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
      headers: { authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
      sessionType: 'foreground',
    });
    return normalizeUserProfile(parseUploadJson<{ user: UserProfile }>(result.status, result.body).user);
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

export async function fetchGatewayModels(serverUrl: string, accessToken: string): Promise<{ models: string[]; defaultModel: string; apiMode: string }> {
  return requestJson(serverUrl, '/v1/models', { accessToken });
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
      headers: { authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
      sessionType: 'foreground',
    });
    return parseGatewayUploadResponse(result.status, result.body);
  } catch (error) {
    if (error instanceof GatewayApiError) throw error;
    if (error instanceof GatewayUploadResponseError) {
      throw new GatewayApiError(error.code, error.message, error.retryable, error.status);
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

export async function getProviderSettings(serverUrl: string, accessToken: string): Promise<ProviderAdminSettings> {
  const data = await requestJson<{ provider: ProviderAdminSettings }>(serverUrl, '/v1/admin/provider', { accessToken });
  return data.provider;
}

export async function saveProviderSettings(
  serverUrl: string,
  accessToken: string,
  input: Omit<ProviderAdminSettings, 'apiKeySet' | 'apiKeyPreview' | 'updatedAt'> & { apiKey?: string },
): Promise<ProviderAdminSettings> {
  const data = await requestJson<{ provider: ProviderAdminSettings }>(serverUrl, '/v1/admin/provider', {
    method: 'PUT', body: JSON.stringify(input), accessToken,
  });
  return data.provider;
}

export async function testProvider(serverUrl: string, accessToken: string, input?: ProviderTestInput): Promise<string[]> {
  const data = await requestJson<{ ok: true; models: string[] }>(serverUrl, '/v1/admin/provider/test', {
    method: 'POST', accessToken, timeoutMs: 30_000, ...(input ? { body: JSON.stringify(input) } : {}),
  });
  return data.models;
}

export function getGenerationJob(
  serverUrl: string,
  accessToken: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<GenerationJob> {
  return requestJson<GenerationJob>(serverUrl, `/v1/chat/jobs/${encodeURIComponent(requestId)}`, {
    accessToken,
    timeoutMs: 15_000,
    signal,
  });
}

export function cancelGenerationJob(
  serverUrl: string,
  accessToken: string,
  requestId: string,
): Promise<{ ok: true; status: GenerationJobStatus | 'cancelling' }> {
  return requestJson<{ ok: true; status: GenerationJobStatus | 'cancelling' }>(
    serverUrl,
    `/v1/chat/jobs/${encodeURIComponent(requestId)}/cancel`,
    { method: 'POST', accessToken, timeoutMs: 10_000 },
  );
}
