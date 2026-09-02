import { describe, expect, it } from 'vitest';
import { buildConversationContext } from '../src/lib/conversationContext';
import type { AppMessage } from '../src/types';

const message = (patch: Partial<AppMessage> & Pick<AppMessage, 'id' | 'role' | 'content' | 'status'>): AppMessage => ({
  createdAt: 1,
  attachments: [],
  ...patch,
});

describe('buildConversationContext', () => {
  it('excludes partial failed, cancelled and pending assistant messages', () => {
    const result = buildConversationContext([
      message({ id: 'u1', role: 'user', content: '第一问', status: 'complete' }),
      message({ id: 'a1', role: 'assistant', content: '完整回答', status: 'complete' }),
      message({ id: 'u2', role: 'user', content: '第二问', status: 'complete' }),
      message({ id: 'a2', role: 'assistant', content: '半截', status: 'error' }),
      message({ id: 'a3', role: 'assistant', content: '', status: 'streaming' }),
    ], 'a3');
    expect(result.map((item) => item.content)).toEqual(['第一问', '完整回答', '第二问']);
  });

  it('preserves attachments and respects the recent-history budget', () => {
    const attachment = { id: '00000000-0000-4000-8000-000000000001', name: 'a.pdf', mimeType: 'application/pdf', size: 100, kind: 'document' as const };
    const result = buildConversationContext([
      message({ id: 'u1', role: 'user', content: '很早'.repeat(100), status: 'complete' }),
      message({ id: 'a1', role: 'assistant', content: '旧回答'.repeat(100), status: 'complete' }),
      message({ id: 'u2', role: 'user', content: '看附件', status: 'complete', attachments: [attachment] }),
      message({ id: 'a2', role: 'assistant', content: '', status: 'streaming' }),
    ], 'a2', 2500);
    expect(result).toHaveLength(1);
    expect(result[0]?.attachments).toEqual([attachment]);
  });


  it('keeps a completed image-only assistant message when the older prompt is trimmed', () => {
    const image = { id: '00000000-0000-4000-8000-000000000002', name: 'generated.png', mimeType: 'image/png', size: 100, kind: 'image' as const };
    const result = buildConversationContext([
      message({ id: 'u1', role: 'user', content: '生成一个很长的初始创作描述'.repeat(30), status: 'complete' }),
      message({ id: 'a1', role: 'assistant', content: '', status: 'complete', attachments: [image] }),
      message({ id: 'u2', role: 'user', content: '我不满意，改成全身的 [Image #1]', status: 'complete' }),
    ], 'pending', 2_200);

    expect(result.map((item) => item.role)).toEqual(['assistant', 'user']);
    expect(result[0]?.attachments).toEqual([image]);
    expect(result[1]?.content).toContain('全身');
  });

  it('does not retain unfinished image assistant messages', () => {
    const image = { id: '00000000-0000-4000-8000-000000000003', name: 'partial.png', mimeType: 'image/png', size: 100, kind: 'image' as const };
    const result = buildConversationContext([
      message({ id: 'u1', role: 'user', content: '生成图片', status: 'complete' }),
      message({ id: 'a1', role: 'assistant', content: '', status: 'streaming', attachments: [image] }),
      message({ id: 'u2', role: 'user', content: '换个背景', status: 'complete' }),
    ], 'pending');

    expect(result).toEqual([
      { role: 'user', content: '生成图片', attachments: [] },
      { role: 'user', content: '换个背景', attachments: [] },
    ]);
  });
});
