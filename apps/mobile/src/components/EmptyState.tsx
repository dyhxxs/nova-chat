import type { ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ThemedText as Text } from './ThemedText';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../hooks/useAppTheme';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type Props = {
  onSuggestion: (prompt: string) => void;
  onTakePhoto: () => void;
};

const suggestions: { icon: IoniconName; title: string; prompt: string }[] = [
  { icon: 'git-network-outline', title: '帮我梳理一个复杂问题', prompt: '请帮我把这个复杂问题拆解清楚，指出关键矛盾，并给出可执行的下一步：' },
  { icon: 'color-wand-outline', title: '帮我写作或润色内容', prompt: '请帮我完成或润色下面的内容，保持自然、清晰，并说明主要修改：' },
  { icon: 'code-slash-outline', title: '分析代码并给出修复方案', prompt: '请分析这个代码问题，解释根因并给出可以直接落地的完整修复方案：' },
];

export function EmptyState({ onSuggestion, onTakePhoto }: Props) {
  const theme = useAppTheme();
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
      alwaysBounceVertical={false}
    >
      <LinearGradient
        colors={theme.dark ? ['#8177FF', '#4A42B6'] : ['#847AFF', '#5D54D8']}
        style={styles.logo}
      >
        <Ionicons name="sparkles" size={24} color="#FFFFFF" />
      </LinearGradient>
      <Text style={[styles.eyebrow, { color: theme.colors.primary, fontFamily: theme.fonts.bold }]}>NOVA</Text>
      <Text style={[styles.title, { color: theme.colors.text, fontFamily: theme.fonts.bold }]}>今天想聊点什么？</Text>
      <Text style={[styles.subtitle, { color: theme.colors.textSecondary, fontFamily: theme.fonts.regular }]}>可以直接提问，也可以拍照、选择图片或添加设备中的文件。</Text>

      <View style={styles.suggestions}>
        {suggestions.map((item) => (
          <Pressable
            key={item.title}
            accessibilityRole="button"
            onPress={() => onSuggestion(item.prompt)}
            style={({ pressed }) => [
              styles.suggestion,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.suggestionIcon, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name={item.icon} size={18} color={theme.colors.primary} />
            </View>
            <Text style={[styles.suggestionText, { color: theme.colors.text, fontFamily: theme.fonts.medium }]}>{item.title}</Text>
            <Ionicons name="arrow-forward" size={16} color={theme.colors.textTertiary} />
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          onPress={onTakePhoto}
          style={({ pressed }) => [
            styles.suggestion,
            styles.photoSuggestion,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            pressed && styles.pressed,
          ]}
        >
          <View style={[styles.suggestionIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="camera-outline" size={19} color={theme.colors.primary} />
          </View>
          <Text style={[styles.suggestionText, { color: theme.colors.text, fontFamily: theme.fonts.medium }]}>拍照提问或识别内容</Text>
          <Ionicons name="camera" size={16} color={theme.colors.textTertiary} />
        </Pressable>
      </View>

      <View style={styles.privateNote}>
        <Ionicons name="shield-checkmark-outline" size={14} color={theme.colors.textTertiary} />
        <Text style={[styles.privateText, { color: theme.colors.textTertiary, fontFamily: theme.fonts.regular }]}>通过你的私有网关连接，模型密钥不保存在 App 中</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, width: '100%' },
  container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 22 },
  logo: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  eyebrow: { fontSize: 10, fontWeight: '900', letterSpacing: 2.4, marginBottom: 5 },
  title: { fontSize: 25, lineHeight: 32, fontWeight: '800', letterSpacing: -0.45 },
  subtitle: { fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 7, maxWidth: 320 },
  suggestions: { width: '100%', maxWidth: 520, gap: 9, marginTop: 24 },
  suggestion: { minHeight: 54, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' },
  photoSuggestion: { marginHorizontal: 15 },
  suggestionIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  suggestionText: { flex: 1, fontSize: 14, fontWeight: '600' },
  privateNote: { maxWidth: 320, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 18 },
  privateText: { flexShrink: 1, fontSize: 10, lineHeight: 14, textAlign: 'center' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
});
