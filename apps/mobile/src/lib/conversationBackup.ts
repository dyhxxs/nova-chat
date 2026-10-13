import { z } from 'zod';
import { createId } from './id';
import type { AppMessage, Conversation } from '../types';

export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
const timestamp = z.number().int().min(0).max(8_640_000_000_000_000);
const text = z.string().max(2_000_000);
const attachment = z.object({
  name: z.string().max(255), kind: z.enum(['image', 'document']),
  mimeType: z.string().max(150), size: z.number().int().min(0),
});
const message = z.object({
  role: z.enum(['user', 'assistant']), content: text, createdAt: timestamp,
  status: z.enum(['complete', 'streaming', 'error', 'cancelled']),
  attachments: z.array(attachment).max(100).default([]),
  model: z.string().max(200).optional(), requestedModel: z.string().max(200).optional(), starred: z.boolean().default(false),
});
const backupConversation = z.object({
  sourceId: z.string().min(1).max(160), title: z.string().min(1).max(200),
  createdAt: timestamp, updatedAt: timestamp,
  pinned: z.boolean().default(false), archived: z.boolean().default(false),
  messages: z.array(message).max(50_000),
});
export const conversationBackupSchema = z.object({
  format: z.literal('nova-chat-conversations'), version: z.literal(1), exportedAt: timestamp,
  conversations: z.array(backupConversation).max(5_000),
});
export type ConversationBackup = z.infer<typeof conversationBackupSchema>;

/** Counts UTF-8 without depending on Node Buffer or a native TextEncoder polyfill. */
export function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

export function createConversationBackup(conversations: readonly Conversation[], now = Date.now()): ConversationBackup {
  // Explicit allowlist: no session, account, gateway, instructions, local URIs,
  // server file IDs, error payloads or resumable generation requests leave here.
  return conversationBackupSchema.parse({
    format: 'nova-chat-conversations', version: 1, exportedAt: now,
    conversations: conversations.map((item) => ({
      sourceId: item.importSourceId ?? item.id, title: item.title,
      createdAt: item.createdAt, updatedAt: item.updatedAt,
      pinned: Boolean(item.pinned), archived: Boolean(item.archived),
      messages: item.messages.map((entry) => ({
        role: entry.role, content: entry.content, createdAt: entry.createdAt, status: entry.status,
        model: entry.model, requestedModel: entry.requestedModel, starred: Boolean(entry.starred),
        attachments: entry.attachments.map((file) => ({ name: file.name, kind: file.kind, mimeType: file.mimeType, size: file.size })),
      })),
    })),
  });
}

export function serializeConversationBackup(conversations: readonly Conversation[]): string {
  const json = JSON.stringify(createConversationBackup(conversations), null, 2);
  if (utf8Bytes(json) > MAX_BACKUP_BYTES) throw new Error('备份超过 20 MB，请从历史记录中分批导出单个对话。');
  return json;
}

export function parseConversationBackup(json: string): ConversationBackup {
  if (json.length > MAX_BACKUP_BYTES || utf8Bytes(json) > MAX_BACKUP_BYTES) throw new Error('备份不能超过 20 MB。');
  let value: unknown;
  try { value = JSON.parse(json.replace(/^\uFEFF/, '')); } catch { throw new Error('文件不是有效的 JSON 备份。'); }
  const result = conversationBackupSchema.safeParse(value);
  if (!result.success) throw new Error('备份格式不正确或版本不受支持。请选择 Nova 导出的 v1 对话备份。');
  const ids = new Set<string>();
  for (const item of result.data.conversations) {
    if (ids.has(item.sourceId)) throw new Error('备份包含重复的对话标识，未导入任何数据。');
    ids.add(item.sourceId);
  }
  return result.data;
}

export function mergeConversationBackup(existing: Conversation[], backup: ConversationBackup) {
  const seen = new Set(existing.flatMap((item) => [item.id, ...(item.importSourceId ? [item.importSourceId] : [])]));
  const imported: Conversation[] = [];
  let skipped = 0;
  for (const item of backup.conversations) {
    if (seen.has(item.sourceId)) { skipped += 1; continue; }
    seen.add(item.sourceId);
    imported.push({
      id: createId(), importSourceId: item.sourceId, title: item.title,
      createdAt: item.createdAt, updatedAt: item.updatedAt, pinned: item.pinned, archived: item.archived,
      messages: item.messages.map((entry): AppMessage => ({
        id: createId(), role: entry.role, createdAt: entry.createdAt,
        content: [entry.content, ...entry.attachments.map((file) => `[附件记录：${file.name}（文件本体未包含在备份中）]`)].filter(Boolean).join('\n\n'),
        attachments: [], model: entry.model, requestedModel: entry.requestedModel, starred: entry.starred,
        // A portable backup is a snapshot, never a command to resume/rebill a job.
        status: entry.status === 'streaming' ? 'cancelled' : entry.status,
        ...(entry.status === 'error' ? { errorMessage: '此回答在导出时未完成。', retryable: true } : {}),
      })),
    });
  }
  return { conversations: [...imported, ...existing], imported: imported.length, skipped };
}

export function conversationMarkdown(conversation: Conversation): string {
  const heading = (value: string) => value.replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}[\]<>#!|]/g, '\\$&');
  const lines = [`# ${heading(conversation.title)}`, '', '> Nova 对话文本导出。附件仅含名称，不含文件；内容由用户及模型产生。', ''];
  for (const entry of conversation.messages) {
    lines.push(`## ${entry.role === 'user' ? '你' : '助手'} · ${new Date(entry.createdAt).toISOString()}`, '');
    if (entry.model) lines.push(`模型：${heading(entry.model)}`, '');
    lines.push(entry.content || '（无文本内容）', '');
    for (const file of entry.attachments) lines.push(`- 附件：${heading(file.name)}（未包含文件）`);
    if (entry.status !== 'complete') lines.push(`> 导出时状态：${entry.status}`);
    lines.push('', '---', '');
  }
  return lines.join('\n');
}
