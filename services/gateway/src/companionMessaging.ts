import type { ChatMessage } from '@nova-chat/protocol';

/**
 * Models occasionally continue a companion answer as a fabricated transcript.
 * Drop that continuation at the gateway boundary before formatting or emitting.
 */
function stopAtGeneratedTranscript(text: string): string {
  const boundary = text.search(/\n\s*(?:user|assistant|system|用户|角色)\s*[:：]?/iu);
  const withoutContinuation = boundary >= 0 ? text.slice(0, boundary) : text;
  return withoutContinuation.replace(/^\s*(?:assistant|角色)\s*[:：]\s*/iu, '').trim();
}

/** Keep everyday companion messages in phone rhythm without rewriting their meaning. */
export function formatCompanionMessage(text: string, messages: readonly Pick<ChatMessage, 'role' | 'content'>[]): string {
  text = stopAtGeneratedTranscript(text);
  const latest = messages.filter(message => message.role === 'user').at(-1)?.content ?? '';
  const requestedFormat = /代码|编程|脚本|链接|网址|markdown|json|表格|列表|清单|详细|细说|解释|分析|步骤|教程|逐步|引用|原文|保持格式|保留标点|code|explain|verbatim/i.test(latest);
  const structured = /https?:\/\/|www\.|[`|]|^[ \t]*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s)|\d[.,]\d|\b(?:[A-Za-z]\.){2,}/m.test(text);
  // Longer explanations and structured content retain useful punctuation and spacing.
  if (requestedFormat || structured || text.length > 240) return text;
  return text.replace(/\r\n?/g, '\n')
    .replace(/[，,]/g, ' ')
    .replace(/[。．]/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[\s\n]*/g, '\n')
    .trim()
    .replace(/\.$/, '');
}

/** Preserve structured answers and every sentence when creating separate bubbles. */
export function companionMessageSegments(text: string, messages: readonly Pick<ChatMessage, 'role' | 'content'>[]): string[] {
  if (!text.trim()) return [];
  const latest = messages.filter(message => message.role === 'user').at(-1)?.content ?? '';
  if (text.length > 240 || /详细|细说|解释|分析|步骤|代码|原文|保持格式|表格|清单|列表|markdown|json/iu.test(latest)
    || /https?:\/\/|[\x60|]|^[ \t]*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s)/mu.test(text)) return [text];
  const parts = text.split(/\n+/u).map(part => part.trim()).filter(Boolean);
  return parts.length <= 4 ? parts : [...parts.slice(0, 3), parts.slice(3).join('\n')];
}
