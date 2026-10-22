import { createNavigationContainerRef } from '@react-navigation/native';
import { useAppStore } from '../store/useAppStore';
import type { RootStackParamList } from '../types';
import { companionNotificationTarget } from './companionNotification';

export const appNavigationRef = createNavigationContainerRef<RootStackParamList>();
let pending: unknown;

export function isCompanionChatVisible(data: unknown): boolean {
  const state = useAppStore.getState();
  const target = companionNotificationTarget(data, state);
  return !!target && appNavigationRef.isReady() && appNavigationRef.getCurrentRoute()?.name === 'Chat' && state.activeConversationId === target;
}

export function openCompanionNotification(data: unknown) {
  pending = data;
  flushCompanionNotification();
}

export function flushCompanionNotification() {
  if (!pending) return;
  const state = useAppStore.getState();
  if (!state.hydrated || state.authStatus === 'unknown' || !appNavigationRef.isReady()) return;
  const target = companionNotificationTarget(pending, state);
  pending = undefined;
  if (!target) return;
  state.setActiveConversation(target);
  appNavigationRef.navigate('Chat');
}
