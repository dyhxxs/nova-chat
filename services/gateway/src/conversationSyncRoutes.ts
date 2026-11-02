import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { conversationSyncResponseSchema, syncedConversationSchema } from '@nova-chat/protocol';
import type { AppDatabase } from './database.js';

/**
 * Cross-device conversation sync. Conversations are opaque client payloads:
 * the gateway only interprets `id` (sync key) and stores the rest verbatim.
 * `updatedAt` is the client's own timestamp and is used by clients for
 * last-write-wins; the gateway assigns an independent monotonic revision that
 * serves as the incremental pull cursor.
 */
export function registerConversationSyncRoutes(
  app: FastifyInstance,
  database: AppDatabase,
  requireUser: (request: FastifyRequest, reply: FastifyReply) => { id: string; sessionId: string } | undefined,
) {
  const route = (handler: (request: FastifyRequest, reply: FastifyReply, userId: string) => unknown) => async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = requireUser(request, reply);
    if (!principal) return;
    if (principal.sessionId === 'legacy') {
      return reply.code(403).send({ error: { code: 'account_required', message: '跨设备同步需要登录账户，不能使用共享令牌。', retryable: false } });
    }
    try {
      return await handler(request, reply, principal.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('size limit') || message.includes('count limit')) {
        return reply.code(413).send({ error: { code: 'sync_limit', message, retryable: false } });
      }
      request.log.warn({ error: error instanceof Error ? error.name : 'unknown' }, 'conversation sync operation failed');
      return reply.code(500).send({ error: { code: 'sync_failed', message: '同步操作失败，请重试。', retryable: true } });
    }
  };

  app.get('/v1/conversations', route((request, _reply, userId) => {
    const parsed = z.object({ cursor: z.coerce.number().int().min(0).default(0) }).safeParse(request.query);
    const after = parsed.success ? parsed.data.cursor : 0;
    return conversationSyncResponseSchema.parse(database.listSyncedConversations(userId, after));
  }));

  app.put('/v1/conversations/:id', route((request, reply, userId) => {
    const id = String((request.params as { id?: string }).id ?? '');
    const parsed = syncedConversationSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.id !== id) {
      return reply.code(400).send({ error: { code: 'invalid_conversation', message: '会话数据格式不正确。', retryable: false } });
    }
    const revision = database.saveSyncedConversation(userId, id, request.body);
    return { ok: true as const, revision };
  }));

  app.delete('/v1/conversations/:id', route((request, _reply, userId) => {
    const id = String((request.params as { id?: string }).id ?? '');
    const revision = database.deleteSyncedConversation(userId, id);
    return { ok: true as const, revision };
  }));

  app.post('/v1/conversations/clear', route((_request, _reply, userId) => {
    const result = database.clearSyncedConversations(userId);
    return { ok: true as const, deleted: result.deleted, cursor: result.revision };
  }));
}
