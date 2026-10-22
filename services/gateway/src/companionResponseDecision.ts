import type { GenerateRequest } from '@nova-chat/protocol';
import { analyzeCompanionTurn } from './companionState.js';
import type { CompanionRelationship } from './companionRelationship.js';

export type CompanionResponseDecision = { mode: 'reply' | 'silent' } | { mode: 'defer'; delayMs: number };

/** Explicit help and truthful identity questions always need a real answer. */
export function companionReplyRequired(request: GenerateRequest): boolean {
  const latest = request.messages.filter(message => message.role === 'user').at(-1);
  const analysis = analyzeCompanionTurn(request.messages);
  return analysis.scene === 'safety' || analysis.userIntent === 'advice' || Boolean(latest?.attachments.length)
    || /真人|人工智能|你是AI|你是ai|是不是机器人|照片.{0,10}(?:生成|拍的|来源)|are you (?:real|human|an? ai)/iu.test(latest?.content ?? '');
}

export function companionResponseDecision(request: GenerateRequest, relationship?: CompanionRelationship): CompanionResponseDecision {
  const latest = [...request.messages].reverse().find((message) => message.role === 'user');
  if (!latest) return { mode: 'silent' };
  const text = latest.content.trim();
  const analysis = analyzeCompanionTurn(request.messages);
  // Safety includes ongoing danger from earlier turns, and precedes requests for silence.
  if (companionReplyRequired(request)) return { mode: 'reply' };
  if (!text || /别回|不用回|不用理|别理我|先别说|不想说话|do(?:n't| not) reply/iu.test(text)) return { mode: 'silent' };
  if (analysis.scene === 'serious' || analysis.scene === 'venting' || analysis.scene === 'repair' || text.length > 24) return { mode: 'reply' };
  let hash = 0;
  for (const character of request.conversationId + ':' + text + ':' + request.messages.length) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  const acknowledgement = /^(?:嗯+|哦+|噢+|好+|行+|收到|知道了|哈哈+|笑死|没事|晚安|先这样|我去睡了|我先忙了)[。！!～~\s]*$/u.test(text);
  if (acknowledgement && hash % 4 === 0) return { mode: 'silent' };
  // A small delay is grounded in the character's existing mood, never a reward/punishment loop.
  if ((relationship?.tension ?? 0) >= 2 || request.companion?.mood === 'tired'
    || (acknowledgement && hash % 4 === 1)) return { mode: 'defer', delayMs: 30_000 + hash % 60_000 };
  return { mode: 'reply' };
}
