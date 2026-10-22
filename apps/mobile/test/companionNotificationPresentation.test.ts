import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ state: { currentState: 'active' }, permission: vi.fn(), request: vi.fn(), channel: vi.fn(), schedule: vi.fn(), handler: vi.fn(), response: vi.fn(), clearResponse: vi.fn(), last: vi.fn(), dismiss: vi.fn(), push: vi.fn(), badge: vi.fn(), constants: { expoConfig: { extra: {} as any } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' }, AppState: mocks.state }));
vi.mock('expo-constants', () => ({ default: mocks.constants }));
vi.mock('expo-notifications', () => ({ AndroidImportance: { HIGH: 4 }, IosAuthorizationStatus: { PROVISIONAL: 3 }, setNotificationChannelAsync: mocks.channel, getPermissionsAsync: mocks.permission, requestPermissionsAsync: mocks.request, getExpoPushTokenAsync: mocks.push, scheduleNotificationAsync: mocks.schedule, setNotificationHandler: mocks.handler, addNotificationResponseReceivedListener: mocks.response, clearLastNotificationResponseAsync: mocks.clearResponse, getLastNotificationResponseAsync: mocks.last, dismissAllNotificationsAsync: mocks.dismiss, setBadgeCountAsync: mocks.badge }));
import { listenForCompanionNotifications, prepareCompanionNotifications, presentCompanionNotification, resetCompanionNotificationScope, setCompanionPushRegistered } from '../src/services/companionNotifications';
const event = { eventId: 'event-1', companionId: 'person-1', conversationId: 'topic-1', kind: 'message' as const, content: '想起上次说的书了', attachments: [], createdAt: 30 };
const scope = { userId: 'account-1', serverUrl: 'https://gateway.test' };
beforeEach(() => {
  vi.clearAllMocks(); mocks.constants.expoConfig.extra = {}; mocks.state.currentState = 'active';
  mocks.dismiss.mockResolvedValue(undefined); mocks.badge.mockResolvedValue(true); mocks.channel.mockResolvedValue(undefined); mocks.permission.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
  mocks.schedule.mockResolvedValue('notification-1'); mocks.response.mockReturnValue({ remove: vi.fn() }); mocks.last.mockResolvedValue(null); mocks.clearResponse.mockResolvedValue(undefined);
  resetCompanionNotificationScope();
});
describe('companion notification presentation', () => {
  it('shows a name and preview once when native local notifications are available without cloud push credentials', async () => {
    expect(await prepareCompanionNotifications()).toEqual({ granted: true }); expect(mocks.push).not.toHaveBeenCalled();
    await presentCompanionNotification(event, 'Lumi', scope); await presentCompanionNotification(event, 'Lumi', scope);
    expect(mocks.schedule).toHaveBeenCalledTimes(1);
    expect(mocks.schedule.mock.calls[0]![0]).toMatchObject({ content: { title: 'Lumi', body: event.content, data: { ...scope, conversationId: 'topic-1', companionId: 'person-1' } }, trigger: { channelId: 'companion-messages' } });
  });
  it('suppresses alerts in the visible chat and rejects old account notifications', async () => {
    listenForCompanionNotifications(vi.fn(), () => true, () => true);
    const handler = mocks.handler.mock.calls.at(-1)![0].handleNotification;
    expect(await handler({ request: { content: { data: {} } } })).toMatchObject({ shouldShowBanner: false, shouldPlaySound: false });
    mocks.state.currentState = 'background';
    expect(await handler({ request: { content: { data: {} } } })).toMatchObject({ shouldShowBanner: true });
    listenForCompanionNotifications(vi.fn(), () => false, () => false);
    expect(await mocks.handler.mock.calls.at(-1)![0].handleNotification({ request: { content: {} } })).toMatchObject({ shouldShowBanner: false });
  });
  it('opens a notification tap and avoids a second local alert when a system push is registered', async () => {
    const onOpen = vi.fn(); listenForCompanionNotifications(onOpen, () => false, () => true);
    const data = { ...scope, type: 'companion-message', conversationId: 'topic-1' };
    mocks.response.mock.calls[0]![0]({ notification: { request: { content: { data } } } }); expect(onOpen).toHaveBeenCalledWith(data);
    setCompanionPushRegistered(true); await presentCompanionNotification(event, 'Lumi', scope); expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it('does not ask again automatically after a denial and remains usable if cloud token registration fails', async () => {
    mocks.permission.mockResolvedValue({ granted: false, canAskAgain: true, status: 'denied' });
    expect(await prepareCompanionNotifications(false)).toEqual({ granted: false }); expect(mocks.request).not.toHaveBeenCalled();
    mocks.permission.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' }); mocks.constants.expoConfig.extra = { eas: { projectId: 'test-project' } };
    mocks.push.mockRejectedValue(new Error('FCM not configured'));
    expect(await prepareCompanionNotifications()).toEqual({ granted: true });
  });
});
