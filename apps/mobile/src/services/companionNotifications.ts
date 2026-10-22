import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import type { CompanionEvent } from '@nova-chat/protocol';
import type { CompanionNotificationData } from '../lib/companionNotification';

export type NotificationSetup = { granted: boolean; token?: string };
export const COMPANION_NOTIFICATION_CHANNEL = 'companion-messages';
let pushRegistered = false;
let seen = new Set<string>();

export function setCompanionPushRegistered(value: boolean) { pushRegistered = value; }
export function updateCompanionNotificationBadge(count: number) {
  void Notifications.setBadgeCountAsync(Math.max(0, Math.min(999, Math.floor(count)))).catch(() => undefined);
}
export function resetCompanionNotificationScope() {
  pushRegistered = false; seen = new Set();
  void Notifications.dismissAllNotificationsAsync().catch(() => undefined);
  updateCompanionNotificationBadge(0);
}

export async function prepareCompanionNotifications(requestPermission = false): Promise<NotificationSetup> {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(COMPANION_NOTIFICATION_CHANNEL, {
    name: '陪伴消息', importance: Notifications.AndroidImportance.HIGH, sound: 'default', vibrationPattern: [0, 200, 150, 200],
  });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain && (requestPermission || permission.status === 'undetermined')) permission = await Notifications.requestPermissionsAsync();
  const granted = permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (!granted) return { granted: false };
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  if (!projectId) return { granted: true };
  try { return { granted: true, token: (await Notifications.getExpoPushTokenAsync({ projectId })).data }; }
  catch { return { granted: true }; }
}

export function listenForCompanionNotifications(onOpen: (data: unknown) => void, isVisible: (data: unknown) => boolean, isCurrentScope: (data: unknown) => boolean) {
  Notifications.setNotificationHandler({ handleNotification: async notification => {
    const data = notification.request.content.data;
    const show = isCurrentScope(data) && !(AppState.currentState === 'active' && isVisible(data));
    if (typeof data?.eventId === 'string') {
      seen.add(data.eventId);
      if (seen.size > 512) seen.delete(seen.values().next().value!);
    }
    return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: show };
  } });
  const subscription = Notifications.addNotificationResponseReceivedListener(response => {
    onOpen(response.notification.request.content.data);
    void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  });
  void Notifications.getLastNotificationResponseAsync().then(response => {
    if (!response) return;
    onOpen(response.notification.request.content.data);
    void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  }).catch(() => undefined);
  return () => { subscription.remove(); Notifications.setNotificationHandler(null); };
}

export async function presentCompanionNotification(event: CompanionEvent, name: string, scope: { userId: string; serverUrl: string }) {
  if (pushRegistered || seen.has(event.eventId)) return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) return;
  seen.add(event.eventId);
  if (seen.size > 512) seen.delete(seen.values().next().value!);
  const data: CompanionNotificationData = { type: 'companion-message', ...scope, eventId: event.eventId,
    companionId: event.companionId, conversationId: event.conversationId };
  try { await Notifications.scheduleNotificationAsync({ identifier: `companion-${event.eventId}`, content: {
    title: name, body: event.kind === 'photo' ? '[图片]' : event.content.slice(0, 160), sound: 'default', data,
  }, trigger: Platform.OS === 'android' ? { channelId: COMPANION_NOTIFICATION_CHANNEL } : null }); }
  catch (error) { seen.delete(event.eventId); throw error; }
}
