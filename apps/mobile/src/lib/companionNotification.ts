import { normalizeServerUrl } from './connection';

export type CompanionNotificationData = {
  type: 'companion-message'; userId: string; serverUrl: string; companionId: string; conversationId: string; eventId: string;
};
type Scope = { authStatus: string; user?: { id: string }; settings: { serverUrl: string };
  conversations: Array<{ id: string; companionId?: string }> };

/** Deep links can only select a companion topic belonging to the signed-in account and gateway. */
export function companionNotificationTarget(data: unknown, scope: Scope): string | undefined {
  if (!data || typeof data !== 'object' || scope.authStatus !== 'authenticated') return;
  const payload = data as Partial<CompanionNotificationData>;
  if (payload.type !== 'companion-message' || payload.userId !== scope.user?.id || typeof payload.serverUrl !== 'string'
    || normalizeServerUrl(payload.serverUrl) !== normalizeServerUrl(scope.settings.serverUrl)
    || typeof payload.companionId !== 'string' || typeof payload.conversationId !== 'string') return;
  return scope.conversations.find(topic => topic.id === payload.conversationId && topic.companionId === payload.companionId)?.id;
}
