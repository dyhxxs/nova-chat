import { conversationSyncResponseSchema, syncedConversationSchema, type ConversationSyncItem } from '@nova-chat/protocol';
import { appVersionHeaders } from '../lib/appUpdate';
import { normalizeServerUrl, toRestUrl } from '../lib/connection';
import type { Conversation } from '../types';

/**
 * Cross-device conversation sync API. This module deliberately avoids importing
 * react-native or expo so the store (which imports it) stays testable without a
 * react-native mock. It mirrors the gateway's JSON contract for /v1/conversations.
 */
export type RemoteConversationSync = {
  items: ConversationSyncItem[];
  cursor: number;
};

export class ConversationSyncApiError extends Error {
  constructor(readonly status: number, message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'ConversationSyncApiError';
  }
}

async function syncRequest<T>(
  serverUrl: string,
  route: string,
  options: { accessToken?: string; method?: string; body?: unknown; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const base = normalizeServerUrl(serverUrl);
  if (!base) throw new ConversationSyncApiError(0, '服务器地址无效。', false);
  const { accessToken, method = 'GET', body, timeoutMs = 20_000, signal } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    const hasBody = body !== undefined;
    const response = await fetch(toRestUrl(base, route), {
      method,
      headers: {
        ...appVersionHeaders,
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      let data: any;
      try { data = text ? JSON.parse(text) : undefined; } catch { /* proxy HTML */ }
      throw new ConversationSyncApiError(
        response.status,
        String(data?.error?.message ?? `请求失败（${response.status}）。`),
        Boolean(data?.error?.retryable ?? response.status >= 500),
      );
    }
    const data = await response.json() as T;
    return data;
  } catch (error) {
    if (error instanceof ConversationSyncApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      if (signal?.aborted) throw new ConversationSyncApiError(0, '请求已取消。', false);
      throw new ConversationSyncApiError(0, '连接服务器超时。', true);
    }
    throw new ConversationSyncApiError(0, '无法连接服务器，请检查地址、网络和部署状态。', true);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

export function listRemoteConversations(serverUrl: string, accessToken: string, cursor = 0, signal?: AbortSignal): Promise<RemoteConversationSync> {
  return syncRequest<unknown>(serverUrl, `/v1/conversations?cursor=${Math.max(0, Math.trunc(cursor))}`, { accessToken, timeoutMs: 30_000, signal })
    .then((data) => conversationSyncResponseSchema.parse(data));
}

export function putRemoteConversation(serverUrl: string, accessToken: string, conversation: Conversation): Promise<{ ok: true; revision: number }> {
  const safe = syncedConversationSchema.parse(conversation);
  return syncRequest<{ ok: true; revision: number }>(serverUrl, `/v1/conversations/${encodeURIComponent(safe.id)}`, {
    method: 'PUT', accessToken, body: conversation, timeoutMs: 30_000,
  });
}

export function deleteRemoteConversation(serverUrl: string, accessToken: string, id: string): Promise<{ ok: true; revision: number }> {
  return syncRequest<{ ok: true; revision: number }>(serverUrl, `/v1/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE', accessToken, timeoutMs: 15_000,
  });
}

export function clearRemoteConversations(serverUrl: string, accessToken: string): Promise<{ ok: true; deleted: number; cursor: number }> {
  return syncRequest<{ ok: true; deleted: number; cursor: number }>(serverUrl, '/v1/conversations/clear', {
    method: 'POST', accessToken, timeoutMs: 15_000,
  });
}
