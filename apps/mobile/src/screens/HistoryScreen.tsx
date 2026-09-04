import { useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { ThemedTextInput as TextInput } from '../components/ThemedText';
import { ThemedText as Text } from '../components/ThemedText';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { KeyboardAwareView } from '../components/KeyboardAwareView';
import { useAppTheme } from '../hooks/useAppTheme';
import { useAppStore } from '../store/useAppStore';
import type { Conversation, RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'History'>;

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  const options: Intl.DateTimeFormatOptions = date.getFullYear() === now.getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' };
  return date.toLocaleDateString('zh-CN', options);
}

function conversationPreview(conversation: Conversation): string {
  const latest = [...conversation.messages].reverse().find((message) => message.content.trim() || message.attachments.length);
  if (!latest) return '还没有消息';
  if (latest.content.trim()) return latest.content.replace(/\s+/g, ' ').trim();
  const imageCount = latest.attachments.filter((attachment) => attachment.kind === 'image').length;
  const documentCount = latest.attachments.length - imageCount;
  return [imageCount ? `${imageCount} 张图片` : '', documentCount ? `${documentCount} 个文件` : ''].filter(Boolean).join('、');
}

export function HistoryScreen({ navigation }: Props) {
  const theme = useAppTheme();
  const [query, setQuery] = useState('');
  const [menuConversationId, setMenuConversationId] = useState<string>();
  const [renameConversationId, setRenameConversationId] = useState<string>();
  const [renameValue, setRenameValue] = useState('');
  const conversations = useAppStore((state) => state.conversations);
  const activeId = useAppStore((state) => state.activeConversationId);
  const setActive = useAppStore((state) => state.setActiveConversation);
  const remove = useAppStore((state) => state.deleteConversation);
  const createNew = useAppStore((state) => state.newConversation);
  const rename = useAppStore((state) => state.renameConversation);

  const filtered = useMemo(() => {
    const needle = query.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((conversation) => {
      const haystack = [
        conversation.title,
        ...conversation.messages.map((message) => message.content),
      ].join('\n').toLowerCase();
      return haystack.includes(needle);
    });
  }, [conversations, query]);

  const menuConversation = conversations.find((conversation) => conversation.id === menuConversationId);
  const renameConversation = conversations.find((conversation) => conversation.id === renameConversationId);
  const runningCount = conversations.filter((conversation) => conversation.messages.some((message) => message.status === 'streaming')).length;

  const openConversationMenu = (event: GestureResponderEvent, id: string) => {
    event.stopPropagation();
    setMenuConversationId(id);
  };

  const keepActionSheetOpen = (event: GestureResponderEvent) => {
    event.stopPropagation();
  };

  const choose = (id: string) => {
    setActive(id);
    navigation.navigate('Chat');
  };

  const confirmDelete = (conversation: Conversation) => {
    setMenuConversationId(undefined);
    Alert.alert(
      '删除对话？',
      `“${conversation.title}”将从本机永久删除。`,
      [
        { text: '取消', style: 'cancel' },
        { text: '删除', style: 'destructive', onPress: () => remove(conversation.id) },
      ],
    );
  };

  const openRename = (conversation: Conversation) => {
    setMenuConversationId(undefined);
    setRenameConversationId(conversation.id);
    setRenameValue(conversation.title);
  };

  const saveRename = () => {
    if (!renameConversationId) return;
    if (!rename(renameConversationId, renameValue)) {
      Alert.alert('标题不能为空', '请输入一个有效的对话标题。');
      return;
    }
    setRenameConversationId(undefined);
    setRenameValue('');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <KeyboardAwareView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.search, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <Ionicons name="search" size={18} color={theme.colors.textTertiary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="搜索标题和消息内容"
          placeholderTextColor={theme.colors.textTertiary}
          style={[styles.searchInput, { color: theme.colors.text }]}
          returnKeyType="search"
          accessibilityLabel="搜索对话"
        />
        {!!query && (
          <Pressable accessibilityRole="button" accessibilityLabel="清空搜索" hitSlop={8} onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={19} color={theme.colors.textTertiary} />
          </Pressable>
        )}
      </View>

      <View style={styles.summaryRow}>
        <View>
          <Text style={[styles.summaryTitle, { color: theme.colors.text }]}>{query.trim() ? `${filtered.length} 个结果` : `${conversations.length} 个对话`}</Text>
          <Text style={[styles.summarySubtitle, { color: theme.colors.textTertiary }]}>{runningCount ? `${runningCount} 个回答仍在后台生成` : '对话只保存在当前设备'}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="新建对话"
          onPress={() => { createNew(); navigation.navigate('Chat'); void Haptics.selectionAsync(); }}
          style={({ pressed }) => [styles.newButton, { backgroundColor: theme.colors.primary }, pressed && styles.pressed]}
        >
          <Ionicons name="add" size={19} color="#FFFFFF" />
          <Text style={styles.newText}>新对话</Text>
        </Pressable>
      </View>

      <FlatList
        keyboardShouldPersistTaps="handled"
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, filtered.length === 0 && styles.emptyList]}
        ListEmptyComponent={(
          <View style={styles.emptyState}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.colors.surfaceMuted }]}>
              <Ionicons name="chatbubbles-outline" size={25} color={theme.colors.textTertiary} />
            </View>
            <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>没有找到相关对话</Text>
            <Text style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}>换个关键词试试，搜索会同时匹配消息正文。</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const isActive = item.id === activeId;
          const streaming = item.messages.some((message) => message.status === 'streaming');
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`打开对话 ${item.title}`}
              onPress={() => choose(item.id)}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: isActive ? theme.colors.primarySoft : theme.colors.surface,
                  borderColor: isActive ? theme.colors.primary : theme.colors.border,
                },
                pressed && styles.pressed,
              ]}
            >
              <View style={[styles.rowIcon, { backgroundColor: isActive ? theme.colors.surfaceElevated : theme.colors.surfaceMuted }]}>
                <Ionicons name={streaming ? 'sparkles' : 'chatbubble-outline'} size={18} color={isActive || streaming ? theme.colors.primary : theme.colors.textSecondary} />
              </View>
              <View style={styles.rowBody}>
                <View style={styles.titleLine}>
                  <Text numberOfLines={1} style={[styles.title, { color: theme.colors.text }]}>{item.title}</Text>
                  {isActive && <Text style={[styles.activeBadge, { color: theme.colors.primary, backgroundColor: theme.colors.surfaceElevated }]}>当前</Text>}
                </View>
                <Text numberOfLines={2} style={[styles.preview, { color: theme.colors.textSecondary }]}>{conversationPreview(item)}</Text>
                <View style={styles.rowStats}>
                  <Text style={[styles.statText, { color: theme.colors.textTertiary }]}>{item.messages.length} 条消息</Text>
                  {streaming && (
                    <View style={styles.runningBadge}>
                      <View style={[styles.runningDot, { backgroundColor: theme.colors.primary }]} />
                      <Text style={[styles.statText, { color: theme.colors.primary }]}>生成中</Text>
                    </View>
                  )}
                </View>
              </View>
              <View style={styles.meta}>
                <Text style={[styles.date, { color: theme.colors.textTertiary }]}>{formatDate(item.updatedAt)}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`管理对话 ${item.title}`}
                  hitSlop={10}
                  onPress={(event) => openConversationMenu(event, item.id)}
                  style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
                >
                  <Ionicons name="ellipsis-horizontal" size={19} color={theme.colors.textSecondary} />
                </Pressable>
              </View>
            </Pressable>
          );
        }}
      />

      <Modal transparent visible={!!menuConversation} animationType="fade" onRequestClose={() => setMenuConversationId(undefined)}>
        <Pressable style={[styles.overlay, { backgroundColor: theme.colors.overlay }]} onPress={() => setMenuConversationId(undefined)}>
          <Pressable style={[styles.actionSheet, { backgroundColor: theme.colors.surfaceElevated }]} onPress={keepActionSheetOpen}>
            <View style={[styles.sheetHandle, { backgroundColor: theme.colors.border }]} />
            <Text numberOfLines={1} style={[styles.sheetTitle, { color: theme.colors.text }]}>{menuConversation?.title}</Text>
            {menuConversation && (
              <>
                <Pressable onPress={() => openRename(menuConversation)} style={({ pressed }) => [styles.sheetAction, pressed && styles.pressed]}>
                  <View style={[styles.sheetActionIcon, { backgroundColor: theme.colors.surfaceMuted }]}><Ionicons name="pencil-outline" size={19} color={theme.colors.text} /></View>
                  <Text style={[styles.sheetActionText, { color: theme.colors.text }]}>重命名</Text>
                </Pressable>
                <Pressable onPress={() => confirmDelete(menuConversation)} style={({ pressed }) => [styles.sheetAction, pressed && styles.pressed]}>
                  <View style={[styles.sheetActionIcon, { backgroundColor: theme.colors.surfaceMuted }]}><Ionicons name="trash-outline" size={19} color={theme.colors.danger} /></View>
                  <Text style={[styles.sheetActionText, { color: theme.colors.danger }]}>删除对话</Text>
                </Pressable>
              </>
            )}
            <Pressable onPress={() => setMenuConversationId(undefined)} style={[styles.cancelButton, { backgroundColor: theme.colors.surfaceMuted }]}>
              <Text style={[styles.cancelText, { color: theme.colors.text }]}>取消</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal transparent visible={!!renameConversation} animationType="fade" onRequestClose={() => setRenameConversationId(undefined)}>
        <View style={[styles.renameOverlay, { backgroundColor: theme.colors.overlay }]}>
          <KeyboardAwareView style={styles.renameKeyboard}>
            <View style={[styles.renameCard, { backgroundColor: theme.colors.surfaceElevated }]}>
              <View style={[styles.renameIcon, { backgroundColor: theme.colors.primarySoft }]}><Ionicons name="pencil" size={20} color={theme.colors.primary} /></View>
              <Text style={[styles.renameTitle, { color: theme.colors.text }]}>重命名对话</Text>
              <Text style={[styles.renameHint, { color: theme.colors.textSecondary }]}>使用更容易搜索和识别的标题。</Text>
              <TextInput
                autoFocus
                value={renameValue}
                onChangeText={setRenameValue}
                maxLength={80}
                selectTextOnFocus
                returnKeyType="done"
                onSubmitEditing={saveRename}
                style={[styles.renameInput, { color: theme.colors.text, backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]}
                accessibilityLabel="对话标题"
              />
              <View style={styles.renameActions}>
                <Pressable onPress={() => setRenameConversationId(undefined)} style={[styles.renameButton, { backgroundColor: theme.colors.surfaceMuted }]}>
                  <Text style={[styles.renameButtonText, { color: theme.colors.text }]}>取消</Text>
                </Pressable>
                <Pressable onPress={saveRename} style={[styles.renameButton, { backgroundColor: theme.colors.primary }]}>
                  <Text style={[styles.renameButtonText, { color: '#FFFFFF' }]}>保存</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAwareView>
        </View>
      </Modal>
    </KeyboardAwareView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 14 },
  search: { height: 46, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, marginTop: 10 },
  searchInput: { flex: 1, fontSize: 15, marginLeft: 8, height: 44 },
  summaryRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 10, paddingBottom: 6 },
  summaryTitle: { fontSize: 16, fontWeight: '800' },
  summarySubtitle: { fontSize: 10, marginTop: 3 },
  newButton: { minHeight: 38, borderRadius: 19, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 13 },
  newText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  list: { paddingVertical: 4, paddingBottom: 30 },
  emptyList: { flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', minHeight: 94, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, padding: 12, marginVertical: 5 },
  rowIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  rowBody: { flex: 1, minWidth: 0, paddingTop: 1 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { flexShrink: 1, fontSize: 15, fontWeight: '700' },
  activeBadge: { overflow: 'hidden', borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2, fontSize: 9, fontWeight: '800' },
  preview: { fontSize: 12, lineHeight: 17, marginTop: 5 },
  rowStats: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 6 },
  statText: { fontSize: 10 },
  runningBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  runningDot: { width: 5, height: 5, borderRadius: 3 },
  meta: { minHeight: 66, alignItems: 'flex-end', justifyContent: 'space-between', marginLeft: 8 },
  date: { fontSize: 10 },
  moreButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingBottom: 50 },
  emptyIcon: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 13 },
  emptyTitle: { fontSize: 16, fontWeight: '800' },
  emptySubtitle: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 6 },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  actionSheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 16, paddingTop: 9, paddingBottom: 24 },
  sheetHandle: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { fontSize: 15, fontWeight: '800', textAlign: 'center', marginBottom: 8, paddingHorizontal: 24 },
  sheetAction: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  sheetActionIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  sheetActionText: { fontSize: 15, fontWeight: '700' },
  cancelButton: { minHeight: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  cancelText: { fontSize: 14, fontWeight: '800' },
  renameOverlay: { flex: 1 },
  renameKeyboard: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  renameCard: { borderRadius: 24, padding: 20, alignItems: 'center' },
  renameIcon: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 11 },
  renameTitle: { fontSize: 19, fontWeight: '800' },
  renameHint: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 5 },
  renameInput: { alignSelf: 'stretch', height: 48, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 13, fontSize: 15, marginTop: 16 },
  renameActions: { alignSelf: 'stretch', flexDirection: 'row', gap: 10, marginTop: 14 },
  renameButton: { flex: 1, minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  renameButtonText: { fontSize: 14, fontWeight: '800' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
});
