import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { accountScope } from '../lib/accountScope';
import { ConversationForkError, isForkSelectionCurrent, previewConversationFork, type ForkMode, type ForkPreview, type ForkSelection } from '../lib/conversationFork';
import { useAppStore } from '../store/useAppStore';

type Selection = { source: ForkSelection; preview: ForkPreview };
export function useConversationFork(blocked: boolean) {
  const navigation = useNavigation();
  const scope = useAppStore(accountScope);
  const serverUrl = useAppStore(state => state.settings.serverUrl);
  const conversation = useAppStore(state => state.conversations.find(item => item.id === state.activeConversationId));
  const blockedRef = useRef(blocked); blockedRef.current = blocked;
  const available = useRef(false);
  const target = useRef<Selection | undefined>(undefined);
  const [selected, setSelected] = useState<Selection>();
  const [error, setError] = useState('');
  const close = () => { target.current = undefined; setSelected(undefined); };
  useEffect(() => {
    let focused = navigation.isFocused();
    let foreground = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    const refresh = () => {
      available.current = focused && foreground;
      if (target.current && (!available.current || !isForkSelectionCurrent(target.current.source, useAppStore.getState()))) close();
      if (!available.current) setError('');
    };
    refresh();
    const store = useAppStore.subscribe(refresh);
    const focus = navigation.addListener('focus', () => { focused = true; refresh(); });
    const blur = navigation.addListener('blur', () => { focused = false; refresh(); });
    const app = AppState.addEventListener('change', state => { foreground = state === 'active'; refresh(); });
    return () => { available.current = false; target.current = undefined; store(); focus(); blur(); app.remove(); };
  }, [navigation]);
  useEffect(() => { close(); setError(''); }, [scope, serverUrl]);
  useEffect(() => { if (blocked) close(); }, [blocked]);
  const open = (messageId: string, mode: ForkMode) => {
    if (!available.current || !conversation) return;
    const source = { scope, serverUrl, conversation, messageId, mode };
    if (!isForkSelectionCurrent(source, useAppStore.getState())) return;
    close(); setError('');
    if (blockedRef.current) { setError('请先发送或移除待发送附件，并等待上传结束，再创建分支。'); return; }
    try {
      const next = { source, preview: previewConversationFork(conversation, messageId, mode) };
      target.current = next; setSelected(next);
    } catch (failure) { setError(failure instanceof ConversationForkError ? failure.message : '无法准备分支，请稍后重试。'); }
  };
  const confirm = () => {
    const current = selected;
    if (!current || target.current !== current) return;
    close();
    if (!available.current || blockedRef.current || !isForkSelectionCurrent(current.source, useAppStore.getState())) return;
    try { useAppStore.getState().forkConversation(current.source); }
    catch (failure) { setError(failure instanceof ConversationForkError ? failure.message : '创建分支失败，请稍后重试。'); }
  };
  return { selected, error, open, close, confirm, dismissError: () => setError('') };
}
