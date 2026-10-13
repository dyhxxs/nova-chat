import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { accountScope } from '../lib/accountScope';
import { SpeechController, type SpeechLanguage, type SpeechRate, type SpeechState } from '../lib/speechController';
import { isSpeechSourceCurrent, type SpeechSource } from '../lib/speechSource';
import { speechDriver } from '../services/speechDriver';
import { useAppStore } from '../store/useAppStore';

export function useReadAloud() {
  const navigation = useNavigation();
  const renderedScope = useAppStore(accountScope);
  const renderedConversationId = useAppStore(state => state.activeConversationId);
  const controller = useRef<SpeechController | undefined>(undefined);
  const available = useRef(false);
  const target = useRef<SpeechSource | undefined>(undefined);
  const [selected, setSelected] = useState<SpeechSource>();
  const [state, setState] = useState<SpeechState>({ phase: 'idle', chunk: 0, total: 0 });
  const close = () => { target.current = undefined; setSelected(undefined); };

  useEffect(() => {
    let focused = navigation.isFocused();
    let foreground = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    available.current = focused && foreground;
    const player = new SpeechController(speechDriver, source => available.current && isSpeechSourceCurrent(source, useAppStore.getState()), setState);
    controller.current = player;
    const refresh = () => {
      player.refresh();
      if (target.current && (!available.current || !isSpeechSourceCurrent(target.current, useAppStore.getState()))) close();
    };
    const visibility = () => {
      available.current = focused && foreground;
      if (!available.current) { close(); player.cancel(); } else refresh();
    };
    const unsubscribe = useAppStore.subscribe(refresh);
    const removeFocus = navigation.addListener('focus', () => { focused = true; visibility(); });
    const removeBlur = navigation.addListener('blur', () => { focused = false; visibility(); });
    const app = AppState.addEventListener('change', next => { foreground = next === 'active'; visibility(); });
    return () => {
      available.current = false; target.current = undefined; controller.current = undefined;
      unsubscribe(); removeFocus(); removeBlur(); app.remove(); player.dispose();
    };
  }, [navigation]);

  const open = (messageId: string) => {
    const current = useAppStore.getState();
    if (!available.current || !controller.current || accountScope(current) !== renderedScope || current.activeConversationId !== renderedConversationId) return;
    const message = current.conversations.find(item => item.id === renderedConversationId)?.messages.find(item => item.id === messageId);
    if (message?.role !== 'assistant' || message.status !== 'complete' || !message.content.trim()) return;
    const playing = controller.current.getState();
    if (playing.messageId === messageId && ['preparing', 'speaking'].includes(playing.phase)) { controller.current.cancel(); return; }
    controller.current.cancel();
    const source = { scope: renderedScope, conversationId: renderedConversationId, messageId, content: message.content };
    target.current = source; setSelected(source);
  };
  const play = (rate: SpeechRate, language: SpeechLanguage) => {
    const source = selected;
    if (!source || target.current !== source) return;
    close();
    if (source && available.current && isSpeechSourceCurrent(source, useAppStore.getState())) void controller.current?.start(source, rate, language);
  };
  return { selected, state, open, close, play, stop: () => controller.current?.cancel() };
}
