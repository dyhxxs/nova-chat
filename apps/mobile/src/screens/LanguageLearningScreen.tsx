import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import * as Speech from 'expo-speech';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareView } from '../components/KeyboardAwareView';
import { VoiceRecorder } from '../components/VoiceRecorder';
import { StudyPracticePanel } from '../components/StudyPracticePanel';
import { ThemedText as Text } from '../components/ThemedText';
import { useAppTheme } from '../hooks/useAppTheme';
import { useAppStore } from '../store/useAppStore';
import { createId } from '../lib/id';
import { startGeneration, type GenerationController } from '../services/chatClient';
import type { GenerateRequest } from '@nova-chat/protocol';
import { friendlyNetworkError } from '../lib/errorMessage';
import {
  emptyLanguageLearningSession, loadLanguageLearningState, saveLanguageLearningState,
  languageLearningStorageKey,
  turnsForLearningMode, type LanguageLearningSession, type LearningLanguageId, type LearningLevel, type LearningMode, type LearningTurn,
} from '../lib/languageLearning';
import { downloadSpeechAudio, getSpeech, submitSpeech, uploadVoice } from '../services/voiceClient';
import {
  assessLanguagePronunciationAudio, getLanguageLearningConfig, sendLanguageLearningMessage, translateLanguageLearningMessage,
  type LanguageLearningConfig, type LanguageLearningLanguage, type LanguageLearningReply,
} from '../services/gatewayApiClient';
import type { RecordedVoice, VoiceMessage } from '../lib/voice';

const FALLBACK_LANGUAGES: LanguageLearningLanguage[] = [
  { id: 'cantonese', name: '粤语', nativeName: '廣東話', locale: 'yue-CN', description: '从声调、粤拼到地道日常对话，逐句练到敢开口。' },
  { id: 'english', name: '英语', nativeName: 'English', locale: 'en-US', description: '从音素、重音和节奏开始，把句子说得清楚又自然。' },
];
const LEVELS: { value: LearningLevel; label: string }[] = [
  { value: 'beginner', label: '入门' }, { value: 'intermediate', label: '中级' }, { value: 'advanced', label: '进阶' },
];
function languageLabel(id: LearningLanguageId): string { return id === 'cantonese' ? '粤语' : '英语'; }

function conversationInstructions(languageId: LearningLanguageId, level: LearningLevel): string {
  const language = languageLabel(languageId);
  const levelLabel = level === 'beginner' ? '初学者' : level === 'intermediate' ? '中级' : '进阶';
  return [
    `你是 LinguaSoul，一位有性格、有耐心、会记住上下文的${language}口语教练。学习者水平是${levelLabel}。`,
    `当前是实时互动对话，不是翻译题、词典或教学报告。无论学习者使用普通话、中文方言、英语还是${language}，先理解他真正想表达的意思，再用自然的${language}接话。`,
    languageId === 'cantonese'
      ? '粤语必须是地道日常口语，优先使用自然粤语词和语气，避免普通话书面句逐字转换；用适合阅读的繁体字。'
      : '英语必须像真人聊天，使用自然、简洁的日常表达，不要写成课本或翻译结果。',
    '只输出会发给学习者看的目标语言回复，不要输出 JSON、中文翻译、纠错、读法、标签、说明或思考过程。通常只说 1 句，最多 2 句；先直接接住用户，再在自然时问一个简短问题，让对话继续。',
    '例如用户说“我在上班”，英语可以自然回应 “Oh, you\'re at work! What are you working on today?”；不要回复“翻译：我在上班”或教学卡片。',
  ].join('\n');
}

async function speakWithDeviceVoice(text: string, languageId: LearningLanguageId): Promise<void> {
  const preferred = languageId === 'cantonese' ? ['yue-HK', 'zh-HK', 'zh-CN'] : ['en-US', 'en-GB'];
  let locale = preferred[0]!;
  // On a browser, speech synthesis must be started while the original tap is
  // still active. Do not await the voice inventory first or iOS Safari will
  // silently reject the request as an autoplay violation.
  if (Platform.OS === 'web') {
    Speech.speak(text, { language: locale, rate: 0.78, pitch: 1 });
    return;
  }
  try {
    const available = await Speech.getAvailableVoicesAsync();
    const voice = available.find((item) => preferred.some((candidate) => item.language.toLowerCase() === candidate.toLowerCase()))
      ?? available.find((item) => preferred.some((candidate) => item.language.toLowerCase().startsWith(candidate.slice(0, 2).toLowerCase())));
    if (voice?.language) locale = voice.language;
  } catch { /* Device voice inventory is optional. */ }
  Speech.speak(text, { language: locale, rate: 0.78, pitch: 1 });
}

type ReplyFields = Pick<LanguageLearningReply, 'reply' | 'translation' | 'correction' | 'pronunciation' | 'lesson' | 'followUp' | 'speechText'>;
function turnFromReply(reply: ReplyFields, role: 'assistant' | 'user', text: string, voice?: VoiceMessage, mode?: LearningMode): LearningTurn {
  return {
    id: createId(), role, text, createdAt: Date.now(),
    ...(mode ? { mode } : {}),
    ...(voice ? { voice } : {}),
    ...(role === 'assistant' ? { speechText: reply.speechText || reply.reply, translation: reply.translation, correction: reply.correction, pronunciation: reply.pronunciation, lesson: reply.lesson, followUp: reply.followUp } : {}),
  };
}

