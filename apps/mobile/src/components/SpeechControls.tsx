import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText as Text } from './ThemedText';
import { useAppTheme } from '../hooks/useAppTheme';
import { prepareSpeechText } from '../lib/speechText';
import type { SpeechSource } from '../lib/speechSource';
import type { SpeechLanguage, SpeechRate, SpeechState } from '../lib/speechController';

type Props = { selected?: SpeechSource; state: SpeechState; onClose: () => void; onPlay: (rate: SpeechRate, language: SpeechLanguage) => void; onStop: () => void };
const speeds: { value: SpeechRate; label: string }[] = [{ value: 0.8, label: '慢速 0.8×' }, { value: 1, label: '正常 1×' }, { value: 1.2, label: '快速 1.2×' }];
const languages: { value: SpeechLanguage; label: string }[] = [{ value: 'auto', label: '自动' }, { value: 'zh-CN', label: '中文' }, { value: 'en-US', label: 'English' }];
export function SpeechControls({ selected, state, onClose, onPlay, onStop }: Props) {
  const theme = useAppTheme();
  const [rate, setRate] = useState<SpeechRate>(1);
  const [language, setLanguage] = useState<SpeechLanguage>('auto');
  useEffect(() => { if (selected) { setRate(1); setLanguage('auto'); } }, [selected]);
  const preview = useMemo(() => {
    if (!selected) return undefined;
    try { return { text: prepareSpeechText(selected.content).text }; }
    catch (error) { return { error: error instanceof Error ? error.message : '无法准备朗读正文。' }; }
  }, [selected]);
  return <>
    {state.phase !== 'idle' && <View style={[styles.bar, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]}>
      <Ionicons name={state.phase === 'error' ? 'alert-circle-outline' : 'volume-high-outline'} size={20} color={state.phase === 'error' ? theme.colors.danger : theme.colors.primary} />
      <View style={styles.flex}>
        <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.text, fontFamily: theme.fonts.medium }}>{state.phase === 'error' ? '朗读提示' : state.phase === 'preparing' ? '准备朗读…' : '正在朗读回复'}</Text>
        <Text style={[styles.small, { color: theme.colors.textSecondary }]}>{state.error ?? `第 ${state.chunk || 1} / ${state.total || '—'} 段 · 离开聊天会停止`}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={state.phase === 'error' ? '关闭朗读提示' : '停止朗读'} onPress={onStop} style={styles.button}>
        <Ionicons name={state.phase === 'error' ? 'close' : 'stop-circle-outline'} size={26} color={theme.colors.primary} />
      </Pressable>
    </View>}
    <Modal visible={!!selected} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.colors.background }]} edges={['top', 'bottom']}>
        <View style={[styles.header, { borderColor: theme.colors.border }]}>
          <Text style={[styles.title, styles.flex, { color: theme.colors.text }]}>朗读回复</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭朗读设置" onPress={onClose} style={styles.button}><Ionicons name="close" size={25} color={theme.colors.text} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.body, { color: theme.colors.textSecondary }]}>仅在你点击“开始朗读”后，把本条回复文字交给设备或浏览器配置的语音服务。该服务可能联网，不保证离线；请勿朗读敏感内容。Nova不会为朗读调用模型，不使用麦克风。</Text>
          <Text style={[styles.label, { color: theme.colors.text }]}>语速</Text>
          <View style={styles.options}>{speeds.map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: rate === option.value }} onPress={() => setRate(option.value)} style={[styles.option, { backgroundColor: rate === option.value ? theme.colors.primarySoft : theme.colors.surfaceMuted, borderColor: rate === option.value ? theme.colors.primary : theme.colors.border }]}><Text style={{ color: theme.colors.text }}>{option.label}</Text></Pressable>)}</View>
          <Text style={[styles.label, { color: theme.colors.text }]}>朗读语言</Text>
          <View style={styles.options}>{languages.map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: language === option.value }} onPress={() => setLanguage(option.value)} style={[styles.option, { backgroundColor: language === option.value ? theme.colors.primarySoft : theme.colors.surfaceMuted, borderColor: language === option.value ? theme.colors.primary : theme.colors.border }]}><Text style={{ color: theme.colors.text }}>{option.label}</Text></Pressable>)}</View>
          <Text style={[styles.small, { color: theme.colors.textSecondary }]}>自动：含中文时优先中文，否则使用系统默认语言。需要系统已安装对应声音；实际音色、速度及联网行为由语音服务决定。</Text>
          <Text style={[styles.label, { color: theme.colors.text }]}>正文预览</Text>
          <Text selectable style={[styles.preview, styles.body, { color: preview?.error ? theme.colors.danger : theme.colors.text, backgroundColor: theme.colors.surfaceMuted }]}>{preview?.error ?? `${preview?.text?.slice(0, 600) ?? ''}${(preview?.text?.length ?? 0) > 600 ? '\n…（此处仅预览，播放时按段朗读全文）' : ''}`}</Text>
          <Text style={[styles.small, { color: theme.colors.textSecondary }]}>省略常见代码块、图片、引用编号和链接地址，简化Markdown；不等于自动脱敏或完整排版还原。每次最多3万字符。不自动播放，不支持后台朗读或暂停续播。</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="同意语音服务处理并开始朗读" accessibilityState={{ disabled: !preview?.text }} disabled={!preview?.text} onPress={() => onPlay(rate, language)} style={[styles.start, { backgroundColor: theme.colors.primary, opacity: preview?.text ? 1 : 0.45 }]}><Text style={{ color: '#FFFFFF', fontFamily: theme.fonts.bold }}>开始朗读</Text></Pressable>
          <Text style={[styles.small, { color: theme.colors.textTertiary }]}>没有声音时，请检查媒体音量和系统文字转语音设置；iPhone还需关闭静音模式。</Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, flex: { flex: 1, minWidth: 0 }, header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth }, title: { fontSize: 21, fontWeight: '700' }, content: { padding: 20, gap: 14, paddingBottom: 32 }, body: { fontSize: 14, lineHeight: 23 }, label: { fontSize: 16, fontWeight: '600', marginTop: 4 }, small: { fontSize: 12, lineHeight: 19 }, options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, option: { minHeight: 44, paddingHorizontal: 15, paddingVertical: 12, borderRadius: 12, borderWidth: 1 }, preview: { padding: 14, borderRadius: 12 }, start: { minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 14, marginTop: 4 }, bar: { paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 10 }, button: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
