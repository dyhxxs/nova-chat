import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { ThemedText as Text } from './ThemedText';
import { useAppTheme } from '../hooks/useAppTheme';
import { DEFAULT_VOICE_PREFERENCES, type VoicePreferences } from '../lib/voice';
import { getVoiceConfig, type VoiceConfig } from '../services/voiceClient';
export function VoicePreferencesPanel({ preferences = DEFAULT_VOICE_PREFERENCES, serverUrl, accessToken, onChange }: { preferences?: VoicePreferences; serverUrl: string; accessToken: string; onChange: (preferences: VoicePreferences) => void }) {
  const theme = useAppTheme(); const [config, setConfig] = useState<VoiceConfig>(), [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController(); setConfig(undefined); setError(''); getVoiceConfig(serverUrl, accessToken, controller.signal).then(value => { if (!controller.signal.aborted) setConfig(value); }).catch(() => { if (!controller.signal.aborted) setError('暂时无法读取音色，请检查网关是否已升级。'); }); return () => controller.abort(); }, [serverUrl, accessToken]);
  const selectedId = config?.voices.find(voice => voice.id === preferences.voiceId || voice.aliases?.includes(preferences.voiceId))?.id;
  return <View style={{ gap: 10, marginTop: 14 }}>
    <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>TA 的回复方式</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(['auto','voice','text'] as const).map((mode, index) => <Pressable key={mode} accessibilityRole="button" accessibilityState={{ selected: preferences.replyMode === mode }} onPress={() => onChange({ ...preferences, replyMode: mode })} style={{ padding: 10, borderRadius: 12, backgroundColor: preferences.replyMode === mode ? theme.colors.primarySoft : theme.colors.surfaceMuted }}><Text style={{ color: theme.colors.text, fontSize: 12 }}>{['跟随我发语音','始终语音','文字回复'][index]}</Text></Pressable>)}</View>
    <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>语音回复可点按播放，也可以展开查看文字。</Text>
    {!config && <Text style={{ color: theme.colors.textTertiary, fontSize: 12 }}>{error || '正在加载音色…'}</Text>}
    {config && !config.enabled && <Text style={{ color: theme.colors.danger, fontSize: 12 }}>语音服务还没有配置，请联系管理员。</Text>}
    {config?.enabled && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{config.voices.map(voice => <Pressable key={voice.id} accessibilityRole="button" accessibilityState={{ selected: voice.id === selectedId }} onPress={() => onChange({ ...preferences, voiceId: voice.id })} style={{ padding: 10, borderRadius: 12, borderWidth: 1, borderColor: voice.id === selectedId ? theme.colors.primary : theme.colors.border }}><Text style={{ color: theme.colors.text, fontSize: 12 }}>{voice.name}</Text></Pressable>)}</View>}
  </View>;
}
