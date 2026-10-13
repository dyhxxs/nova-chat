import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ThemedText as Text } from './ThemedText';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../hooks/useAppTheme';

type Props = { onSuggestion: (prompt: string) => void; onTakePhoto: () => void };
const suggestions = [
  { icon: 'create-outline' as const, title: '写点东西', subtitle: '整理思路，让表达更清楚', prompt: '帮我润色这段文字，保留我的语气：' },
  { icon: 'calendar-outline' as const, title: '安排下一步', subtitle: '把复杂的事拆成小步骤', prompt: '帮我把这个目标拆成今天就能开始的步骤：' },
  { icon: 'bulb-outline' as const, title: '一起想办法', subtitle: '多一个角度看问题', prompt: '我遇到了一个问题，帮我一起想想：' },
];
export function EmptyState({ onSuggestion, onTakePhoto }: Props) {
  const theme = useAppTheme();
  return <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={styles.intro}><View style={[styles.mark, { backgroundColor: theme.colors.primarySoft }]}><Ionicons name="chatbubbles-outline" size={26} color={theme.colors.primary} /></View><Text style={[styles.title, { color: theme.colors.text }]}>让想法慢慢成形。</Text><Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>一个问题、一段文字，或者今天的新想法。</Text></View>
    <Text style={[styles.label, { color: theme.colors.textTertiary }]}>从这里开始</Text>
    <View style={[styles.list, { backgroundColor: theme.colors.surface }]}>{suggestions.map((s, index) => <Pressable key={s.title} onPress={() => onSuggestion(s.prompt)} style={({ pressed }) => [styles.row, { borderColor: theme.colors.border, borderBottomWidth: index < suggestions.length - 1 ? StyleSheet.hairlineWidth : 0, opacity: pressed ? 0.6 : 1 }]}><Ionicons name={s.icon} size={22} color={theme.colors.primary} /><View style={{ flex: 1, gap: 5 }}><Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '500' }}>{s.title}</Text><Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{s.subtitle}</Text></View><Ionicons name="arrow-forward" size={18} color={theme.colors.textTertiary} /></Pressable>)}</View>
    <Pressable onPress={onTakePhoto} style={[styles.photo, { borderColor: theme.colors.border }]}><Ionicons name="camera-outline" size={21} color={theme.colors.textSecondary} /><Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>拍张照片，聊聊你看到的</Text></Pressable>
  </ScrollView>;
}
const styles = StyleSheet.create({ content: { flexGrow: 1, width: '100%', maxWidth: 600, alignSelf: 'center', padding: 24, paddingTop: 36, paddingBottom: 28 }, intro: { gap: 14, marginBottom: 34 }, mark: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 6 }, title: { fontSize: 30, fontWeight: '600', lineHeight: 42, letterSpacing: -0.5 }, subtitle: { fontSize: 14, lineHeight: 23 }, label: { fontSize: 12, marginBottom: 12 }, list: { borderRadius: 18, overflow: 'hidden' }, row: { minHeight: 82, paddingHorizontal: 18, paddingVertical: 17, flexDirection: 'row', alignItems: 'center', gap: 16 }, photo: { marginTop: 16, minHeight: 56, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, gap: 12 } });
