import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../hooks/useAppTheme';

const suggestions = [
  { icon: 'bulb-outline' as const, title: '帮我梳理思路', prompt: '请帮我把这个问题拆解成清晰、可执行的步骤：' },
  { icon: 'create-outline' as const, title: '润色一段文字', prompt: '请帮我润色下面这段文字，保持原意并让表达更自然：' },
  { icon: 'code-slash-outline' as const, title: '解决代码问题', prompt: '请分析这个代码问题，解释原因并给出完整修复方案：' },
  { icon: 'language-outline' as const, title: '学习新知识', prompt: '请用循序渐进、包含例子的方式教我：' },
];

export function EmptyState({ onSuggestion }: { onSuggestion: (prompt: string) => void }) {
  const theme = useAppTheme();
  return (
    <View style={styles.container}>
      <LinearGradient colors={theme.dark ? ['#38326F', '#211F42'] : ['#E9E7FF', '#F7F6FF']} style={styles.logo}>
        <Ionicons name="sparkles" size={31} color={theme.colors.primary} />
      </LinearGradient>
      <Text style={[styles.title, { color: theme.colors.text }]}>有什么可以帮你？</Text>
      <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>由你的私有模型网关提供服务，密钥不会保存在手机应用里。</Text>
      <View style={styles.grid}>
        {suggestions.map((item) => (
          <Pressable key={item.title} onPress={() => onSuggestion(item.prompt)} style={({ pressed }) => [styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }, pressed && { opacity: 0.7 }]}>
            <Ionicons name={item.icon} size={21} color={theme.colors.primary} />
            <Text style={[styles.cardText, { color: theme.colors.text }]}>{item.title}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, paddingBottom: 30 },
  logo: { width: 66, height: 66, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, textAlign: 'center', lineHeight: 21, marginTop: 8, maxWidth: 330 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 28, width: '100%', maxWidth: 520 },
  card: { width: '48%', minHeight: 88, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 14, justifyContent: 'space-between' },
  cardText: { fontSize: 14, fontWeight: '600', marginTop: 12 },
});
