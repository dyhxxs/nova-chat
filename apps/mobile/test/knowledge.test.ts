import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-file-system', () => ({ File: class {}, UploadType: { MULTIPART: 0 } }));
import { listKnowledge, getKnowledge, saveKnowledge, searchKnowledge, importKnowledge, deleteKnowledge } from '../src/services/gatewayApiClient';
import { restoreLocalRecords } from '../src/lib/localSnapshot';
import { createConversationBackup } from '../src/lib/conversationBackup';
import type { Conversation } from '../src/types';
const id = '11111111-1111-4111-8111-111111111111';
const doc = { id, title: '报销', chars: 10, chunks: 1, createdAt: 1, updatedAt: 2 };
const knowledge = { query: '报销日期', sources: [{ label: '资料1', documentId: id, title: '报销', chunk: 1, excerpt: '25日报销截止。', updatedAt: 2 }] };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());
describe('library API and durable source snapshots', () => {
  it('encodes queries and sends only current auth over the selected gateway', async () => {
    const fetch = vi.fn().mockResolvedValue(json(knowledge)); vi.stubGlobal('fetch', fetch);
    expect(await searchKnowledge('https://gateway.example', 'current-token', '报销 & 日期')).toEqual(knowledge);
    expect(fetch.mock.calls[0]![0]).toContain('q=' + encodeURIComponent('报销 & 日期'));
    expect(fetch.mock.calls[0]![1].headers.authorization).toBe('Bearer current-token');
  });
  it('uses bounded validated list and document responses', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ documents: [doc], usage: { documents: 1, chars: 10 }, limits: { documents: 100, totalChars: 2000000, documentChars: 120000 } })).mockResolvedValueOnce(json({ document: { ...doc, text: '正文' } })); vi.stubGlobal('fetch', fetch);
    expect((await listKnowledge('https://gateway.example', 'token')).documents).toHaveLength(1);
    expect((await getKnowledge('https://gateway.example', 'token', id)).text).toBe('正文');
  });
  it('sends editing revision and supports import/delete without leaking local URI or credentials in body', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(json({ document: doc, duplicate: false, ok: true }))); vi.stubGlobal('fetch', fetch);
    await saveKnowledge('https://gateway.example', 'token', { title: '报销', text: '内容', expectedUpdatedAt: 2 }, id);
    await importKnowledge('https://gateway.example', 'token', id);
    await deleteKnowledge('https://gateway.example', 'token', id);
    expect(fetch.mock.calls[0]![1].method).toBe('PUT');
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ title: '报销', text: '内容', expectedUpdatedAt: 2 });
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({ fileId: id });
    expect(fetch.mock.calls[2]![1].method).toBe('DELETE');
  });
  it('validates PDF import diagnostics, including page bounds and duplicate pages', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ document: doc, duplicate: false, importInfo: { format: 'pdf', pages: 3, pagesWithoutText: [2] } }))
      .mockResolvedValueOnce(json({ document: doc, duplicate: false, importInfo: { format: 'pdf', pages: 1, pagesWithoutText: [2] } }))
      .mockResolvedValueOnce(json({ document: doc, duplicate: false, importInfo: { format: 'pdf', pages: 2, pagesWithoutText: [2, 2] } }));
    vi.stubGlobal('fetch', fetch);
    expect((await importKnowledge('https://gateway.example', 'token', id)).importInfo?.pagesWithoutText).toEqual([2]);
    await expect(importKnowledge('https://gateway.example', 'token', id)).rejects.toThrow();
    await expect(importKnowledge('https://gateway.example', 'token', id)).rejects.toThrow();
  });
  it('keeps valid local drafts outside standard chat backups and flags malformed drafts for raw recovery', () => {
    const draft = { title: '私人资料草稿', text: '不要进入聊天备份', editId: id, revision: id, editedAt: 1 };
    const restored = restoreLocalRecords([], [], draft);
    expect(restored.knowledgeDraft).toEqual(draft); expect(restored.repaired).toBe(false);
    expect(JSON.stringify(createConversationBackup(restored.conversations))).not.toContain(draft.text);
    expect(restoreLocalRecords([], [], { ...draft, text: 'x'.repeat(120001) }).repaired).toBe(true);
    expect(restoreLocalRecords([], []).repaired).toBe(false);
  });
  it('rejects malformed/unbounded sources instead of treating them as trustworthy metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...knowledge, sources: [{ ...knowledge.sources[0], excerpt: 'x'.repeat(1401) }] })));
    await expect(searchKnowledge('https://gateway.example', 'token', '日期')).rejects.toThrow();
  });
  it('surfaces authentication/conflict errors without erasing the input document', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { code: 'knowledge_conflict', message: '资料已更新，请重试。', retryable: false } }, 409)));
    const input = { title: '资料', text: '尚未保存的新正文', expectedUpdatedAt: 1 };
    await expect(saveKnowledge('https://gateway.example', 'token', input, id)).rejects.toMatchObject({ code: 'knowledge_conflict', status: 409 });
    expect(input.text).toBe('尚未保存的新正文');
  });
  it('preserves server sources in local snapshots but excludes them from standard backups', () => {
    const conversations: Conversation[] = [{ id: 'chat', title: '资料对话', createdAt: 1, updatedAt: 1, messages: [{ id: 'answer', role: 'assistant', content: '25日。[资料1]', attachments: [], createdAt: 1, status: 'complete', knowledge, generationOptions: { reasoningEffort: 'low', verbosity: 'low', maxOutputTokens: 256, knowledgeBase: true, webSearch: false, codeInterpreter: false } }] }];
    const restored = restoreLocalRecords(conversations, []);
    expect(restored.conversations[0]?.messages[0]?.knowledge).toEqual(knowledge);
    expect(restored.conversations[0]?.messages[0]?.generationOptions?.knowledgeBase).toBe(true);
    const backup = JSON.stringify(createConversationBackup(conversations));
    expect(backup).toContain('25日。[资料1]');
    expect(backup).not.toContain('excerpt'); expect(backup).not.toContain('documentId'); expect(backup).not.toContain('generationOptions');
  });
});
