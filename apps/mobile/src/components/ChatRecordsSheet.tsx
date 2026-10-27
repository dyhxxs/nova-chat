import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { ThemedText as Text, ThemedTextInput as TextInput } from './ThemedText';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../hooks/useAppTheme';
import { chatClock, chatDayLabel, searchChatMessages, type ChatTimelineItem } from '../lib/chatTimeline';

type Props = {
  visible: boolean;
  companionName?: string;
  timeline: readonly ChatTimelineItem[];
  onClose: () => void;
  onJumpMessage: (messageId: string) => void;
  onJumpDay: (dividerKey: string) => void;
};

/** WeChat-style in-chat records sheet: keyword search plus jump-to-day browsing. */
export function ChatRecordsSheet({ visible, companionName, timeline, onClose, onJumpMessage, onJumpDay }: Props) {
  const theme = useAppTheme();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'search' | 'days'>('search');
  const messages = useMemo(() => timeline.flatMap((item) => item.type === 'message' ? [item.message] : []), [timeline]);
  const hits = useMemo(() => mode === 'search' ? searchChatMessages(messages, query) : [], [messages, mode, query]);
  const days = useMemo(() => timeline.filter((item): item is Extract<ChatTimelineItem, { type: 'date' }> => item.type === 'date'), [timeline]);

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: theme.colors.overlay }]}>
        <Pressable style={styles.backdrop} accessibilityLabel="关闭聊天记录" onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: theme.colors.background }]}>
          <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
            <Text style={[styles.title, { color: theme.colors.text }]}>聊天记录</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭聊天记录" onPress={onClose} hitSlop={8} style={styles.closeButton}>
              <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
            </Pressable>
          </View>
          <View style={styles.body}>
            <View style={[styles.search, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <Ionicons name="search" size={17} color={theme.colors.textTertiary} />
              <TextInput
                value={query}
                onChangeText={(value) => { setQuery(value); setMode('search'); }}
                placeholder="搜索聊天内容、附件名称"
                placeholderTextColor={theme.colors.textTertiary}
                style={[styles.searchInput, { color: theme.colors.text }]}
                returnKeyType="search"
                accessibilityLabel="搜索当前对话的聊天记录"
              />
              {!!query && (
                <Pressable accessibilityRole="button" accessibilityLabel="清空搜索" hitSlop={8} onPress={() => setQuery('')}>
                  <Ionicons name="close-circle" size={18} color={theme.colors.textTertiary} />
                </Pressable>
              )}
            </View>
            <View style={styles.tabs}>
              {(['search', 'days'] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: mode === value }}
                  accessibilityLabel={value === 'search' ? '按关键词查找' : '按日期查看'}
                  onPress={() => setMode(value)}
                  style={[styles.tab, mode === value ? { backgroundColor: theme.colors.primarySoft } : { backgroundColor: theme.colors.surface }]}
                >
                  <Ionicons name={value === 'search' ? 'search' : 'calendar-outline'} size={13} color={mode === value ? theme.colors.primary : theme.colors.textSecondary} />
                  <Text style={{ color: mode === value ? theme.colors.primary : theme.colors.textSecondary, fontSize: 12, fontWeight: '700' }}>{value === 'search' ? '查找内容' : '按日期查看'}</Text>
                </Pressable>
              ))}
            </View>
            {mode === 'search' ? (
              <FlatList
                keyboardShouldPersistTaps="handled"
                data={hits}
                keyExtractor={(hit) => hit.message.id}
                contentContainerStyle={hits.length ? styles.list : styles.emptyList}
                ListEmptyComponent={(
                  <View style={styles.empty}>
                    <Ionicons name={query.trim() ? 'search-outline' : 'chatbubbles-outline'} size={26} color={theme.colors.textTertiary} />
                    <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>{query.trim() ? '没有找到相关内容，换个关键词试试。' : '输入关键词查找这段对话里的消息，点击结果跳到原消息。'}</Text>
                  </View>
                )}
                renderItem={({ item }) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`跳转到匹配消息：${item.snippet}`}
                    onPress={() => onJumpMessage(item.message.id)}
                    style={({ pressed }) => [styles.hitRow, { borderBottomColor: theme.colors.border }, pressed && styles.pressed]}
                  >
                    <View style={styles.hitMain}>
                      <View style={styles.hitLine}>
                        <Text numberOfLines={2} style={[styles.snippet, { color: theme.colors.text }]}>
                          {highlight(item.snippet, item.match, theme.colors.primary)}
                        </Text>
                      </View>
                      <Text style={[styles.hitMeta, { color: theme.colors.textTertiary }]}>
                        {item.message.role === 'user' ? '我' : (companionName || 'Nova')} · {chatDayLabel(item.message.createdAt)} {chatClock(item.message.createdAt)}
                        {item.message.attachments.length ? ` · ${item.message.attachments.length} 个附件` : ''}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
                  </Pressable>
                )}
              />
            ) : (
              <FlatList
                keyboardShouldPersistTaps="handled"
                data={[...days].reverse()}
                keyExtractor={(item) => item.key}
                contentContainerStyle={days.length ? styles.list : styles.emptyList}
                ListEmptyComponent={(
                  <View style={styles.empty}>
                    <Ionicons name="calendar-outline" size={26} color={theme.colors.textTertiary} />
                    <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>这段对话还没有消息。</Text>
                  </View>
                )}
                renderItem={({ item }) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`跳转到${item.label}，共${item.messageCount}条消息`}
                    onPress={() => onJumpDay(item.key)}
                    style={({ pressed }) => [styles.dayRow, { borderBottomColor: theme.colors.border }, pressed && styles.pressed]}
                  >
                    <Ionicons name="calendar-outline" size={18} color={theme.colors.primary} />
                    <Text style={[styles.dayLabel, { color: theme.colors.text }]}>{item.label}</Text>
                    <Text style={[styles.dayCount, { color: theme.colors.textTertiary }]}>{item.messageCount} 条消息</Text>
                    <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
                  </Pressable>
                )}
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function highlight(snippet: string, match: string, color: string) {
  const at = snippet.toLocaleLowerCase().indexOf(match.toLocaleLowerCase());
  if (!match || at < 0) return snippet;
  return (
    <>
      {snippet.slice(0, at)}
      <Text style={{ color, fontWeight: '800' }}>{snippet.slice(at, at + match.length)}</Text>
      {snippet.slice(at + match.length)}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1 },
  sheet: { maxHeight: '88%', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 18 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 13 },
  title: { fontSize: 16, fontWeight: '800' },
  closeButton: { position: 'absolute', right: 12, top: 8, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 14, paddingTop: 12 },
  search: { height: 44, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 15, marginLeft: 7, height: 42 },
  tabs: { flexDirection: 'row', gap: 8, marginTop: 10 },
  tab: { flex: 1, minHeight: 36, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  list: { paddingBottom: 16, marginTop: 4 },
  emptyList: { flexGrow: 1 },
  empty: { flex: 1, minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 28 },
  emptyText: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
  hitRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  hitMain: { flex: 1, gap: 5 },
  hitLine: { flexDirection: 'row' },
  snippet: { flex: 1, fontSize: 14, lineHeight: 20 },
  hitMeta: { fontSize: 11 },
  dayRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  dayLabel: { flex: 1, fontSize: 15, fontWeight: '700' },
  dayCount: { fontSize: 12 },
  pressed: { opacity: 0.72 },
});
