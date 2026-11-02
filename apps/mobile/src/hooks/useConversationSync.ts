import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAppStore } from '../store/useAppStore';

/** Pulls remote conversations on foreground and periodically so both the web
 *  client and the phone stay in sync while the app is open. */
export function useConversationSync() {
  useEffect(() => {
    const syncIfAuthed = () => {
      const state = useAppStore.getState();
      if (state.authStatus === 'authenticated') void state.syncAccount().catch(() => undefined);
    };
    const interval = setInterval(syncIfAuthed, 60_000);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') syncIfAuthed();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, []);
}
