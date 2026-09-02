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
});
