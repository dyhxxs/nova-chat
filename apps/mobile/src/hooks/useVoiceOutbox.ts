import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { uploadVoice } from '../services/voiceClient';
import { removeVoiceRecording } from '../services/voiceRecordingFiles';

type Turn = { conversationId: string; assistantMessageId: string };

/** Send local audio independently of the recorder and the visible conversation. */
export function useVoiceOutbox(serverUrl: string, accessToken: string, onReady: (turn: Turn) => void) {
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    if (!serverUrl || !accessToken) return;
    const controller = new AbortController();
    let busy = false;
    const valid = () => !controller.signal.aborted && useAppStore.getState().accessToken === accessToken && useAppStore.getState().settings.serverUrl === serverUrl;
    const pump = async () => {
      if (busy || !valid()) return;
      busy = true;
      try {
        while (valid()) {
          const job = useAppStore.getState().conversations.flatMap(conversation => {
            if (conversation.messages.some(message => message.role === 'assistant' && message.status === 'streaming')) return [];
            const message = conversation.messages.find(item => item.role === 'user' && item.voice?.status === 'pending' && item.voice.localRecording);
            return message ? [{ conversationId: conversation.id, message }] : [];
          }).sort((a, b) => a.message.createdAt - b.message.createdAt)[0];
          if (!job?.message.voice?.localRecording) break;
          const { conversationId, message } = job, voice = message.voice!;
          const local = voice.localRecording!;
          try {
            const result = await uploadVoice(serverUrl, accessToken, { ...local, requestId: voice.requestId, durationMs: voice.durationMs }, controller.signal);
            if (!valid()) break;
            const turn = useAppStore.getState().completeRecordedVoice(conversationId, message.id, result.text, result.voice);
            if (turn) onReadyRef.current(turn);
            await useAppStore.getState().flushPersistence();
            if (valid() && !useAppStore.getState().persistenceError) await removeVoiceRecording(local.uri);
          } catch (error) {
            if (!valid()) break;
            const current = useAppStore.getState().conversations.find(item => item.id === conversationId)?.messages.find(item => item.id === message.id);
            if (current?.voice?.localRecording?.uri === local.uri) useAppStore.getState().setMessageVoice(conversationId, message.id, {
              ...voice, status: 'error', error: error instanceof Error ? error.message.slice(0, 300) : '语音发送失败，请重试。',
            });
          }
        }
      } finally { busy = false; }
    };
    const unsubscribe = useAppStore.subscribe(() => { void pump(); });
    void pump();
    return () => { controller.abort(); unsubscribe(); };
  }, [serverUrl, accessToken]);
}
