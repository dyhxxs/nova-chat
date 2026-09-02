import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { KeyboardAwareView } from '../components/KeyboardAwareView';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '../hooks/useAppTheme';
import { useAppStore } from '../store/useAppStore';
import type { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'History'>;
function formatDate(timestamp: number) {
  const date = new Date(timestamp); const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
export function HistoryScreen({ navigation }: Props) {
  const theme = useAppTheme(); const [query, setQuery] = useState('');
  const conversations = useAppStore((state) => state.conversations); const activeId = useAppStore((state) => state.activeConversationId);
  const setActive = useAppStore((state) => state.setActiveConversation); const remove = useAppStore((state) => state.deleteConversation); const createNew = useAppStore((state) => state.newConversation);
  const filtered = useMemo(() => conversations.filter((item) => item.title.toLowerCase().includes(query.trim().toLowerCase())), [conversations, query]);
  const choose = (id: string) => { setActive(id); navigation.navigate('Chat'); };
  const confirmDelete = (id: string, title: string) => Alert.alert('删除对话？', `“${title}”将从本机永久删除。`, [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => remove(id) }]);
  return (
    <KeyboardAwareView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.search, { backgroundColor: theme.colors.surfaceMuted }]}><Ionicons name="search" size={18} color={theme.colors.textTertiary} /><TextInput value={query} onChangeText={setQuery} placeholder="搜索对话" placeholderTextColor={theme.colors.textTertiary} style={[styles.searchInput, { color: theme.colors.text }]} /></View>
      <Pressable onPress={() => { createNew(); navigation.navigate('Chat'); void Haptics.selectionAsync(); }} style={({ pressed }) => [styles.newButton, { backgroundColor: theme.colors.primary }, pressed && { opacity: 0.8 }]}><Ionicons name="add" size={21} color="#fff" /><Text style={styles.newText}>新建对话</Text></Pressable>
      <FlatList keyboardShouldPersistTaps="handled" data={filtered} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} ListEmptyComponent={<Text style={[styles.empty, { color: theme.colors.textSecondary }]}>没有找到对话</Text>} renderItem={({ item }) => (
        <Pressable onPress={() => choose(item.id)} onLongPress={() => confirmDelete(item.id, item.title)} style={({ pressed }) => [styles.row, { backgroundColor: item.id === activeId ? theme.colors.primarySoft : theme.colors.surface, borderColor: theme.colors.border }, pressed && { opacity: 0.72 }]}>
          <View style={[styles.rowIcon, { backgroundColor: theme.colors.surfaceMuted }]}><Ionicons name="chatbubble-outline" size={18} color={theme.colors.primary} /></View>
          <View style={styles.rowBody}><Text numberOfLines={1} style={[styles.title, { color: theme.colors.text }]}>{item.title}</Text><Text numberOfLines={1} style={[styles.preview, { color: theme.colors.textSecondary }]}>{item.messages.at(-1)?.content || '还没有消息'}</Text></View>
          <View style={styles.meta}><Text style={[styles.date, { color: theme.colors.textTertiary }]}>{formatDate(item.updatedAt)}</Text><Pressable hitSlop={10} onPress={() => confirmDelete(item.id, item.title)}><Ionicons name="trash-outline" size={17} color={theme.colors.textTertiary} /></Pressable></View>
        </Pressable>
      )} />
    </KeyboardAwareView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 14 }, search: { height: 44, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, marginTop: 10 }, searchInput: { flex: 1, fontSize: 15, marginLeft: 8 },
  newButton: { height: 46, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 12, marginBottom: 8 }, newText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  list: { paddingVertical: 4, paddingBottom: 30 }, row: { flexDirection: 'row', alignItems: 'center', minHeight: 76, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 12, marginVertical: 5 }, rowIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 11 }, rowBody: { flex: 1, minWidth: 0 }, title: { fontSize: 15, fontWeight: '600' }, preview: { fontSize: 12, marginTop: 5 }, meta: { alignItems: 'flex-end', alignSelf: 'stretch', justifyContent: 'space-between', marginLeft: 10 }, date: { fontSize: 10 }, empty: { textAlign: 'center', marginTop: 80, fontSize: 15 },
});
