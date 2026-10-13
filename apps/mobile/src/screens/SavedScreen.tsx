import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ThemedText as Text } from '../components/ThemedText';
import { useAppTheme } from '../hooks/useAppTheme';
import { useAppStore } from '../store/useAppStore';
import type { AppMessage, Conversation, RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Saved'>;
type SavedItem = { conversation: Conversation; message: AppMessage };

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function preview(message: AppMessage): string {
  const content = message.content.trim().replace(/\s+/g, ' ');
  if (content) return content;
  const images = message.attachments.filter((item) => item.kind === 'image').length;
  const files = message.attachments.length - images;
  return [images ? `${images} 张图片` : '', files ? `${files} 个文件` : ''].filter(Boolean).join('、') || '无文本内容';
}

export function SavedScreen({ navigation }: Props) {
  const theme = useAppTheme();
  const conversations = useAppStore((state) => state.conversations);
  const toggleMessageStarred = useAppStore((state) => state.toggleMessageStarred);
  const items = useMemo<SavedItem[]>(() => conversations
    .flatMap((conversation) => conversation.messages
      .filter((message) => message.role === 'assistant' && message.starred)
      .map((message) => ({ conversation, message })))
    .sort((a, b) => b.message.createdAt - a.message.createdAt), [conversations]);

  const openItem = (item: SavedItem) => {
    useAppStore.getState().setActiveConversation(item.conversation.id);
    navigation.popTo('Chat');
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <View style={[styles.headerIcon, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name="bookmark" size={21} color={theme.colors.primary} />
        </View>
        <View style={styles.headerBody}>
          <Text style={[styles.title, { color: theme.colors.text, fontFamily: theme.fonts.bold }]}>收藏夹</Text>
          <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>把重要回答留在手边，随时回到原对话。</Text>
        </View>
        <View style={[styles.countBadge, { backgroundColor: theme.colors.surfaceMuted }]}>
          <Text style={[styles.count, { color: theme.colors.primary, fontFamily: theme.fonts.bold }]}>{items.length}</Text>
        </View>
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => `${item.conversation.id}:${item.message.id}`}
        contentContainerStyle={[styles.list, !items.length && styles.emptyList]}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`打开收藏：${preview(item.message)}`}
            onPress={() => openItem(item)}
            style={({ pressed }) => [styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }, pressed && styles.pressed]}
          >
            <View style={styles.cardTop}>
              <View style={[styles.sparkIcon, { backgroundColor: theme.colors.primarySoft }]}><Ionicons name="sparkles" size={14} color={theme.colors.primary} /></View>
              <Text numberOfLines={1} style={[styles.conversationTitle, { color: theme.colors.text, fontFamily: theme.fonts.medium }]}>{item.conversation.title}</Text>
              <Text style={[styles.date, { color: theme.colors.textTertiary }]}>{formatDate(item.message.createdAt)}</Text>
            </View>
            <Text selectable numberOfLines={4} style={[styles.preview, { color: theme.colors.text }]}>{preview(item.message)}</Text>
            <View style={styles.cardBottom}>
              <View style={styles.meta}>
                {!!item.message.model && <Text numberOfLines={1} style={[styles.model, { color: theme.colors.textTertiary }]}>{item.message.model}</Text>}
                {!item.message.model && <Text style={[styles.model, { color: theme.colors.textTertiary }]}>Nova 回答</Text>}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="取消收藏"
                hitSlop={10}
                onPress={(event) => { event.stopPropagation(); toggleMessageStarred(item.conversation.id, item.message.id); void Haptics.selectionAsync(); }}
                style={({ pressed }) => [styles.removeButton, pressed && { opacity: 0.6 }]}
              >
                <Ionicons name="bookmark" size={17} color={theme.colors.primary} />
              </Pressable>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.colors.primarySoft }]}><Ionicons name="bookmark-outline" size={30} color={theme.colors.primary} /></View>
            <Text style={[styles.emptyTitle, { color: theme.colors.text, fontFamily: theme.fonts.bold }]}>还没有收藏</Text>
            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>在一条完整的 AI 回复下方点「收藏」，你的灵感、方案和结论会集中显示在这里。</Text>
            <Pressable accessibilityRole="button" onPress={() => navigation.popTo('Chat')} style={({ pressed }) => [styles.emptyButton, { backgroundColor: theme.colors.primary }, pressed && styles.pressed]}>
              <Ionicons name="chatbubble-ellipses-outline" size={16} color="#fff" />
              <Text style={[styles.emptyButtonText, { fontFamily: theme.fonts.bold }]}>开始对话</Text>
            </Pressable>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 12, gap: 11 },
  headerIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  headerBody: { flex: 1, minWidth: 0 },
  title: { fontSize: 21, letterSpacing: -0.3 },
  subtitle: { fontSize: 11, marginTop: 3 },
  countBadge: { minWidth: 32, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  count: { fontSize: 13 },
  list: { padding: 16, paddingTop: 7, gap: 11, paddingBottom: 32 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  card: { borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sparkIcon: { width: 27, height: 27, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  conversationTitle: { flex: 1, minWidth: 0, fontSize: 12 },
  date: { fontSize: 10 },
  preview: { fontSize: 14, lineHeight: 21, marginTop: 11 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  meta: { flex: 1, minWidth: 0 },
  model: { fontSize: 10 },
  removeButton: { width: 32, height: 30, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingHorizontal: 28 },
  emptyIcon: { width: 66, height: 66, borderRadius: 23, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { fontSize: 19 },
  emptyText: { textAlign: 'center', fontSize: 12, lineHeight: 19, marginTop: 8, maxWidth: 330 },
  emptyButton: { height: 42, borderRadius: 12, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 19 },
  emptyButtonText: { color: '#fff', fontSize: 12 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
});