export function LanguageLearningScreen() {
  const theme = useAppTheme();
  const serverUrl = useAppStore((state) => state.settings.serverUrl);
  const accessToken = useAppStore((state) => state.accessToken);
  const userId = useAppStore((state) => state.user?.id ?? '');
  const deviceId = useAppStore((state) => state.deviceId);
  const selectedModel = useAppStore((state) => state.settings.model);
  const [config, setConfig] = useState<LanguageLearningConfig>({ languages: FALLBACK_LANGUAGES, voice: { enabled: false, defaultVoiceId: '', voices: [] } });
  const [sessions, setSessions] = useState<Partial<Record<LearningLanguageId, LanguageLearningSession>>>({});
  const [selectedLanguageId, setSelectedLanguageId] = useState<LearningLanguageId>();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [practiceBusy, setPracticeBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [streamingTurnId, setStreamingTurnId] = useState<string>();
  const [playingId, setPlayingId] = useState<string>();
  const [speechLoadingId, setSpeechLoadingId] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const mounted = useRef(true);
  const latestSessions = useRef(sessions);
  const loadedStorageKey = useRef<string | undefined>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const playbackUri = useRef<string | undefined>(undefined);
  const player = useAudioPlayer(null, { updateInterval: 150 });
  const playerStatus = useAudioPlayerStatus(player);
  const activeGeneration = useRef<GenerationController | undefined>(undefined);
  // Android can deliver both the IME submit callback and a follow-up key
  // event for one Enter press. Keep the send operation atomic so one press
  // always creates one learning turn.
  const sendLock = useRef(false);
  latestSessions.current = sessions;
  const languageId = selectedLanguageId;
  const language = config.languages.find((item) => item.id === languageId) ?? (languageId ? FALLBACK_LANGUAGES.find((item) => item.id === languageId) : undefined);
  const session = languageId ? sessions[languageId] ?? emptyLanguageLearningSession(languageId) : undefined;

  const releasePlaybackUri = useCallback(() => {
    const uri = playbackUri.current;
    playbackUri.current = undefined;
    if (Platform.OS === 'web' && uri?.startsWith('blob:')) URL.revokeObjectURL(uri);
  }, []);
  const stopPlayback = useCallback(() => {
    try { player.pause(); } catch { /* player may already be released. */ }
    releasePlaybackUri(); setPlayingId(undefined);
  }, [player, releasePlaybackUri]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; try { player.pause(); } catch { /* noop */ } releasePlaybackUri(); }; }, [player, releasePlaybackUri]);
  useEffect(() => () => { activeGeneration.current?.dispose(); activeGeneration.current = undefined; }, []);
  useEffect(() => {
    if (playerStatus.didJustFinish) { releasePlaybackUri(); setPlayingId(undefined); }
    if (playerStatus.error && playingId) { releasePlaybackUri(); setPlayingId(undefined); if (mounted.current) Alert.alert('无法播放', '目标语言语音加载失败，请检查网络和媒体音量后重试。'); }
  }, [playerStatus.didJustFinish, playerStatus.error, playingId, releasePlaybackUri]);

  useEffect(() => {
    const storageKey = userId && serverUrl ? languageLearningStorageKey(userId, serverUrl) : '';
    loadedStorageKey.current = undefined;
    setLoaded(false);
    if (!storageKey) { setSessions({}); return; }
    let disposed = false;
    void loadLanguageLearningState(userId, serverUrl).then((stored) => {
      if (!disposed) { loadedStorageKey.current = storageKey; setSessions(stored.sessions); setLoaded(true); }
    });
    return () => { disposed = true; };
  }, [serverUrl, userId]);
  useEffect(() => {
    const storageKey = userId && serverUrl ? languageLearningStorageKey(userId, serverUrl) : '';
    if (!loaded || !storageKey || loadedStorageKey.current !== storageKey) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void saveLanguageLearningState(userId, serverUrl, { version: 1, sessions: latestSessions.current }); }, 180);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [loaded, serverUrl, sessions, userId]);
  useEffect(() => () => {
    const storageKey = userId && serverUrl ? languageLearningStorageKey(userId, serverUrl) : '';
    if (storageKey && loadedStorageKey.current === storageKey) void saveLanguageLearningState(userId, serverUrl, { version: 1, sessions: latestSessions.current });
  }, [serverUrl, userId]);
  useEffect(() => {
    if (!serverUrl || !accessToken) return;
    const controller = new AbortController();
    void getLanguageLearningConfig(serverUrl, accessToken, controller.signal).then((next) => { if (!controller.signal.aborted) setConfig(next); }).catch((error) => { if (!controller.signal.aborted && mounted.current) setStatus(friendlyNetworkError(error)); });
    return () => controller.abort();
  }, [accessToken, serverUrl]);

  const updateSession = useCallback((id: LearningLanguageId, updater: (current: LanguageLearningSession) => LanguageLearningSession) => {
    setSessions((current) => { const next = updater(current[id] ?? emptyLanguageLearningSession(id)); return { ...current, [id]: { ...next, languageId: id, updatedAt: Date.now() } }; });
  }, []);

  const speak = useCallback(async (turn: LearningTurn, target = false) => {
    if (!languageId) return;
    const speechText = (turn.speechText ?? turn.text).trim();
    if (!speechText || speechLoadingId === turn.id) return;
    if (playingId === turn.id) { await Speech.stop(); stopPlayback(); return; }
    stopPlayback();
    setSpeechLoadingId(turn.id);
    let playback: Awaited<ReturnType<typeof downloadSpeechAudio>> | undefined;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let deviceFallbackStarted = false;
    const useDeviceFallback = () => {
      if (deviceFallbackStarted || !mounted.current) return;
      deviceFallbackStarted = true;
      void speakWithDeviceVoice(speechText, languageId).catch(() => undefined);
      if (mounted.current) setStatus('远程标准音生成较慢，先使用设备朗读…');
    };
    try {
      // A learner's recording is an audio message, not text to synthesize.
      // Play the protected original file so “播放我的录音” is truthful.
      if (turn.voice?.fileId && !target) {
        setStatus('正在加载你的录音…');
        playback = await downloadSpeechAudio(serverUrl, accessToken, turn.voice.fileId);
        if (!mounted.current) { playback.revoke(); return; }
        playbackUri.current = playback.uri;
        player.replace({ uri: playback.uri });
        player.volume = 1;
        setPlayingId(turn.id);
        player.play();
        setStatus('');
        return;
      }
      // Stop any previous speech without awaiting it. The web implementation
      // needs the next speak call to happen in the same user gesture.
      void Speech.stop();
      if (Platform.OS === 'web') { await speakWithDeviceVoice(speechText, languageId); return; }
      if (!config.voice.enabled) { await speakWithDeviceVoice(speechText, languageId); return; }
      setStatus('正在准备标准发音…');
      // Keep the button responsive while the relay completes its async task.
      // Remote audio still replaces this fallback as soon as it is ready.
      fallbackTimer = setTimeout(useDeviceFallback, 2_200);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false, interruptionMode: 'doNotMix' });
      let voice = target ? session?.practiceTarget?.voice : session?.turns.find((item) => item.id === turn.id)?.voice;
      if (!voice || voice.status !== 'ready') {
        const requestId = voice?.requestId ?? createId();
        voice = await submitSpeech(serverUrl, accessToken, speechText.slice(0, 2000), voice ?? { status: 'pending', durationMs: 0, requestId, voiceId: config.voice.defaultVoiceId });
        for (let attempt = 0; attempt < 20 && voice.status === 'pending'; attempt++) { await new Promise((resolve) => setTimeout(resolve, 1200)); voice = await getSpeech(serverUrl, accessToken, requestId); }
        if (target) updateSession(languageId, (current) => ({ ...current, practiceTarget: current.practiceTarget?.id === turn.id ? { ...current.practiceTarget, voice } : current.practiceTarget }));
        else updateSession(languageId, (current) => ({ ...current, turns: current.turns.map((item) => item.id === turn.id ? { ...item, voice } : item) }));
      }
      if (voice.status !== 'ready' || !voice.fileId) throw new Error(voice.error || '语音生成超时，请点按重试。');
      if (fallbackTimer) clearTimeout(fallbackTimer);
      void Speech.stop();
      playback = await downloadSpeechAudio(serverUrl, accessToken, voice.fileId);
      if (!mounted.current) { playback.revoke(); return; }
      playbackUri.current = playback.uri; player.replace({ uri: playback.uri }); player.volume = 1; setPlayingId(turn.id); player.play(); setStatus('');
    } catch (error) {
      if (fallbackTimer) clearTimeout(fallbackTimer);
      playback?.revoke(); if (!mounted.current) return;
      try {
        if (!deviceFallbackStarted) await speakWithDeviceVoice(speechText, languageId);
        setStatus(deviceFallbackStarted ? '设备朗读已开始，远程标准音暂不可用。' : '远程标准音暂不可用，已切换为设备朗读。');
      }
      catch { Alert.alert('无法播放', error instanceof Error ? error.message : '语音生成失败，请稍后重试。'); }
    } finally {
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (mounted.current) setSpeechLoadingId(undefined);
    }
  }, [accessToken, config.voice.defaultVoiceId, config.voice.enabled, languageId, player, playingId, serverUrl, session?.practiceTarget?.voice, session?.turns, speechLoadingId, stopPlayback, updateSession]);

  const ask = useCallback(async (messageInput?: string, nextMode: LearningMode = session?.mode ?? 'conversation', sourceVoice?: VoiceMessage): Promise<boolean> => {
    if (!languageId || !session || busy || sendLock.current) return false;
    const message = (messageInput ?? input).trim();
    if (!message) return false;
    if (nextMode === 'study') return false;
    sendLock.current = true;
    const modeTurns = turnsForLearningMode(session.turns, nextMode);
    const history = modeTurns.slice(-8).map((turn) => ({ role: turn.role, content: turn.text }));
    const userTurn = turnFromReply({ reply: '', translation: '', correction: '', pronunciation: '', lesson: '', followUp: '', speechText: '' }, 'user', message, sourceVoice, nextMode);
    if (messageInput === undefined) setInput('');

    // Conversation is a plain-language WebSocket stream. The translation tab
    // keeps the slower structured teaching response by design.
    if (nextMode === 'conversation') {
      const assistantTurn = turnFromReply({ reply: '', translation: '', correction: '', pronunciation: '', lesson: '', followUp: '', speechText: '' }, 'assistant', '', undefined, nextMode);
      const request: GenerateRequest = {
        requestId: createId(), conversationId: createId(), deviceId,
        languageLearning: true,
        messages: [...history, { role: 'user' as const, content: message }].map((item) => ({ ...item, attachments: [] as [] })),
        options: {
          model: selectedModel || 'gpt-5.6-sol', reasoningEffort: 'none', verbosity: 'low',
          instructions: conversationInstructions(languageId, session.level), maxOutputTokens: 256,
          autoTools: false, knowledgeBase: false, webSearch: false, codeInterpreter: false,
        },
      };
      setBusy(true); setStreamingTurnId(assistantTurn.id); setStatus('');
      updateSession(languageId, (current) => ({ ...current, mode: nextMode, turns: [...current.turns, userTurn, assistantTurn] }));
      let streamedText = '';
      const finishLocal = () => { activeGeneration.current = undefined; sendLock.current = false; setStreamingTurnId(undefined); if (mounted.current) setBusy(false); };
      try {
        activeGeneration.current = startGeneration({
          serverUrl, accessToken, request,
          handlers: {
            onStarted: () => { if (mounted.current) setStatus(''); },
            onDelta: (delta) => {
              streamedText += delta;
              updateSession(languageId, (current) => ({ ...current, turns: current.turns.map((turn) => turn.id === assistantTurn.id ? { ...turn, text: streamedText, speechText: streamedText } : turn) }));
            },
            onTextSnapshot: (text) => {
              streamedText = text;
              updateSession(languageId, (current) => ({ ...current, turns: current.turns.map((turn) => turn.id === assistantTurn.id ? { ...turn, text, speechText: text } : turn) }));
            },
            onDone: () => {
              const finalText = streamedText.trim();
              updateSession(languageId, (current) => ({ ...current, turns: finalText ? current.turns.map((turn) => turn.id === assistantTurn.id ? { ...turn, text: finalText, speechText: finalText } : turn) : current.turns.filter((turn) => turn.id !== assistantTurn.id) }));
              finishLocal(); setStatus('');
              if (finalText && session.autoSpeak) void speak({ ...assistantTurn, text: finalText, speechText: finalText });
            },
            onCancelled: () => { updateSession(languageId, (current) => ({ ...current, turns: current.turns.filter((turn) => turn.id !== assistantTurn.id) })); finishLocal(); },
            onError: (error) => { updateSession(languageId, (current) => ({ ...current, turns: current.turns.filter((turn) => turn.id !== assistantTurn.id) })); finishLocal(); if (mounted.current) setStatus(error.message || '教练暂时没有回复，请重试。'); },
          },
        });
        return true;
      } catch (error) {
        updateSession(languageId, (current) => ({ ...current, turns: current.turns.filter((turn) => turn.id !== assistantTurn.id) }));
        finishLocal(); if (mounted.current) setStatus(friendlyNetworkError(error)); return false;
      }
    }

    setBusy(true); setStatus('教练正在准备翻译练习…');
    updateSession(languageId, (current) => ({ ...current, mode: nextMode, turns: [...current.turns, userTurn] }));
    try {
      const result = await translateLanguageLearningMessage(serverUrl, accessToken, { languageId, message, history, level: session.level, mode: nextMode });
      const assistant = turnFromReply(result, 'assistant', result.reply, undefined, nextMode);
      updateSession(languageId, (current) => ({ ...current, turns: [...current.turns, assistant] })); setStatus('');
      if (session.autoSpeak) void speak(assistant);
      return true;
    } catch (error) { updateSession(languageId, (current) => ({ ...current, turns: current.turns.filter((turn) => turn.id !== userTurn.id) })); if (mounted.current) setStatus(friendlyNetworkError(error)); return false; }
    finally { sendLock.current = false; if (mounted.current) setBusy(false); }
  }, [accessToken, busy, deviceId, input, languageId, selectedModel, serverUrl, session, speak, turnsForLearningMode, updateSession]);

  const sendRecordedVoice = useCallback(async (recording: RecordedVoice): Promise<boolean> => {
    if (!languageId || !session || busy || voiceBusy) return false;
    setVoiceBusy(true); setStatus('正在识别你的语音…');
    try {
      const result = await uploadVoice(serverUrl, accessToken, recording, undefined, languageId);
      setStatus('已听懂，教练正在回复…');
      return await ask(result.text, session.mode, result.voice);
    } catch (error) {
      if (mounted.current) setStatus(friendlyNetworkError(error));
      return false;
    } finally {
      if (mounted.current) setVoiceBusy(false);
    }
  }, [accessToken, ask, busy, languageId, serverUrl, session, voiceBusy]);

  const generatePracticeTarget = useCallback(async () => {
    if (!languageId || !session || practiceBusy) return;
    setPracticeBusy(true); setStatus('正在为你挑选一句适合跟读的目标句…');
    try {
      const result = await sendLanguageLearningMessage(serverUrl, accessToken, { languageId, message: '请开始一轮发音训练。只给我一句适合当前程度的日常目标句，并提供中文含义、标准读音提示和一个最重要的发音重点。不要提出问题。', history: [], level: session.level, mode: 'pronunciation' });
      updateSession(languageId, (current) => ({ ...current, mode: 'pronunciation', practiceTarget: turnFromReply(result, 'assistant', result.reply, undefined, 'pronunciation'), lastAssessment: undefined })); setStatus('先听标准发音，再按住按钮完整读一遍。');
    } catch (error) { if (mounted.current) setStatus(friendlyNetworkError(error)); }
    finally { if (mounted.current) setPracticeBusy(false); }
  }, [accessToken, languageId, practiceBusy, serverUrl, session, updateSession]);

  const assessRecording = useCallback(async (recording: RecordedVoice): Promise<boolean> => {
    if (!languageId || !session?.practiceTarget) return false;
    setPracticeBusy(true); setStatus('正在听你的录音并检查发音…');
    try {
      const result = await assessLanguagePronunciationAudio(serverUrl, accessToken, recording, { languageId, targetText: session.practiceTarget.speechText ?? session.practiceTarget.text, level: session.level });
      updateSession(languageId, (current) => ({ ...current, lastAssessment: { ...result, createdAt: Date.now() } })); setStatus('评估完成。看完一个重点后，再录一次会进步最快。'); return true;
    } catch (error) { setStatus(friendlyNetworkError(error)); return false; }
    finally { if (mounted.current) setPracticeBusy(false); }
  }, [accessToken, languageId, serverUrl, session?.level, session?.practiceTarget, updateSession]);

  const chooseLanguage = (id: LearningLanguageId) => { stopPlayback(); setStatus(''); setSelectedLanguageId(id); };
  const leaveLanguage = () => { activeGeneration.current?.dispose(); activeGeneration.current = undefined; setStreamingTurnId(undefined); setBusy(false); stopPlayback(); setStatus(''); setSelectedLanguageId(undefined); };
  const clearCurrent = () => {
    if (!languageId) return;
    Alert.alert('清空本语言记录', `只会清空${languageLabel(languageId)}的学习历史，不影响另一门语言。`, [{ text: '取消', style: 'cancel' }, { text: '清空', style: 'destructive', onPress: () => { updateSession(languageId, (current) => ({ ...emptyLanguageLearningSession(languageId), level: current.level, autoSpeak: current.autoSpeak })); setInput(''); setStatus('已清空当前语言记录。'); } }]);
  };
  const colors = useMemo(() => ({ border: theme.colors.border, surface: theme.colors.surface, muted: theme.colors.surfaceMuted }), [theme.colors.border, theme.colors.surface, theme.colors.surfaceMuted]);

  if (!loaded) return <View style={[styles.loading, { backgroundColor: theme.colors.background }]}><ActivityIndicator color={theme.colors.primary} /><Text style={{ color: theme.colors.textSecondary }}>正在恢复学习记录…</Text></View>;
  if (!languageId || !language || !session) return <KeyboardAwareView style={[styles.root, { backgroundColor: theme.colors.background }]}><ScrollView contentContainerStyle={styles.hubContainer} showsVerticalScrollIndicator={false}>
    <View style={[styles.hubHero, { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.border }]}><View style={[styles.heroIcon, { backgroundColor: theme.colors.primary }]}><Ionicons name="school-outline" size={26} color="#fff" /></View><View style={{ flex: 1 }}><Text style={[styles.heroTitle, { color: theme.colors.text }]}>选择你的学习空间</Text><Text style={[styles.heroBody, { color: theme.colors.textSecondary }]}>粤语和英语各自有独立的历史、目标和发音训练，互不混用。</Text></View></View>
    <Text style={[styles.sectionLabel, { color: theme.colors.text }]}>开始学习</Text><View style={styles.languageCards}>{(config.languages.length ? config.languages : FALLBACK_LANGUAGES).map((item) => { const saved = sessions[item.id]; return <Pressable key={item.id} accessibilityRole="button" onPress={() => chooseLanguage(item.id)} style={({ pressed }) => [styles.languageCard, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && styles.pressed]}><View style={[styles.languageCardIcon, { backgroundColor: item.id === 'cantonese' ? '#EAF2FF' : '#FFF0E5' }]}><Text style={{ fontSize: 26 }}>{item.id === 'cantonese' ? '粵' : 'A'}</Text></View><View style={{ flex: 1, gap: 5 }}><Text style={[styles.languageCardTitle, { color: theme.colors.text }]}>{item.name} · {item.nativeName}</Text><Text style={[styles.languageCardBody, { color: theme.colors.textSecondary }]}>{item.description}</Text><Text style={[styles.languageCardMeta, { color: theme.colors.primary }]}>{saved?.turns.length ? `已学习 ${saved.turns.length} 轮` : '还没有记录，开始第一课'}{saved?.lastAssessment ? ` · 最近发音 ${saved.lastAssessment.score} 分` : ''}</Text></View><Ionicons name="chevron-forward" size={22} color={theme.colors.textTertiary} /></Pressable>; })}</View>{!!status && <Text style={[styles.status, { color: theme.colors.textSecondary }]}>{status}</Text>}
  </ScrollView></KeyboardAwareView>;

  const mode = session.mode; const target = session.practiceTarget; const assessment = session.lastAssessment; const currentLanguage = language;
  const modeTurns = turnsForLearningMode(session.turns, mode);
  return <KeyboardAwareView style={[styles.root, { backgroundColor: theme.colors.background }]}><ScrollView style={styles.scroll} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'web' ? 'none' : 'on-drag'}>
    <View style={styles.topRow}><Pressable accessibilityRole="button" onPress={leaveLanguage} style={styles.backButton}><Ionicons name="chevron-back" size={21} color={theme.colors.primary} /><Text style={{ color: theme.colors.primary, fontWeight: '700' }}>语言空间</Text></Pressable><Pressable accessibilityRole="button" onPress={clearCurrent} style={styles.clearButton}><Ionicons name="trash-outline" size={16} color={theme.colors.textTertiary} /><Text style={{ color: theme.colors.textTertiary, fontSize: 12 }}>清空本语言</Text></Pressable></View>
    <View style={[styles.hero, { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.border }]}><View style={[styles.heroIcon, { backgroundColor: theme.colors.primary }]}><Text style={{ color: '#fff', fontSize: 22, fontWeight: '800' }}>{languageId === 'cantonese' ? '粵' : 'A'}</Text></View><View style={{ flex: 1 }}><Text style={[styles.heroTitle, { color: theme.colors.text }]}>{currentLanguage.name}学习空间</Text><Text style={[styles.heroBody, { color: theme.colors.textSecondary }]}>{currentLanguage.description}</Text></View></View>
    <View style={styles.rowBetween}><View style={styles.levelRow}>{LEVELS.map((item) => <Pressable key={item.value} onPress={() => updateSession(languageId, (current) => ({ ...current, level: item.value }))} style={[styles.levelChip, { backgroundColor: session.level === item.value ? theme.colors.primarySoft : colors.muted, borderColor: session.level === item.value ? theme.colors.primary : 'transparent' }]}><Text style={{ color: session.level === item.value ? theme.colors.primary : theme.colors.textSecondary, fontSize: 11, fontWeight: '800' }}>{item.label}</Text></Pressable>)}</View><View style={styles.speakToggle}><Ionicons name="volume-high-outline" size={17} color={theme.colors.textSecondary} /><Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>自动朗读</Text><Switch value={session.autoSpeak} onValueChange={(value) => updateSession(languageId, (current) => ({ ...current, autoSpeak: value }))} trackColor={{ false: colors.border, true: theme.colors.primarySoft }} thumbColor={session.autoSpeak ? theme.colors.primary : theme.colors.textTertiary} /></View></View>
    <View style={styles.modeTabs}>{(['conversation', 'translate', 'pronunciation', 'study'] as LearningMode[]).map((item) => <Pressable key={item} onPress={() => updateSession(languageId, (current) => ({ ...current, mode: item }))} style={[styles.modeTab, { backgroundColor: mode === item ? theme.colors.primary : colors.surface, borderColor: mode === item ? theme.colors.primary : colors.border }]}><Ionicons name={item === 'conversation' ? 'chatbubble-ellipses-outline' : item === 'translate' ? 'swap-horizontal-outline' : item === 'pronunciation' ? 'mic-outline' : 'library-outline'} size={16} color={mode === item ? '#fff' : theme.colors.textSecondary} /><Text style={{ color: mode === item ? '#fff' : theme.colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{item === 'conversation' ? '互动对话' : item === 'translate' ? '翻译练习' : item === 'pronunciation' ? '发音训练' : '题库复习'}</Text></Pressable>)}</View>
    {mode === 'study' ? <StudyPracticePanel languageId={languageId} state={session.study} primary={theme.colors.primary} primarySoft={theme.colors.primarySoft} text={theme.colors.text} secondary={theme.colors.textSecondary} surface={colors.surface} border={colors.border} onChange={(study) => updateSession(languageId, (current) => ({ ...current, study }))} onSpeak={(card) => { void speak({ id: `study-${card.id}`, role: 'assistant', text: card.prompt, speechText: card.prompt, createdAt: Date.now() }); }} /> : mode === 'pronunciation' ? <View style={styles.practiceArea}>{!target ? <View style={[styles.practiceStart, { backgroundColor: colors.surface, borderColor: colors.border }]}><Ionicons name="mic-circle-outline" size={42} color={theme.colors.primary} /><Text style={[styles.practiceTitle, { color: theme.colors.text }]}>一次只练一句，练到清楚为止</Text><Text style={[styles.practiceBody, { color: theme.colors.textSecondary }]}>教练会先给你一句目标句。你先听标准发音，再按住录音，系统会听你的真实发音并指出一个最值得改的地方。</Text><Pressable disabled={practiceBusy} onPress={() => void generatePracticeTarget()} style={[styles.primaryButton, { backgroundColor: theme.colors.primary }, practiceBusy && styles.disabled]}>{practiceBusy ? <ActivityIndicator color="#fff" /> : <Ionicons name="sparkles-outline" size={18} color="#fff" />}<Text style={styles.primaryButtonText}>生成今日目标句</Text></Pressable></View> : <>
      <View style={[styles.targetCard, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.cardEyebrow, { color: theme.colors.primary }]}>本轮目标</Text><Text selectable style={[styles.targetText, { color: theme.colors.text }]}>{target.text}</Text>{!!target.translation && <Text selectable style={[styles.detail, { color: theme.colors.textSecondary }]}>中文：{target.translation}</Text>}{!!target.pronunciation && <Text selectable style={[styles.detail, { color: theme.colors.textSecondary }]}>标准读法：{target.pronunciation}</Text>}{!!target.lesson && <Text selectable style={[styles.detail, { color: theme.colors.textSecondary }]}>重点：{target.lesson}</Text>}<View style={styles.targetActions}><Pressable disabled={speechLoadingId === target.id} onPress={() => void speak(target, true)} style={[styles.outlineButton, speechLoadingId === target.id && styles.disabled]}><Ionicons name={playingId === target.id ? 'pause' : speechLoadingId === target.id ? 'time-outline' : 'volume-high-outline'} size={17} color={theme.colors.primary} /><Text style={{ color: theme.colors.primary, fontWeight: '800', fontSize: 12 }}>{playingId === target.id ? '暂停标准音' : speechLoadingId === target.id ? '准备中…' : '听标准音'}</Text></Pressable><Pressable onPress={() => void generatePracticeTarget()} disabled={practiceBusy} style={styles.outlineButton}><Ionicons name="refresh-outline" size={17} color={theme.colors.primary} /><Text style={{ color: theme.colors.primary, fontWeight: '800', fontSize: 12 }}>换一句</Text></Pressable></View></View>
      <View style={[styles.recorderCard, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.cardEyebrow, { color: theme.colors.textSecondary }]}>你的录音</Text><VoiceRecorder active={!practiceBusy} disabled={practiceBusy} onRecordStart={() => { stopPlayback(); void Speech.stop(); }} onRecorded={async (recording) => assessRecording(recording)} /></View>
      {!!assessment && <View style={[styles.assessmentCard, { backgroundColor: colors.surface, borderColor: theme.colors.border }]}><View style={styles.scoreRow}><View><Text style={[styles.cardEyebrow, { color: theme.colors.textSecondary }]}>发音评估</Text><Text style={[styles.score, { color: assessment.score >= 85 ? theme.colors.success : assessment.score >= 60 ? theme.colors.warning : theme.colors.danger }]}>{assessment.score}<Text style={{ fontSize: 17 }}> / 100</Text></Text></View><View style={[styles.grade, { backgroundColor: (assessment.score >= 85 ? theme.colors.success : assessment.score >= 60 ? theme.colors.warning : theme.colors.danger) + '18' }]}><Text style={{ color: assessment.score >= 85 ? theme.colors.success : assessment.score >= 60 ? theme.colors.warning : theme.colors.danger, fontWeight: '800' }}>{assessment.level === 'excellent' ? '很清楚' : assessment.level === 'good' ? '继续保持' : '再练一次'}</Text></View></View><Text style={[styles.assessmentSummary, { color: theme.colors.text }]}>{assessment.summary}</Text>{!!assessment.heardText && <Text style={[styles.detail, { color: theme.colors.textSecondary }]}>听到的是：{assessment.heardText}</Text>}{!!assessment.issues && <Text style={[styles.detail, { color: theme.colors.warning }]}>要改的重点：{assessment.issues}</Text>}{!!assessment.standardPronunciation && <Text selectable style={[styles.detail, { color: theme.colors.textSecondary }]}>标准发音：{assessment.standardPronunciation}</Text>}{!!assessment.nextStep && <Text style={[styles.nextStep, { color: theme.colors.primary }]}>下一步：{assessment.nextStep}</Text>}</View>}
    </>}</View> : <>
      <View style={styles.turns}>{modeTurns.length === 0 && <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}><Ionicons name={mode === 'translate' ? 'swap-horizontal-outline' : 'chatbubbles-outline'} size={30} color={theme.colors.primary} /><Text style={[styles.emptyTitle, { color: theme.colors.text }]}>{mode === 'translate' ? '把一句中文变成自然表达' : '像真人一样开始聊天'}</Text><Text style={[styles.emptyBody, { color: theme.colors.textSecondary }]}>{mode === 'translate' ? `输入中文，教练会给出自然${currentLanguage.name}、中文含义和跟读提示。` : `你可以用中文、普通话、方言或${currentLanguage.name}说，教练会直接用自然${currentLanguage.name}接话。`}</Text></View>}{modeTurns.map((turn) => <View key={turn.id} style={[styles.turn, turn.role === 'user' ? styles.userTurn : styles.assistantTurn]}><View style={[styles.bubble, { backgroundColor: turn.role === 'user' ? theme.colors.userBubble : colors.surface, borderColor: turn.role === 'user' ? theme.colors.userBubble : colors.border }]}><Text selectable style={{ color: turn.role === 'user' ? '#fff' : theme.colors.text, fontSize: 16, lineHeight: 24 }}>{turn.text || (turn.id === streamingTurnId ? '正在回复…' : '')}</Text>{turn.id === streamingTurnId && !turn.text && <ActivityIndicator size="small" color={theme.colors.primary} />}{turn.voice?.fileId && <Pressable disabled={speechLoadingId === turn.id} onPress={() => void speak(turn)} style={[styles.audioButton, speechLoadingId === turn.id && styles.disabled]}><Ionicons name={playingId === turn.id ? 'pause-circle' : speechLoadingId === turn.id ? 'time-outline' : 'mic-outline'} size={19} color={turn.role === 'user' ? '#fff' : theme.colors.primary} /><Text style={{ color: turn.role === 'user' ? '#fff' : theme.colors.primary, fontSize: 12, fontWeight: '800' }}>{playingId === turn.id ? '暂停录音' : speechLoadingId === turn.id ? '加载录音…' : '播放我的录音'}</Text></Pressable>}{turn.role === 'assistant' && !!turn.text && <><Pressable disabled={speechLoadingId === turn.id} onPress={() => void speak(turn)} style={[styles.audioButton, speechLoadingId === turn.id && styles.disabled]}><Ionicons name={playingId === turn.id ? 'pause-circle' : speechLoadingId === turn.id ? 'time-outline' : 'volume-high-outline'} size={17} color={theme.colors.primary} /><Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '800' }}>{playingId === turn.id ? '暂停' : speechLoadingId === turn.id ? '准备中…' : '听标准发音'}</Text></Pressable>{!!turn.translation && <Text selectable style={[styles.detail, { color: theme.colors.textSecondary }]}>中文：{turn.translation}</Text>}{!!turn.correction && <Text selectable style={[styles.detail, { color: theme.colors.warning }]}>纠正：{turn.correction}</Text>}{!!turn.pronunciation && <Text selectable style={[styles.detail, { color: theme.colors.textSecondary }]}>读法：{turn.pronunciation}</Text>}{!!turn.lesson && <Text selectable style={[styles.lesson, { color: theme.colors.text }]}>本轮重点：{turn.lesson}</Text>}{!!turn.followUp && <Text selectable style={[styles.followUp, { color: theme.colors.primary }]}>下一步：{turn.followUp}</Text>}</>}</View></View>)}</View>
      {!!status && <Text style={[styles.status, { color: theme.colors.textSecondary }]}>{status}</Text>}
      <View style={[styles.composer, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={styles.voiceComposer}><View style={styles.voiceHint}><Ionicons name="mic-outline" size={17} color={theme.colors.primary} /><Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>按住录音，识别后发给教练</Text></View><View style={styles.voiceRecorder}><VoiceRecorder active={!busy && !voiceBusy} disabled={busy || voiceBusy} transcribeOnly showModeToggle={false} onRecordStart={() => { stopPlayback(); void Speech.stop(); }} onRecorded={async (recording) => sendRecordedVoice(recording)} /></View></View><TextInput value={input} onChangeText={setInput} editable={!busy && !voiceBusy} multiline submitBehavior="submit" returnKeyType="send" enterKeyHint="send" onKeyPress={(event) => { if (Platform.OS !== 'web') return; const value = event as unknown as { key?: string; shiftKey?: boolean; nativeEvent?: { key?: string; shiftKey?: boolean } }; const key = value.key ?? value.nativeEvent?.key; const shiftKey = value.shiftKey ?? value.nativeEvent?.shiftKey; if (key === 'Enter' && !shiftKey) { event.preventDefault(); if (!busy && !voiceBusy) void ask(); } }} onSubmitEditing={() => { if (!busy && !voiceBusy) void ask(); }} placeholder={mode === 'translate' ? `输入要翻译成${currentLanguage.name}的中文句子…` : `用中文或${currentLanguage.name}写一句话…`} placeholderTextColor={theme.colors.textTertiary} style={[styles.input, { color: theme.colors.text }]} /><View style={styles.composerFooter}><Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>{mode === 'translate' ? '会给自然表达、中文含义和跟读提示' : '回车发送 · 真人式实时回复'}</Text><Pressable accessibilityRole="button" onPress={() => void ask()} disabled={busy || voiceBusy || !input.trim()} style={[styles.send, { backgroundColor: theme.colors.primary }, (busy || voiceBusy || !input.trim()) && styles.disabled]}>{busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="arrow-up" size={20} color="#fff" />}</Pressable></View></View>
    </>}
    {!!status && mode === 'pronunciation' && <Text style={[styles.status, { color: theme.colors.textSecondary }]}>{status}</Text>}
  </ScrollView></KeyboardAwareView>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  hubContainer: { padding: 18, paddingBottom: 48, gap: 16, width: '100%', maxWidth: 820, alignSelf: 'center' },
  container: { padding: 16, paddingBottom: 48, gap: 14, width: '100%', maxWidth: 820, alignSelf: 'center' },
  hubHero: { flexDirection: 'row', gap: 13, padding: 17, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  hero: { flexDirection: 'row', gap: 12, padding: 15, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
  heroIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 19, fontWeight: '800' }, heroBody: { marginTop: 5, fontSize: 12, lineHeight: 18 }, sectionLabel: { fontSize: 14, fontWeight: '800' }, languageCards: { gap: 12 },
  languageCard: { minHeight: 130, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 17, flexDirection: 'row', alignItems: 'center', gap: 13 }, languageCardIcon: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, languageCardTitle: { fontSize: 16, fontWeight: '800' }, languageCardBody: { fontSize: 12, lineHeight: 18 }, languageCardMeta: { fontSize: 11, fontWeight: '800' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, backButton: { flexDirection: 'row', alignItems: 'center', gap: 1, paddingVertical: 4 }, clearButton: { flexDirection: 'row', alignItems: 'center', gap: 5, padding: 5 }, rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }, levelRow: { flexDirection: 'row', alignItems: 'center', gap: 7 }, levelChip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, borderWidth: 1 }, speakToggle: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  modeTabs: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' }, modeTab: { flexGrow: 1, flexBasis: '46%', minHeight: 42, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5 }, practiceArea: { gap: 12 }, practiceStart: { minHeight: 300, borderRadius: 19, borderWidth: StyleSheet.hairlineWidth, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 12 }, practiceTitle: { fontSize: 18, fontWeight: '800', textAlign: 'center' }, practiceBody: { fontSize: 13, lineHeight: 21, textAlign: 'center' }, primaryButton: { minHeight: 46, borderRadius: 13, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 7 }, primaryButtonText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  targetCard: { borderRadius: 19, borderWidth: StyleSheet.hairlineWidth, padding: 17, gap: 7 }, recorderCard: { borderRadius: 19, borderWidth: StyleSheet.hairlineWidth, padding: 15, gap: 8 }, cardEyebrow: { fontSize: 12, fontWeight: '800' }, targetText: { fontSize: 22, lineHeight: 32, fontWeight: '800', marginTop: 4 }, targetActions: { flexDirection: 'row', gap: 9, marginTop: 9, flexWrap: 'wrap' }, outlineButton: { minHeight: 38, borderRadius: 11, borderWidth: 1, borderColor: '#386757', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }, assessmentCard: { borderRadius: 19, borderWidth: StyleSheet.hairlineWidth, padding: 17, gap: 8 }, scoreRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, score: { fontSize: 36, fontWeight: '900', marginTop: 3 }, grade: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 11 }, assessmentSummary: { fontSize: 15, lineHeight: 23, fontWeight: '700' },
  turns: { gap: 10, minHeight: 170 }, empty: { padding: 23, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', gap: 8 }, emptyTitle: { fontSize: 16, fontWeight: '800' }, emptyBody: { textAlign: 'center', fontSize: 13, lineHeight: 20 }, turn: { width: '100%' }, userTurn: { alignItems: 'flex-end' }, assistantTurn: { alignItems: 'flex-start' }, bubble: { maxWidth: '94%', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth }, audioButton: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 9 }, detail: { fontSize: 13, lineHeight: 20, marginTop: 7 }, lesson: { fontSize: 13, lineHeight: 20, marginTop: 9 }, status: { fontSize: 12, lineHeight: 18 },
  composer: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 10 }, voiceComposer: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#00000012', paddingBottom: 6, marginBottom: 6 }, voiceHint: { flexDirection: 'row', alignItems: 'center', gap: 5 }, voiceRecorder: { flex: 1, minHeight: 38 }, input: { minHeight: 70, maxHeight: 150, fontSize: 15, lineHeight: 22, textAlignVertical: 'top' }, composerFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, send: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: 0.45 }, pressed: { opacity: 0.72 }, followUp: { fontSize: 13, lineHeight: 20, marginTop: 7 }, nextStep: { fontSize: 13, lineHeight: 20, fontWeight: '800', marginTop: 4 },
});
