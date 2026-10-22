import type { CompanionEvent } from '@nova-chat/protocol';
export type NotificationSetup = { granted: boolean; token?: string };
export function setCompanionPushRegistered(_value: boolean) { void _value; /* Native push registration only. */ }
export function updateCompanionNotificationBadge(_count: number) { void _count; /* Web has no app icon badge in this notification path. */ }
export function resetCompanionNotificationScope() { /* Native push registration only. */ }
export async function prepareCompanionNotifications(_requestPermission = false): Promise<NotificationSetup> { void _requestPermission; return { granted: false }; }
export function listenForCompanionNotifications(_onOpen: (data: unknown) => void, _isVisible: (data: unknown) => boolean, _isCurrentScope: (data: unknown) => boolean) { void _onOpen; void _isVisible; void _isCurrentScope; return () => undefined; }
export async function presentCompanionNotification(_event: CompanionEvent, _name: string, _scope: { userId: string; serverUrl: string }) { void _event; void _name; void _scope; /* Web keeps the conversation preview. */ }
