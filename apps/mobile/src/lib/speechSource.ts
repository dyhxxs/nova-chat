import { accountScope } from './accountScope';
import type { AppMessage } from '../types';

/** Ephemeral only: scope contains a credential. Never persist or log this object. */
export type SpeechSource = { scope: string; conversationId: string; messageId: string; content: string };
export type SpeechContext = {
  dataOwnerId?: string; dataOwnerServerUrl?: string; accessToken: string;
  activeConversationId: string;
  conversations: { id: string; messages: AppMessage[] }[];
};
export function isSpeechSourceCurrent(source: SpeechSource, context: SpeechContext): boolean {
  if (!context.accessToken || source.scope !== accountScope(context) || source.conversationId !== context.activeConversationId) return false;
  const message = context.conversations.find(item => item.id === source.conversationId)?.messages.find(item => item.id === source.messageId);
  return message?.role === 'assistant' && message.status === 'complete' && message.content === source.content;
}
