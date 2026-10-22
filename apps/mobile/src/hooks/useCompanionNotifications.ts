import { useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { companionNotificationTarget } from '../lib/companionNotification';
import { flushCompanionNotification, isCompanionChatVisible, openCompanionNotification } from '../lib/notificationNavigation';
import { listenForCompanionNotifications, prepareCompanionNotifications, resetCompanionNotificationScope, setCompanionPushRegistered, updateCompanionNotificationBadge } from '../services/companionNotifications';
import { registerCompanionPushDevice } from '../services/gatewayApiClient';
import { useAppStore } from '../store/useAppStore';

export const useCompanionNotificationStatus = create<{ granted: boolean; pushReady: boolean; busy: boolean }>(() => ({ granted: false, pushReady: false, busy: false }));

export async function enableCompanionNotifications(requestPermission = true, signal?: AbortSignal) {
  const scope = useAppStore.getState();
  if (!scope.accessToken || !scope.user || signal?.aborted) return;
  const current = () => {
    const state = useAppStore.getState();
    return !signal?.aborted && state.accessToken === scope.accessToken && state.user?.id === scope.user?.id && state.settings.serverUrl === scope.settings.serverUrl;
  };
  useCompanionNotificationStatus.setState({ busy: true });
  try {
    const setup = await prepareCompanionNotifications(requestPermission);
    if (!current()) return;
    let pushReady = false;
    if (setup.token) {
      try { await registerCompanionPushDevice(scope.settings.serverUrl, scope.accessToken, setup.token, signal); pushReady = true; }
      catch { /* Local notifications remain available; retry registration on returning to the app. */ }
    }
    if (!current()) return;
    setCompanionPushRegistered(pushReady);
    useCompanionNotificationStatus.setState({ granted: setup.granted, pushReady, busy: false });
  } catch { if (current()) useCompanionNotificationStatus.setState({ busy: false }); }
}

export function useCompanionNotifications() {
  const token = useAppStore(state => state.accessToken);
  const userId = useAppStore(state => state.user?.id);
  const serverUrl = useAppStore(state => state.settings.serverUrl);
  const hydrated = useAppStore(state => state.hydrated);
  const authStatus = useAppStore(state => state.authStatus);
  const hasCompanion = useAppStore(state => state.conversations.some(topic => !!topic.companionId));
  const unreadCount = useAppStore(state => state.conversations.reduce((total, topic) => total + (topic.unreadCount ?? 0), 0));
  useEffect(() => { updateCompanionNotificationBadge(unreadCount); }, [unreadCount]);
  useEffect(() => listenForCompanionNotifications(openCompanionNotification, isCompanionChatVisible,
    data => !!companionNotificationTarget(data, useAppStore.getState())), []);
  useEffect(() => {
    resetCompanionNotificationScope();
    // Scope resets clear the native badge; restore the current local total after that reset.
    updateCompanionNotificationBadge(unreadCount);
    useCompanionNotificationStatus.setState({ granted: false, pushReady: false, busy: false });
    if (!token || !userId || !hydrated || authStatus !== 'authenticated' || !hasCompanion) return;
    const controller = new AbortController();
    // Ask once for the initial OS permission. Denied permission is retried only by the settings button.
    void enableCompanionNotifications(false, controller.signal);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') { void enableCompanionNotifications(false, controller.signal); flushCompanionNotification(); }
    });
    return () => { controller.abort(); subscription.remove(); };
  }, [authStatus, hasCompanion, hydrated, serverUrl, token, userId]);
  useEffect(() => { flushCompanionNotification(); }, [authStatus, hydrated, serverUrl, token, userId]);
}
