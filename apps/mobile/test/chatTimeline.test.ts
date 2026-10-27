import { describe, expect, it } from 'vitest';
import {
  buildChatTimeline,
  chatClock,
  chatDayLabel,
  searchChatMessages,
  timelineDividerIndex,
  timelineMessageIndex,
} from '../src/lib/chatTimeline';
import type { AppMessage } from '../src/types';

function message(id: string, createdAt: number, content = '你好'): AppMessage {
  return { id, role: 'user', content, attachments: [], createdAt, status: 'complete' };
}

// 2025-12-03, a Wednesday.
const now = new Date(2025, 11, 3, 15, 0).getTime();

describe('chatDayLabel', () => {
  it('labels recent days like WeChat', () => {
    expect(chatDayLabel(new Date(2025, 11, 3, 9, 0).getTime(), now)).toBe('今天');
    expect(chatDayLabel(new Date(2025, 11, 2, 9, 0).getTime(), now)).toBe('昨天');
    expect(chatDayLabel(new Date(2025, 11, 1, 9, 0).getTime(), now)).toBe('前天');
    expect(chatDayLabel(new Date(2025, 10, 30, 9, 0).getTime(), now)).toMatch(/^星期[一二三四五六日]$/);
    expect(chatDayLabel(new Date(2025, 10, 20, 9, 0).getTime(), now)).toBe('11月20日');
    expect(chatDayLabel(new Date(2024, 11, 31, 9, 0).getTime(), now)).toBe('2024年12月31日');
  });
});

describe('chatClock', () => {
  it('renders 24-hour HH:mm', () => {
    expect(chatClock(new Date(2025, 11, 3, 9, 5).getTime())).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe('buildChatTimeline', () => {
  it('groups same-day messages under one divider with the correct count', () => {
    const items = buildChatTimeline([
      message('m1', new Date(2025, 11, 1, 9, 0).getTime()),
      message('m2', new Date(2025, 11, 1, 10, 0).getTime()),
      message('m3', new Date(2025, 11, 3, 14, 0).getTime()),
    ], now);

    expect(items.map((item) => item.type)).toEqual(['date', 'message', 'message', 'date', 'message']);

    const firstDay = items[0]!;
    const secondDay = items[3]!;
    if (firstDay.type !== 'date' || secondDay.type !== 'date') throw new Error('expected dividers');
    expect(firstDay.label).toBe('前天');
    expect(firstDay.messageCount).toBe(2);
    expect(secondDay.label).toBe('今天');
    expect(secondDay.messageCount).toBe(1);
  });

  it('returns an empty timeline for no messages', () => {
    expect(buildChatTimeline([], now)).toEqual([]);
  });
});

describe('timeline index helpers', () => {
  it('locates message and divider rows', () => {
    const items = buildChatTimeline([
      message('m1', new Date(2025, 11, 1, 9, 0).getTime()),
      message('m2', new Date(2025, 11, 3, 14, 0).getTime()),
    ], now);

    expect(timelineMessageIndex(items, 'm2')).toBe(3);
    expect(timelineMessageIndex(items, 'missing')).toBe(-1);

    const divider = items.find((item) => item.type === 'date')!;
    if (divider.type !== 'date') throw new Error('expected divider');
    expect(timelineDividerIndex(items, divider.key)).toBe(0);
    expect(timelineDividerIndex(items, 'missing')).toBe(-1);
  });
});

describe('searchChatMessages', () => {
  it('matches content and attachment names, newest first, all words required', () => {
    const messages: AppMessage[] = [
      message('a', now - 3000, '帮我写一封邮件给客户'),
      {
        id: 'b',
        role: 'assistant',
        content: '',
        createdAt: now - 2000,
        status: 'complete',
        attachments: [{ id: 'att-b', name: '季度报告.pdf', mimeType: 'application/pdf', size: 10, kind: 'document' }],
      },
      message('c', now - 1000, '邮件附件在这里'),
    ];

    expect(searchChatMessages(messages, '邮件').map((hit) => hit.message.id)).toEqual(['c', 'a']);
    expect(searchChatMessages(messages, '报告').map((hit) => hit.message.id)).toEqual(['b']);
    expect(searchChatMessages(messages, '邮件 客户').map((hit) => hit.message.id)).toEqual(['a']);
    expect(searchChatMessages(messages, '')).toEqual([]);
    expect(searchChatMessages(messages, '不存在')).toEqual([]);
  });
});
