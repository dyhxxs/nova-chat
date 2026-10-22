import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform, Pressable, StyleSheet, View } from 'react-native';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText as Text } from './ThemedText';
import { useAppTheme } from '../hooks/useAppTheme';
import { createId } from '../lib/id';
import type { RecordedVoice } from '../lib/voice';

type Props = { active: boolean; disabled: boolean; onRecordStart: () => void; onRecorded: (recording: RecordedVoice, asText: boolean) => Promise<boolean> };
function discard(uri?: string | null) { if (!uri) return; try { if (Platform.OS === 'web') URL.revokeObjectURL(uri); else new File(uri).delete(); } catch { /* OS may already have cleared cache. */ } }
export function VoiceRecorder({ active, disabled, onRecordStart, onRecorded }: Props) {
  const theme = useAppTheme();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const state = useAudioRecorderState(recorder, 100);
  const [asText, setAsText] = useState(false), [phase, setPhase] = useState<'idle' | 'preparing' | 'recording' | 'sending'>('idle');
  const [cancel, setCancel] = useState(false), [draft, setDraft] = useState<RecordedVoice>(), [error, setError] = useState('');
  const held = useRef(false), cancelRef = useRef(false), releaseRequested = useRef(false), initialY = useRef(0), gestureStarted = useRef(0), started = useRef(0), alive = useRef(true), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), finishing = useRef(false);
  const permissionStatus = useRef<'unknown' | 'granted' | 'denied'>('unknown');
  const permissionRequest = useRef<Promise<boolean> | undefined>(undefined);
  const draftRef = useRef<RecordedVoice | undefined>(undefined), sendingRef = useRef(false);
  const send = async (recording: RecordedVoice) => {
    sendingRef.current = true;
    setPhase('sending'); setError('');
    try {
      const accepted = await onRecorded(recording, asText);
      if (!alive.current) { discard(recording.uri); draftRef.current = undefined; return; }
      if (accepted) { discard(recording.uri); draftRef.current = undefined; setDraft(undefined); }
      else { setDraft(recording); setError('没有发送成功，录音已保留，可以重试。'); }
    } catch (err) { if (alive.current) { setDraft(recording); setError(err instanceof Error ? err.message : '语音处理失败，可以重试。'); } }
    finally { sendingRef.current = false; if (!alive.current) { discard(recording.uri); draftRef.current = undefined; } else setPhase('idle'); }
  };
  const finishRef = useRef<(cancelled?: boolean) => Promise<void>>(async () => {});
  finishRef.current = async (cancelled = false) => {
    held.current = false;
    // Permission and recorder preparation are asynchronous. A release can arrive
    // before recording has actually started; remember it so preparation can finish
    // cleanly instead of dropping the gesture or leaving the recorder open.
    if (!started.current) { releaseRequested.current = true; return; }
    if (finishing.current) return;
    finishing.current = true;
    if (timer.current) clearTimeout(timer.current);
    const durationMs = Math.min(60_000, Math.max(0, Math.round(Date.now() - started.current)));
    started.current = 0;
    gestureStarted.current = 0;
    try {
      // The Android recorder state can lag one render behind the native start.
      // Once started.current is set, always finalize the native recording.
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      if (cancelled || cancelRef.current || !alive.current) { discard(uri); if (alive.current) setPhase('idle'); return; }
      if (durationMs < 600 || !uri) { discard(uri); setPhase('idle'); Alert.alert('录音太短', '请按住说话至少一秒。'); return; }
      const recording = { uri, durationMs, mimeType: Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4', requestId: createId() };
      draftRef.current = recording; setDraft(recording); void Haptics.selectionAsync(); await send(recording);
    } catch { if (alive.current) { setPhase('idle'); setError('录音被中断，请重新录制。'); } }
    finally { finishing.current = false; }
  };
  const abort = useCallback(() => { held.current = false; cancelRef.current = true; void finishRef.current(true); }, []);
  const ensurePermission = useCallback(async () => {
    if (permissionStatus.current === 'granted') return true;
    if (permissionStatus.current === 'denied') return false;
    if (!permissionRequest.current) {
      permissionRequest.current = AudioModule.requestRecordingPermissionsAsync()
        .then(permission => {
          permissionStatus.current = permission.granted ? 'granted' : 'denied';
          return permission.granted;
        })
        .catch(() => {
          permissionStatus.current = 'denied';
          return false;
        })
        .finally(() => { permissionRequest.current = undefined; });
    }
    return permissionRequest.current;
  }, []);
  useEffect(() => {
    if (!active || disabled) return;
    void ensurePermission();
  }, [active, disabled, ensurePermission]);
  useEffect(() => { if (!active) abort(); }, [active, abort]);
  useEffect(() => {
    alive.current = true;
    const listener = AppState.addEventListener('change', next => { if (next !== 'active') abort(); });
    return () => { alive.current = false; abort(); if (timer.current) clearTimeout(timer.current); listener.remove(); if (!sendingRef.current) { discard(draftRef.current?.uri); draftRef.current = undefined; } };
  }, [abort]);
  const begin = async (pageY: number) => {
    if (disabled || !active || phase !== 'idle' || draft || held.current) return;
    held.current = true;
    cancelRef.current = false;
    releaseRequested.current = false;
    gestureStarted.current = Date.now();
    initialY.current = pageY;
    setCancel(false);
    setPhase('preparing');
    setError('');
    try {
      onRecordStart();
      const granted = await ensurePermission();
      // A first-time Android permission dialog interrupts the original touch.
      // Do not start a recording after that touch has already ended.
      if (!granted) {
        held.current = false;
        gestureStarted.current = 0;
        if (alive.current) {
          setPhase('idle');
          Alert.alert('需要麦克风权限', '请在系统设置中允许 Nova 使用麦克风后再试。');
        }
        return;
      }
      if (!held.current || !alive.current) {
        gestureStarted.current = 0;
        if (alive.current) setPhase('idle');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, interruptionMode: 'doNotMix' });
      await recorder.prepareToRecordAsync();
      if (cancelRef.current || !alive.current) {
        await recorder.stop();
        await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
        gestureStarted.current = 0;
        if (alive.current) setPhase('idle');
        return;
      }
      recorder.record({ forDuration: 60 });
      started.current = gestureStarted.current || Date.now();
      setPhase('recording');
      void Haptics.selectionAsync();
      timer.current = setTimeout(() => { void finishRef.current(); }, 60_000);
      if (releaseRequested.current) void finishRef.current(cancelRef.current);
    } catch {
      held.current = false;
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      if (alive.current) {
        setPhase('idle');
        setError('无法开始录音，请检查麦克风权限后再试。');
      }
    }
  };
  const seconds = Math.max(1, Math.ceil(state.durationMillis / 1000));
  return <View style={{ flex: 1 }}>
    {(phase === 'recording' || phase === 'preparing') && <View style={[styles.indicator, { backgroundColor: cancel ? '#B33C47' : '#26342E' }]}>
      <Ionicons name={cancel ? 'trash-outline' : 'mic'} size={25} color="#FFFFFF" />
      <Text style={{ color: '#FFFFFF', fontSize: 16 }}>{phase === 'preparing' ? '正在打开麦克风…' : cancel ? '松开取消' : seconds + '″ · 松开发送'}</Text>
      <Text style={{ color: '#D4DED8', fontSize: 11 }}>{cancel ? '移回按钮可继续录音' : '上滑取消 · 最长 60 秒'}</Text>
    </View>}
    {draft && phase !== 'recording' ? <View style={{ gap: 7, padding: 6 }}>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{phase === 'sending' ? '正在识别语音…' : Math.ceil(draft.durationMs / 1000) + '″ 录音已保留'}</Text>
      {!!error && <Text style={{ color: theme.colors.danger, fontSize: 12 }}>{error}</Text>}
      <View style={{ flexDirection: 'row', gap: 18 }}>
        <Pressable disabled={phase === 'sending'} onPress={() => { discard(draft.uri); draftRef.current = undefined; setDraft(undefined); setError(''); }} accessibilityLabel="丢弃录音" style={styles.action}><Text style={{ color: theme.colors.textSecondary }}>丢弃</Text></Pressable>
        <Pressable disabled={phase === 'sending' || disabled} onPress={() => { void send(draft); }} accessibilityLabel="重试发送录音" style={styles.action}><Text style={{ color: theme.colors.primary }}>重试</Text></Pressable>
      </View>
    </View> : <Pressable accessibilityRole="button" accessibilityLabel={asText ? '按住说话转文字' : '按住说话发送语音'}
      onPressIn={event => { void begin(event.nativeEvent.pageY); }}
      onTouchMove={event => { const next = initialY.current - event.nativeEvent.pageY > 70; cancelRef.current = next; setCancel(next); }}
      onPressOut={() => { void finishRef.current(); }}
      onTouchCancel={abort}
      // Keep responder fallbacks for Android builds that bypass Pressability;
      // held/finishing refs make duplicate callbacks harmless.
      onResponderGrant={event => { void begin(event.nativeEvent.pageY); }}
      onResponderMove={event => { const next = initialY.current - event.nativeEvent.pageY > 70; cancelRef.current = next; setCancel(next); }}
      onResponderRelease={() => { void finishRef.current(); }}
      onResponderTerminationRequest={() => false}
      onResponderTerminate={abort}
      style={({ pressed }) => [styles.hold, { backgroundColor: phase === 'recording' ? theme.colors.surfaceMuted : 'transparent', opacity: disabled ? 0.45 : 1 }, pressed && { opacity: 0.78 }]}>
      <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '600' }}>{phase === 'preparing' ? '正在准备…' : phase === 'recording' ? cancel ? '松开取消' : '松开发送 · 上滑取消' : asText ? '按住说话转文字' : '按住说话'}</Text>
    </Pressable>}
    {!draft && phase === 'idle' && <Pressable onPress={() => setAsText(value => !value)} accessibilityLabel="切换语音和语音转文字" style={{ alignItems: 'center', paddingVertical: 4 }}><Text style={{ color: theme.colors.textTertiary, fontSize: 10 }}>{asText ? '转成文字后可编辑 · 切换语音消息' : '发送语音消息 · 切换语音转文字'}</Text></Pressable>}
    {!!error && !draft && <Text style={{ color: theme.colors.danger, fontSize: 11 }}>{error}</Text>}
  </View>;
}
const styles = StyleSheet.create({ hold: { minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, action: { minHeight: 36, justifyContent: 'center' }, indicator: { position: 'absolute', bottom: 75, alignSelf: 'center', minWidth: 210, borderRadius: 20, padding: 20, gap: 10, alignItems: 'center', zIndex: 20 } });
