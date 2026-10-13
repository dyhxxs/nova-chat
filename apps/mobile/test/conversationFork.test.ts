import { describe, expect, it } from 'vitest';
import { createConversationFork, previewConversationFork, MAX_FORK_CHARACTERS } from '../src/lib/conversationFork';
import { createConversationBackup, mergeConversationBackup } from '../src/lib/conversationBackup';
import { restoreLocalRecords } from '../src/lib/localSnapshot';
import { buildConversationContext } from '../src/lib/conversationContext';
import { forkFixture, message } from './helpers/conversationForkFixture';

let serial = 0;
const id = () => `branch-${++serial}`;
describe('non-destructive conversation forks', () => {
  it('copies only through the selected answer with new identities and a fresh title', () => {
    const source = forkFixture(); const before = JSON.stringify(source);
    const fork = createConversationFork(source, 'a1', 'continue', id, 999);
    expect(fork.messages.map(item => item.content)).toEqual(['问题一', '回答一']);
    expect(fork.title).toBe('原对话 · 分支'); expect(fork.createdAt).toBe(999); expect(fork.updatedAt).toBe(999);
    expect(fork.id).not.toBe(source.id); expect(new Set([fork.id, ...fork.messages.map(item => item.id)]).size).toBe(3);
    expect(fork.messages.every(item => !source.messages.some(original => original.id === item.id))).toBe(true);
    expect(JSON.stringify(source)).toBe(before); expect(fork.draft).toBeUndefined();
    expect(fork.pinned).toBeUndefined(); expect(fork.archived).toBeUndefined(); expect(fork.importSourceId).toBeUndefined();
  });
  it('rewrites into a draft, not a sent turn, and excludes the old answer and later messages', () => {
    const source = forkFixture(); const fork = createConversationFork(source, 'q2', 'rewrite', id);
    expect(fork.draft).toBe('请换一种解释'); expect(fork.messages).toHaveLength(2);
    expect(fork.title).toBe('原对话 · 改写'); expect(source.draft).toBe('尚未发送的旧草稿');
    expect(fork.messages.some(item => item.status === 'streaming')).toBe(false);
  });
  it('supports rewriting the first question into an empty independent chat', () => {
    const fork = createConversationFork(forkFixture(), 'q1', 'rewrite', id);
    expect(fork.messages).toEqual([]); expect(fork.draft).toBe('问题一');
  });
  it('keeps frozen assistant instructions and original model identity without runtime jobs or accounting', () => {
    const source = forkFixture(); const fork = createConversationFork(source, 'a1', 'continue', id);
    expect(fork.assistant).toEqual(source.assistant); expect(fork.assistant).not.toBe(source.assistant);
    expect(fork.messages[1]).toMatchObject({ model: 'test-model', requestedModel: 'test-requested' });
    for (const key of ['generationRequestId','generationStartedAt','generationOptions','completedAt','usage','retryable','errorMessage']) expect(fork.messages[1]).not.toHaveProperty(key);
  });
  it('deep copies allowed attachments and knowledge but not unknown fields', () => {
    const source = forkFixture();
    source.messages[1]!.attachments = [{ id: '11111111-1111-4111-8111-111111111111', kind: 'image', name: 'image.png', mimeType: 'image/png', size: 10, uri: 'file:///synthetic.png' }];
    source.messages[1]!.knowledge = { query: 'synthetic', sources: [{ label: '资料1', documentId: '22222222-2222-4222-8222-222222222222', title: '笔记', chunk: 1, excerpt: '合成资料', updatedAt: 1 }] };
    Object.assign(source.messages[1]!, { privateUnknown: 'must not copy' });
    Object.assign(source.messages[1]!.attachments[0]!, { privateUnknown: 'must not copy' });
    const fork = createConversationFork(source, 'a1', 'continue', id);
    expect(fork.messages[1]!.attachments).toEqual([{ id: '11111111-1111-4111-8111-111111111111', kind: 'image', name: 'image.png', mimeType: 'image/png', size: 10, uri: 'file:///synthetic.png' }]);
    expect(fork.messages[1]).not.toHaveProperty('privateUnknown');
    fork.messages[1]!.knowledge!.sources[0]!.excerpt = 'changed'; fork.messages[1]!.attachments[0]!.name = 'changed';
    expect(source.messages[1]!.knowledge!.sources[0]!.excerpt).toBe('合成资料'); expect(source.messages[1]!.attachments[0]!.name).toBe('image.png');
  });
  it('allows an image-only completed assistant as the branch point', () => {
    const source = forkFixture(); source.messages[1]!.content = ''; source.messages[1]!.attachments = [{ id: 'image-id', kind: 'image', name: 'image.png', mimeType: 'image/png', size: 1 }];
    expect(previewConversationFork(source,'a1','continue').attachments).toBe(1);
  });
  it.each(['error','cancelled'] as const)('omits %s fragments with an explicit preview count', status => {
    const source = forkFixture(); source.messages.splice(1,0,message('failed','assistant','partial',{status}));
    const preview = previewConversationFork(source,'a1','continue');
    expect(preview.omitted).toBe(1); expect(preview.messages).toBe(2); expect(createConversationFork(source,'a1','continue',id).messages.some(item=>item.content==='partial')).toBe(false);
  });
  it.each(['a1','a2'])('rejects running messages anywhere in the source, including %s', active => {
    const source=forkFixture(); source.messages.find(item=>item.id===active)!.status='streaming';
    expect(()=>createConversationFork(source,'a1','continue',id)).toThrow('仍在生成');
  });
  it.each(['error','cancelled'] as const)('does not use a %s target', status => {
    const source=forkFixture(); source.messages[1]!.status=status;
    expect(()=>createConversationFork(source,'a1','continue',id)).toThrow('已变化');
  });
  it('rejects deleted targets and wrong roles', () => {
    const source=forkFixture(); expect(()=>createConversationFork(source,'missing','continue',id)).toThrow();
    expect(()=>createConversationFork(source,'q1','continue',id)).toThrow(); expect(()=>createConversationFork(source,'a1','rewrite',id)).toThrow();
  });
  it('rejects editing a question with attachments, even if it also contains text', () => {
    const source=forkFixture(); source.messages[0]!.attachments=[{id:'file',kind:'document',name:'test.txt',mimeType:'text/plain',size:1}];
    expect(()=>createConversationFork(source,'q1','rewrite',id)).toThrow('纯文字');
  });
  it('rejects empty text targets without attachments', () => {
    const source=forkFixture(); source.messages[0]!.content='  '; source.messages[1]!.content='';
    expect(()=>createConversationFork(source,'q1','rewrite',id)).toThrow(); expect(()=>createConversationFork(source,'a1','continue',id)).toThrow();
  });
  it('preserves an exact 10000-character rewrite and refuses overflow without truncating', () => {
    const source=forkFixture(); source.messages[0]!.content='字'.repeat(10_000);
    expect(createConversationFork(source,'q1','rewrite',id).draft).toHaveLength(10_000);
    source.messages[0]!.content+='字'; expect(()=>createConversationFork(source,'q1','rewrite',id)).toThrow('1万');
  });
  it('caps prefix records at 500 and does not silently trim old history', () => {
    const source=forkFixture(); source.messages=Array.from({length:501},(_,i)=>message(String(i),'assistant'));
    expect(createConversationFork(source,'499','continue',id).messages).toHaveLength(500);
    expect(()=>createConversationFork(source,'500','continue',id)).toThrow('500');
  });
  it('counts serialized characters including escapes and rejects oversized content', () => {
    const source=forkFixture(); source.messages[0]!.content='x'.repeat(MAX_FORK_CHARACTERS);
    expect(()=>createConversationFork(source,'a1','continue',id)).toThrow('过大');
    source.messages[0]!.content='\n'.repeat(MAX_FORK_CHARACTERS/2); expect(()=>createConversationFork(source,'a1','continue',id)).toThrow('预算');
  });
  it('bounds attachment data URIs before copying', () => {
    const source=forkFixture(); source.messages[1]!.attachments=[{id:'file',kind:'image',name:'test.png',mimeType:'image/png',size:1,uri:'data:image/png;base64,'+'A'.repeat(16_384)}];
    expect(()=>createConversationFork(source,'a1','continue',id)).toThrow('过大');
  });
  it('does not split a surrogate pair when shortening long titles', () => {
    const source=forkFixture(); source.title='x'.repeat(174)+'😀title'; const fork=createConversationFork(source,'a1','continue',id);
    expect(fork.title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
  });
  it('restores through the existing snapshot without repairs or resumable jobs', () => {
    const fork=createConversationFork(forkFixture(),'q2','rewrite',id); const restored=restoreLocalRecords([fork],[]);
    expect(restored.repaired).toBe(false); expect(restored.conversations).toEqual([fork]);
  });
  it('does not collide with the source identity in additive backups', () => {
    const source=forkFixture(); const fork=createConversationFork(source,'a1','continue',id); const backup=createConversationBackup([source,fork]);
    expect(backup.conversations[0]!.sourceId).not.toBe(backup.conversations[1]!.sourceId);
    const json=JSON.stringify(backup); expect(json).not.toContain('old-job'); expect(json).not.toContain('synthetic instructions');
    expect(mergeConversationBackup([],backup).imported).toBe(2);
  });
  it('keeps subsequent model context free of the excluded original answer', () => {
    const fork=createConversationFork(forkFixture(),'q2','rewrite',id);
    fork.messages.push(message('edited','user','我的新问题'),message('pending','assistant','',{status:'streaming'}));
    const context=buildConversationContext(fork.messages,'pending');
    expect(context.map(item=>item.content)).toEqual(['问题一','回答一','我的新问题']);
  });
});
