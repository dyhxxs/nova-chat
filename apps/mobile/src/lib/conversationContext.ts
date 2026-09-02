import { DEFAULT_CONTEXT_CHARS, DEFAULT_CONTEXT_MESSAGES, chatMessageCost } from '@nova-chat/protocol';
import type { ChatMessage } from '@nova-chat/protocol';
import type { AppMessage } from '../types';

function messageCost(message: AppMessage): number {
  return chatMessageCost({ content: message.content, attachments: message.attachments });
}

export function buildConversationContext(
  messages: AppMessage[],
  pendingAssistantId: string,
  maxChars = DEFAULT_CONTEXT_CHARS,
  maxMessages = DEFAULT_CONTEXT_MESSAGES,
): ChatMessage[] {
  const eligible = messages.filter((message) => {
    if (message.id === pendingAssistantId) return false;
    if (message.role === 'user') return message.status === 'complete' && (message.content.trim().length > 0 || message.attachments.length > 0);
    // Keep completed assistant attachments (especially generated images) as
    // conversation metadata even when the assistant did not emit text. A
    // follow-up such as “我要全身的” relies on that prior image to be
    // recognized as an image continuation instead of a normal text turn.
    return message.status === 'complete' && (message.content.trim().length > 0 || message.attachments.length > 0);
  });

  const selected: AppMessage[] = [];
  let cost = 0;
  for (let index = eligible.length - 1; index >= 0 && selected.length < maxMessages; index -= 1) {
    const message = eligible[index]!;
    const nextCost = messageCost(message);
    if (selected.length > 0 && cost + nextCost > maxChars) break;
    selected.push(message);
    cost += nextCost;
  }
  selected.reverse();
  while (selected[0]?.role === 'assistant') selected.shift();
  return selected.map((message) => ({
    role: message.role,
    content: message.content,
    attachments: message.attachments,
  }));
}

export function modelIdentityInstruction(model: string): string {
  return `身份规则：你是 Nova 中的独立 AI 助手。本次实际配置模型 ID 为“${model}”。不要把自己误称为 DeepSeek、ChatGPT 或官方 Codex；被问身份时应如实说明模型 ID 和第三方兼容接口来源。`;
}
