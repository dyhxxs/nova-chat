import type { AppMessage } from '../types';

/** One renderable row of the chat list: a WeChat-style date divider or a message bubble. */
export type ChatTimelineItem =
  | { type: 'date'; key: string; timestamp: number; label: string; messageCount: number }
  | { type: 'message'; key: string; message: AppMessage };

const dateKeyOf = (date: Date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

/** Local calendar day key; messages around midnight stay grouped by wall clock. */
export function chatDayKey(timestamp: number): string {
  return dateKeyOf(new Date(timestamp));
}

function shiftedDayKey(now: number, deltaDays: number): string {
  const base = new Date(now);
  return dateKeyOf(new Date(base.getFullYear(), base.getMonth(), base.getDate() + deltaDays));
}

export function chatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** WeChat-style day label without a clock: 今天 / 昨天 / 前天 / 星期二 / 10月24日 / 2025年12月3日. */
export function chatDayLabel(timestamp: number, now = Date.now()): string {
  const key = chatDayKey(timestamp);
  if (key === chatDayKey(now)) return '今天';
  if (key === shiftedDayKey(now, -1)) return '昨天';
  if (key === shiftedDayKey(now, -2)) return '前天';
  const date = new Date(timestamp);
  if (now > timestamp && now - timestamp < 7 * 86_400_000) {
    return date.toLocaleDateString('zh-CN', { weekday: 'long' });
  }
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === new Date(now).getFullYear() ? monthDay : `${date.getFullYear()}年${monthDay}`;
}

/** Interleave date dividers between messages so older chats show their dates, like WeChat. */
export function buildChatTimeline(messages: readonly AppMessage[], now = Date.now()): ChatTimelineItem[] {
  const items: ChatTimelineItem[] = [];
  let previousDayKey = '';
  let activeDivider: Extract<ChatTimelineItem, { type: 'date' }> | null = null;
  for (const message of messages) {
    const dayKey = chatDayKey(message.createdAt);
    if (dayKey !== previousDayKey) {
      previousDayKey = dayKey;
      activeDivider = {
        type: 'date',
        key: `date-${dayKey}-${message.id}`,
        timestamp: message.createdAt,
        label: chatDayLabel(message.createdAt, now),
        messageCount: 0,
      };
      items.push(activeDivider);
    }
    activeDivider!.messageCount += 1;
    items.push({ type: 'message', key: message.id, message });
  }
  return items;
}

/** Timeline index of a message row, for jumping to a search hit. */
export function timelineMessageIndex(items: readonly ChatTimelineItem[], messageId: string): number {
  return items.findIndex((item) => item.type === 'message' && item.key === messageId);
}

/** Timeline index of the day divider with the given key, for jumping to a day. */
export function timelineDividerIndex(items: readonly ChatTimelineItem[], dividerKey: string): number {
  return items.findIndex((item) => item.type === 'date' && item.key === dividerKey);
}

const normalized = (text: string) => text.normalize('NFKC').toLocaleLowerCase();

export type ChatSearchHit = { message: AppMessage; snippet: string; match: string };

function messageSearchText(message: AppMessage): string {
  return [message.content, ...message.attachments.map((attachment) => attachment.name)].join('\n');
}

/** Search one conversation like the history list: every word must appear, order-free. */
export function searchChatMessages(messages: readonly AppMessage[], query: string, limit = 100): ChatSearchHit[] {
  const rawWords = query.trim().split(/\s+/).filter(Boolean);
  const words = rawWords.map(normalized);
  if (!words.length) return [];
  const hits: ChatSearchHit[] = [];
  for (let index = messages.length - 1; index >= 0 && hits.length < limit; index--) {
    const message = messages[index]!;
    const text = normalized(messageSearchText(message));
    if (!words.every((word) => text.includes(word))) continue;
    const match = rawWords.find((raw) => message.content.toLocaleLowerCase().includes(raw.toLocaleLowerCase())) ?? rawWords[0]!;
    hits.push({ message, snippet: snippetAround(message.content, match), match });
  }
  return hits;
}

function snippetAround(content: string, match: string, radius = 28): string {
  const clean = content.replace(/\s+/g, ' ').trim();
  if (clean.length <= radius * 2 + match.length) return clean;
  const at = clean.toLocaleLowerCase().indexOf(match.toLocaleLowerCase());
  if (at <= radius) return `${clean.slice(0, radius * 2)}…`;
  if (at + match.length + radius >= clean.length) return `…${clean.slice(-(radius * 2))}`;
  return `…${clean.slice(at - radius, at + match.length + radius)}…`;
}
