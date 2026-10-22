import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import * as Speech from 'expo-speech';
import { useAppStore } from '../store/useAppStore';
import { getSpeech, submitSpeech } from '../services/voiceClient';
import { toRestUrl } from '../lib/connection';
import { appVersionHeaders } from '../lib/appUpdate';
import { createId } from '../lib/id';
import { voicePreferencesForConversation } from '../lib/voice';
import type { Conversation, AppMessage } from '../types';

export function useVoiceChat(conversation: Conversation | undefined, serverUrl: string, accessToken: string) {
  const player = useAudioPlayer(null, { updateInterval: 150 });
  const status = useAudioPlayerStatus(player);
  const [playingId, setPlayingId] = useState<string>();
  const sequence = useRef(0);
  const requestedPlayback = useRef<string | undefined>(undefined);
  const stop = useCallback(() => { requestedPlayback.current = undefined; sequence.current++; try { player.pause(); player.replace(null); } catch { /* Native player may already be released on unmount. */ } setPlayingId(undefined); }, [player]);
  useEffect(() => {
    if (status.didJustFinish) setPlayingId(undefined);
    if (status.error && playingId) { stop(); Alert.alert('无法播放', '语音加载失败，请检查网络后重试。'); }
  }, [status.didJustFinish, status.error, playingId, stop]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => { if (state !== 'active') stop(); });
    return () => { listener.remove(); stop(); };
  }, [stop, conversation?.id, serverUrl, accessToken]);
  const play = useCallback(async (message: AppMessage) => {
    if (!message.voice?.fileId && !message.voice?.localRecording) return;
    if (playingId === message.id) { stop(); return; }
    stop(); const current = sequence.current;
    try {
      await Speech.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false, interruptionMode: 'doNotMix' });
      if (sequence.current !== current) return;
      player.replace(message.voice?.localRecording ? { uri: message.voice.localRecording.uri } : { uri: toRestUrl(serverUrl, '/v1/files/' + message.voice!.fileId), headers: { ...appVersionHeaders, Authorization: 'Bearer ' + accessToken } });
      setPlayingId(message.id); player.play();
    } catch { stop(); Alert.alert('无法播放', '请检查网络和媒体音量后再试。'); }
  }, [accessToken, player, playingId, serverUrl, stop]);
  const pendingKey = conversation?.messages.filter(message => message.role === 'assistant' && message.voice?.status === 'pending' && message.status === 'complete').map(message => message.id + ':' + message.voice?.requestId).join('|') ?? '';
  useEffect(() => {
    if (!conversation || !accessToken || !pendingKey) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const conversationId = conversation.id;
    const scopeValid = () => !controller.signal.aborted && useAppStore.getState().accessToken === accessToken && useAppStore.getState().settings.serverUrl === serverUrl;
    const update = (id: string, requestId: string, voice: NonNullable<AppMessage['voice']>) => {
      const message = useAppStore.getState().conversations.find(item => item.id === conversationId)?.messages.find(item => item.id === id);
      if (scopeValid() && message?.voice?.requestId === requestId) useAppStore.getState().setMessageVoice(conversationId, id, voice);
    };
    const submitted = new Set<string>();
    const poll = async () => {
      if (!scopeValid()) return;
      const messages = useAppStore.getState().conversations.find(item => item.id === conversationId)?.messages ?? [];
      // Process in order, keeping the companion's short bubble rhythm and avoiding paid request bursts.
      const message = messages.find(item => item.role === 'assistant' && item.status === 'complete' && item.voice?.status === 'pending');
      if (!message?.voice) return;
      const voice = message.voice;
      try {
        if (message.content.length > 2000) throw new Error('这条消息太长，请使用朗读功能。');
        const next = submitted.has(voice.requestId)
          ? await getSpeech(serverUrl, accessToken, voice.requestId, controller.signal)
          : await submitSpeech(serverUrl, accessToken, message.content, voice, controller.signal);
        submitted.add(voice.requestId); update(message.id, voice.requestId, next);
      } catch (error) {
        if (scopeValid()) {
          // A lost POST response may already have created a paid task. Recover before offering another request.
          try { update(message.id, voice.requestId, await getSpeech(serverUrl, accessToken, voice.requestId, controller.signal)); submitted.add(voice.requestId); }
          catch { if (scopeValid()) update(message.id, voice.requestId, { ...voice, status: 'error', resumable: true, error: error instanceof Error ? error.message : '连接中断，点按继续。' }); }
        }
      }
      if (scopeValid()) timer = setTimeout(() => { void poll(); }, 4000);
    };
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [conversation?.id, pendingKey, accessToken, serverUrl]);
  const retry = useCallback((message: AppMessage) => {
    if (!conversation || !message.voice) return;
    useAppStore.getState().setMessageVoice(conversation.id, message.id, { ...message.voice, status: 'pending', requestId: message.role === 'user' || message.voice.resumable ? message.voice.requestId : createId(), error: undefined, resumable: undefined });
  }, [conversation]);
  // A companion's text-message playback uses the same configured voice as its voice bubbles.
  const readAloud = useCallback((message: AppMessage) => {
    if (!conversation || message.role !== 'assistant' || message.status !== 'complete') return;
    if (message.voice?.status === 'ready') { void play(message); return; }
    if (!message.content.trim() || message.content.length > 2000) {
      Alert.alert('无法生成语音', '请选择 2000 字以内的消息。'); return;
    }
    stop(); void Speech.stop(); requestedPlayback.current = message.id;
    if (message.voice?.status === 'pending') return;
    if (message.voice) { retry(message); return; }
    useAppStore.getState().setMessageVoice(conversation.id, message.id, {
      status: 'pending', durationMs: 0, requestId: createId(),
      voiceId: voicePreferencesForConversation(Boolean(conversation.companionId), conversation.voicePreferences).voiceId,
    });
  }, [conversation, play, retry, stop]);
  useEffect(() => {
    const message = conversation?.messages.find(item => item.id === requestedPlayback.current);
    if (message?.voice?.status === 'ready') { requestedPlayback.current = undefined; void play(message); }
    else if (message?.voice?.status === 'error') requestedPlayback.current = undefined;
  }, [conversation, play]);
  return { play, stop, retry, readAloud, playingId };
}
