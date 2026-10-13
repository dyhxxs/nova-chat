import { describe, expect, it, vi } from 'vitest';
import { conversationPreview, createConversationSelector } from '../src/lib/conversationHistory';
import type { Conversation } from '../src/types';
function chat(id: string, content = ''): Conversation {
  return { id, title: id, createdAt: 1, updatedAt: 1, messages: [{ id: 'm-' + id, role: 'user', content, attachments: [], createdAt: 1, status: 'complete' }] };
}
describe('bounded history selector', () => {
  it('normalizes width/case and matches multiple words across message and title', () => {
    const item = chat('ＡＢＣ', '你好世界');
    expect(createConversationSelector()([item], 'abc 世界')).toEqual([item]);
  });
  it('reuses unchanged indexes but invalidates immutable edits', () => {
    const item = chat('one', 'original'); const getter = vi.fn(() => 'original');
    Object.defineProperty(item.messages[0]!, 'content', { get: getter });
    const select = createConversationSelector(); select([item], 'original'); select([item], 'missing');
    expect(getter).toHaveBeenCalledTimes(1);
    const edited = chat('one', 'edited'); expect(select([edited], 'original')).toEqual([]); expect(select([edited], 'edited')).toEqual([edited]);
  });
  it('drops old-account indexes and does not confuse reused IDs', () => {
    const select = createConversationSelector(); const first = chat('same-id', 'alphanonce'); const second = chat('same-id', 'betanonce');
    expect(select([first], 'alphanonce')).toEqual([first]); expect(select([second], 'alphanonce')).toEqual([]);
    expect(select([second], 'betanonce')).toEqual([second]);
  });
  it('skips indexing with an empty query and respects the cache budget', () => {
    const item = chat('large'); const getter = vi.fn(() => 'large content'); Object.defineProperty(item.messages[0]!, 'content', { get: getter });
    const select = createConversationSelector(2); select([item], ''); expect(getter).not.toHaveBeenCalled();
    select([item], 'large'); select([item], 'large'); expect(getter).toHaveBeenCalledTimes(2);
  });
  it('never includes drafts or private assistant instructions in the search index', () => {
    const item = { ...chat('safe'), draft: 'private-draft', assistant: { name: 'private assistant', instructions: 'secret-instructions' } };
    const select = createConversationSelector(); expect(select([item], 'private-draft', 'all')).toEqual([]); expect(select([item], 'secret-instructions', 'all')).toEqual([]);
  });
  it('keeps pin/archive filters and deterministic ordering without mutating input', () => {
    const input = [chat('z'), { ...chat('p'), pinned: true }, { ...chat('a'), archived: true }]; const select = createConversationSelector();
    expect(select(input).map(c => c.id)).toEqual(['p', 'z']); expect(select(input, '', 'pinned').map(c => c.id)).toEqual(['p']);
    expect(select(input, '', 'archived').map(c => c.id)).toEqual(['a']); expect(input.map(c => c.id)).toEqual(['z', 'p', 'a']);
  });
  it('searches model IDs and attachment names and handles uncached huge documents', () => {
    const item = chat('file', 'a'.repeat(50_000)); item.messages[0]!.model = 'special-model';
    item.messages[0]!.attachments = [{ id: 'f', kind: 'document', name: '重要文档.pdf', mimeType: 'application/pdf', size: 1, uri: 'https://unused.example/file' }];
    expect(createConversationSelector(10)([item], 'special-model 重要文档')).toEqual([item]);
  });
});
describe('bounded conversation previews', () => {
  it('limits very large message previews without modifying the conversation', () => {
    const item = chat('large', 'a'.repeat(2_000_000)); expect(conversationPreview(item)).toHaveLength(280); expect(item.messages[0]!.content).toHaveLength(2_000_000);
  });
  it('skips empty trailing messages and summarizes attachment-only turns', () => {
    const item = chat('x', ' earlier\n text '); item.messages.push({ ...item.messages[0]!, id: 'empty', content: '' });
    expect(conversationPreview(item)).toBe('earlier text'); expect(conversationPreview(chat('empty'))).toBe('还没有消息');
  });
});
