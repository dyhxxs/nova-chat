import { describe, expect, it } from 'vitest';
import { conversationMarkdown, createConversationBackup, mergeConversationBackup, parseConversationBackup, serializeConversationBackup, utf8Bytes } from '../src/lib/conversationBackup';
import { selectConversations } from '../src/lib/conversationHistory';
import type { Conversation } from '../src/types';

const conversation: Conversation = {
  id: 'original-conversation', title: '技术讨论', createdAt: 1, updatedAt: 2, pinned: true,
  draft: 'unsent-private-draft',
  assistant: { name: 'private-assistant-name', instructions: 'private-assistant-instructions' },
  messages: [{ id: 'message-a', role: 'assistant', content: '测试回答 🤖', createdAt: 1, status: 'streaming',
    generationRequestId: 'live-request-secret', model: 'model-test', requestedModel: 'model-requested',
    attachments: [{ id: 'file-secret-id', name: '预算表.pdf', mimeType: 'application/pdf', size: 42, kind: 'document', uri: 'file:///private/secret' }],
    generationOptions: { reasoningEffort: 'high', verbosity: 'medium', maxOutputTokens: 8192, webSearch: false, codeInterpreter: false },
  }],
};

describe('portable conversation backups', () => {
  it('exports only allowlisted text and metadata, never live requests, credentials or URIs', () => {
    const json = serializeConversationBackup([conversation]);
    expect(json).toContain('测试回答');
    expect(json).toContain('预算表.pdf');
    for (const secret of ['file-secret-id', 'live-request-secret', 'file:///private', 'generationOptions', 'accessToken', 'unsent-private-draft', 'private-assistant-name', 'private-assistant-instructions']) expect(json).not.toContain(secret);
    expect(parseConversationBackup(`\uFEFF${json}`).conversations).toHaveLength(1);
  });

  it('imports additive copies with fresh UUIDs and no attachments or running tasks', () => {
    const backup = createConversationBackup([conversation]);
    const result = mergeConversationBackup([], backup);
    expect(result.imported).toBe(1);
    const imported = result.conversations[0]!;
    expect(imported.id).not.toBe(conversation.id);
    expect(imported.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(imported.importSourceId).toBe(conversation.id);
    expect(imported.messages[0]).toEqual(expect.objectContaining({ status: 'cancelled', attachments: [], model: 'model-test' }));
    expect(imported.messages[0]?.content).toContain('文件本体未包含在备份中');
    expect(imported.messages[0]?.generationRequestId).toBeUndefined();
    expect(mergeConversationBackup(result.conversations, backup)).toEqual({ conversations: result.conversations, imported: 0, skipped: 1 });
    expect(mergeConversationBackup([conversation], backup).skipped).toBe(1);
    expect(createConversationBackup(result.conversations).conversations[0]?.sourceId).toBe(conversation.id);
  });

  it('validates the whole backup before allowing any import', () => {
    const backup = createConversationBackup([conversation]);
    expect(() => parseConversationBackup('not json')).toThrow('JSON');
    expect(() => parseConversationBackup(JSON.stringify({ ...backup, version: 999 }))).toThrow('版本');
    expect(() => parseConversationBackup(JSON.stringify({ ...backup, conversations: [...backup.conversations, ...backup.conversations] }))).toThrow('重复');
    expect(() => parseConversationBackup(JSON.stringify({ ...backup, conversations: [{ ...backup.conversations[0], messages: [null] }] }))).toThrow('格式');
    expect(() => parseConversationBackup(JSON.stringify({ ...backup, conversations: [{ ...backup.conversations[0], createdAt: -1 }] }))).toThrow('格式');
  });

  it('enforces UTF-8 size including multibyte Chinese and emoji', () => {
    expect(utf8Bytes('ABC中文🤖')).toBe(13);
    expect(utf8Bytes('\ud800')).toBe(3);
    expect(() => parseConversationBackup('中'.repeat(7_000_000))).toThrow('20 MB');
  });

  it('exports readable Markdown without leaking raw attachment paths', () => {
    const markdown = conversationMarkdown(conversation);
    expect(markdown).toContain('# 技术讨论');
    expect(markdown).toContain('测试回答 🤖');
    expect(markdown).toContain('预算表.pdf');
    expect(markdown).toContain('streaming');
    expect(markdown).not.toContain('file-secret-id');
    expect(markdown).not.toContain('file:///');
    expect(markdown).not.toContain('unsent-private-draft');
    expect(markdown).not.toContain('private-assistant-instructions');
  });
});

describe('history organization', () => {
  const newer = { ...conversation, id: 'newer', title: '其他', pinned: false, updatedAt: 10, messages: [] };
  const archived = { ...conversation, id: 'archived', archived: true };
  it('shows active pinned conversations first without mutating the source array', () => {
    const items = [newer, archived, conversation];
    expect(selectConversations(items).map((item) => item.id)).toEqual([conversation.id, newer.id]);
    expect(items[0]).toBe(newer);
    expect(selectConversations(items, '', 'pinned').map((item) => item.id)).toEqual([conversation.id]);
    expect(selectConversations(items, '', 'archived').map((item) => item.id)).toEqual(['archived']);
    expect(selectConversations(items, '', 'all')).toHaveLength(3);
  });
  it('searches all query words across content, model and attachment names with Unicode normalization', () => {
    expect(selectConversations([conversation], 'MODEL-TEST 预算表')).toHaveLength(1);
    expect(selectConversations([conversation], 'ｍｏｄｅｌ 测试')).toHaveLength(1);
    expect(selectConversations([conversation], 'model missing')).toHaveLength(0);
  });
});
