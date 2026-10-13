import { readFile } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { knowledgeDocumentInputSchema } from '@nova-chat/protocol';
import type { AppDatabase } from './database.js';
import { pdfTextExtractor } from './pdfText.js';
import { extractAttachmentText } from './attachments.js';
import { KnowledgeError } from './knowledge.js';

export function registerKnowledgeRoutes(app: FastifyInstance, database: AppDatabase, requireUser: (request: FastifyRequest, reply: FastifyReply) => { id: string } | undefined) {
  const route = (handler: (request: FastifyRequest, reply: FastifyReply, userId: string) => unknown) => async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = requireUser(request, reply);
    if (!principal) return;
    if (!database.getUserById(principal.id)) return reply.code(403).send({ error: { code: 'knowledge_account_required', message: '个人资料库需要独立账户登录，不能使用共享令牌。', retryable: false } });
    try { return await handler(request, reply, principal.id); }
    catch (error) {
      if (error instanceof KnowledgeError) return reply.code(error.status).send({ error: { code: error.code, message: error.message, retryable: error.code === 'pdf_busy' } });
      request.log.warn({ error: error instanceof Error ? error.name : 'unknown' }, 'knowledge operation failed');
      return reply.code(500).send({ error: { code: 'knowledge_failed', message: '资料库操作失败，请重试。', retryable: true } });
    }
  };
  const invalid = (reply: FastifyReply) => reply.code(400).send({ error: { code: 'invalid_knowledge_request', message: '请检查资料标题、正文或搜索词的长度。', retryable: false } });
  const idOf = (request: FastifyRequest) => String((request.params as { id?: string }).id ?? '');
  app.get('/v1/knowledge', route((_request, _reply, userId) => database.knowledge.list(userId)));
  app.get('/v1/knowledge/search', route((request, reply, userId) => {
    const parsed = z.object({ q: z.string().trim().min(1).max(200) }).safeParse(request.query);
    return parsed.success ? database.knowledge.search(userId, parsed.data.q) : invalid(reply);
  }));
  app.get('/v1/knowledge/:id', route((request, _reply, userId) => ({ document: database.knowledge.get(userId, idOf(request)) })));
  app.post('/v1/knowledge', route((request, reply, userId) => {
    const parsed = knowledgeDocumentInputSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply);
    const result = database.knowledge.save(userId, parsed.data.title, parsed.data.text);
    return reply.code(result.duplicate ? 200 : 201).send(result);
  }));
  app.put('/v1/knowledge/:id', route((request, reply, userId) => {
    const parsed = knowledgeDocumentInputSchema.extend({ expectedUpdatedAt: z.number().finite().nonnegative() }).safeParse(request.body);
    return parsed.success ? database.knowledge.save(userId, parsed.data.title, parsed.data.text, undefined, idOf(request), parsed.data.expectedUpdatedAt) : invalid(reply);
  }));
  app.delete('/v1/knowledge/:id', route((request, _reply, userId) => {
    database.knowledge.delete(userId, idOf(request));
    return { ok: true };
  }));
  app.post('/v1/knowledge/import', route(async (request, reply, userId) => {
    const parsed = z.object({ fileId: z.string().uuid(), title: z.string().trim().min(1).max(160).optional() }).strict().safeParse(request.body);
    if (!parsed.success) return invalid(reply);
    const file = database.getFile(parsed.data.fileId);
    if (!file || file.userId !== userId) throw new KnowledgeError(404, 'file_not_found', '附件不存在或不属于当前账户。');
    if (file.kind !== 'document') throw new KnowledgeError(415, 'knowledge_unsupported', '资料库仅支持可提取文字的文档，不支持图片或扫描件。');
    const pdf = file.mimeType === 'application/pdf' ? await pdfTextExtractor.extract(file.storagePath, userId) : undefined;
    const text = pdf?.text ?? extractAttachmentText(file.mimeType, await readFile(file.storagePath), 120_001);
    if (!text) throw new KnowledgeError(415, 'knowledge_unsupported', '此文件无法提取文字。请使用 TXT、Markdown、DOCX、XLSX、PPTX、ODT 或 EPUB；文字型 PDF 也可导入，但不支持扫描件和旧版二进制 Office 文件。');
    if (!requireUser(request, reply)) return;
    // Validate ownership again after disk I/O and reject truncation rather than silently losing content.
    if (database.getFile(file.id)?.userId !== userId) throw new KnowledgeError(404, 'file_not_found', '附件已不可用。');
    const result = database.knowledge.save(userId, parsed.data.title ?? file.name.slice(0, 160), text, file.name);
    return reply.code(result.duplicate ? 200 : 201).send({ ...result, ...(pdf ? { importInfo: pdf.importInfo } : {}) });
  }));
}
