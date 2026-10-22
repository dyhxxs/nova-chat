import { presentCompanionNotification } from '../services/companionNotifications';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { listCompanionEvents } from '../services/gatewayApiClient';
import { useAppStore } from '../store/useAppStore';

/** Receive companion deliveries throughout the app, including chats not on screen. */
export function useCompanionEvents() {
  const token = useAppStore(state => state.accessToken);
  const userId = useAppStore(state => state.user?.id);
  const serverUrl = useAppStore(state => state.settings.serverUrl);
  useEffect(() => {
    if (!token || !userId) return;
    let alive = true;
    let inFlight = false;
    const controller = new AbortController();
    const poll = async () => {
      if (!alive || inFlight || AppState.currentState !== 'active') return;
      inFlight = true;
      try {
        const conversations = useAppStore.getState().conversations.filter(conversation => conversation.companionId);
        for (const conversation of conversations) {
          const cursor = conversation.messages.reduce((latest, message) => message.sourceEventId ? Math.max(latest, message.createdAt) : latest, 0);
          try {
            const events = await listCompanionEvents(serverUrl, token, conversation.companionId!, conversation.id, cursor, controller.signal);
            const state = useAppStore.getState();
            if (!alive || state.accessToken !== token || state.user?.id !== userId || state.settings.serverUrl !== serverUrl) return;
            const known = new Set(state.conversations.find(topic => topic.id === conversation.id)?.messages.map(message => message.sourceEventId));
            for (const event of events) {
              if (known.has(event.eventId)) continue;
              state.appendCompanionEvent(conversation.id, event);
              known.add(event.eventId);
              // Never let notification permission or delivery failure interrupt chat synchronization.
              void presentCompanionNotification(event, conversation.companionName || 'TA', { userId, serverUrl }).catch(() => undefined);
            }
          } catch {
            // A connection outage retains local messages and retries on the next foreground tick.
          }
        }
      } finally { inFlight = false; }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, 12_000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void poll(); });
    return () => { alive = false; controller.abort(); clearInterval(timer); subscription.remove(); };
  }, [serverUrl, token, userId]);
}
