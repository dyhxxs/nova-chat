import { ActivityIndicator, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText as Text } from './ThemedText';
import { useAppTheme } from '../hooks/useAppTheme';
import type { AppMessage } from '../types';

export type VoiceBubbleControls = {
  onPlayVoice?: () => void;
  onRetryVoice?: () => void;
  voicePlaying?: boolean;
};

type VoiceTranscriptProps = {
  message: AppMessage;
  expanded: boolean;
  onToggle: () => void;
  mine: boolean;
};

/** The audio part of a voice message. The transcript is rendered separately below it. */
export function VoiceMessageBubble({ message, onPlayVoice, onRetryVoice, voicePlaying }: VoiceBubbleControls & { message: AppMessage }) {
  const theme = useAppTheme();
  const voice = message.voice!;
  const mine = message.role === 'user';
  const color = mine ? '#FFFFFF' : theme.colors.text;
  const seconds = Math.max(1, Math.round(voice.durationMs / 1000));
  if (voice.status === 'pending' && !mine) return null;

  return (
    <View style={{ gap: 8 }}>
      <Pressable
        disabled={voice.status !== 'ready' && !voice.localRecording}
        onPress={onPlayVoice}
        accessibilityRole="button"
        accessibilityLabel={voicePlaying ? '暂停语音' : '播放 ' + seconds + ' 秒语音'}
        style={{ minWidth: 110, width: Math.min(240, 110 + seconds * 2), minHeight: 42, justifyContent: 'center', gap: 6 }}
      >
        <View style={{ flexDirection: mine ? 'row-reverse' : 'row', alignItems: 'center', gap: 14 }}>
          <Ionicons name={voicePlaying ? 'pause' : 'volume-medium'} size={25} color={color} />
          <Text style={{ color, fontSize: 16, fontWeight: '600' }}>{voice.status === 'error' && !mine ? '语音未生成' : seconds + '″'}</Text>
          {mine && voice.status === 'pending' && <ActivityIndicator size="small" color={color} accessibilityLabel="语音发送中" />}
          {voicePlaying && <View style={{ flexDirection: 'row', gap: 3, alignItems: 'center', height: 23 }}>{[9, 18, 13, 22, 11].map((height, index) => <View key={index} style={{ width: 3, height, borderRadius: 2, backgroundColor: color, opacity: 0.8 }} />)}</View>}
        </View>
      </Pressable>
      {voice.status === 'error' && <Pressable accessibilityRole="button" accessibilityLabel={mine ? "重试发送语音" : "重试生成语音"} onPress={onRetryVoice} style={{ minHeight: 36, justifyContent: 'center' }}><Text style={{ color: mine ? '#FFFFFF' : theme.colors.primary, fontSize: 12 }}>{voice.error || (mine ? '语音发送失败' : '语音生成失败')} · 点按重试</Text></Pressable>}
    </View>
  );
}

/**
 * WeChat-style transcript: the conversion action sits under the audio bubble,
 * and the converted text gets its own bubble below the audio message.
 */
export function VoiceTranscript({ message, expanded, onToggle, mine }: VoiceTranscriptProps) {
  const theme = useAppTheme();
  const content = message.content.trim();
  if (!content && message.voice?.status === 'ready') return null;

  const textColor = mine ? '#FFFFFF' : theme.colors.text;
  const actionColor = theme.colors.textSecondary;
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', width: '100%', marginTop: 4 }}>
      {!expanded && <Pressable accessibilityRole="button" accessibilityLabel="语音转文字" onPress={onToggle} hitSlop={6} style={{ minHeight: 28, justifyContent: 'center', paddingHorizontal: 4 }}>
        <Text style={{ color: actionColor, fontSize: 12 }}>转文字</Text>
      </Pressable>}
      {expanded && !!content && <View style={{ maxWidth: '94%', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 15, borderTopLeftRadius: mine ? 15 : 4, borderTopRightRadius: mine ? 4 : 15, backgroundColor: mine ? theme.colors.userBubble : theme.colors.surface }}>
        <Text selectable style={{ color: textColor, fontSize: 16, lineHeight: 24 }}>{content}</Text>
      </View>}
      {expanded && <Pressable accessibilityRole="button" accessibilityLabel="收起语音文字" onPress={onToggle} hitSlop={6} style={{ minHeight: 28, justifyContent: 'center', paddingHorizontal: 4 }}>
        <Text style={{ color: actionColor, fontSize: 12 }}>收起文字</Text>
      </Pressable>}
    </View>
  );
}
