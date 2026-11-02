import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText as Text } from './ThemedText';
import { useAppTheme } from '../hooks/useAppTheme';
import { useAppStore } from '../store/useAppStore';
import { conversationPreview } from '../lib/conversationHistory';
import type { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const NAV_ITEMS: { route: 'Companions' | 'Knowledge' | 'Saved' | 'Settings' | 'About' | 'LanguageLearning'; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { route: 'LanguageLearning', label: '语言学习', icon: 'language-outline' },
  { route: 'Companions', label: 'AI 陪伴', icon: 'sparkles-outline' },
  { route: 'Knowledge', label: '个人资料库', icon: 'folder-open-outline' },
  { route: 'Saved', label: '收藏夹', icon: 'bookmark-outline' },
  { route: 'Settings', label: '设置', icon: 'settings-outline' },
  { route: 'About', label: '关于', icon: 'information-circle-outline' },
];

/**
 * Persistent left sidebar for wide (desktop) web. It mirrors the phone app's
 * conversation history as a always-visible column and keeps the chat screen in
 * the remaining space. Mobile keeps the existing full-screen stack navigation.
 */
export function DesktopSidebar() {
  const theme = useAppTheme();
  const navigation = useNavigation<Nav>();
  const conversations = useAppStore((state) => state.conversations);
  const activeId = useAppStore((state) => state.activeConversationId);
  const setActive = useAppStore((state) => state.setActiveConversation);
  const newConversation = useAppStore((state) => state.newConversation);
  const user = useAppStore((state) => state.user);
  const clearSession = useAppStore((state) => state.clearSession);

  const normal = useMemo(
    () => conversations.filter((item) => item.kind !== 'companion').sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations],
  );

  const openConversation = (id: string) => {
    setActive(id);
    if (navigation.isFocused()) navigation.popTo('Chat');
    else navigation.navigate('Chat');
  };

  const startNew = () => {
    newConversation();
    if (navigation.isFocused()) navigation.popTo('Chat');
    else navigation.navigate('Chat');
  };

  return (
    <View style={[styles.sidebar, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <View style={styles.header}>
        <View style={[styles.logo, { backgroundColor: theme.colors.primary }]}>
          <Ionicons name="chatbubbles-outline" size={19} color="#FFFFFF" />
        </View>
        <Text style={[styles.brand, { color: theme.colors.text, fontFamily: theme.fonts.bold }]}>Nova</Text>
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel="新建对话" onPress={startNew} style={[styles.newButton, { backgroundColor: theme.colors.primary }]}>
        <Ionicons name="add" size={18} color="#FFFFFF" />
        <Text style={styles.newButtonText}>新对话</Text>
      </Pressable>

      <FlatList
        data={normal}
        keyExtractor={(item) => item.id}
        style={styles.list}
        contentContainerStyle={normal.length === 0 ? styles.emptyList : undefined}
        ListEmptyComponent={
          <Text style={[styles.emptyText, { color: theme.colors.textTertiary }]}>还没有对话，点上方“新对话”开始。</Text>
        }
        renderItem={({ item }) => {
          const isActive = item.id === activeId;
          const streaming = item.messages.some((message) => message.status === 'streaming');
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`打开对话 ${item.title}`}
              onPress={() => openConversation(item.id)}
              style={[styles.row, isActive && { backgroundColor: theme.colors.primarySoft }]}
            >
              <View style={[styles.rowIcon, { backgroundColor: isActive ? theme.colors.surfaceElevated : theme.colors.surfaceMuted }]}>
                <Ionicons name={streaming ? 'sparkles' : 'chatbubble-outline'} size={16} color={isActive || streaming ? theme.colors.primary : theme.colors.textSecondary} />
              </View>
              <View style={styles.rowBody}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: isActive ? theme.colors.primary : theme.colors.text }]}>{item.title}</Text>
                <Text numberOfLines={1} style={[styles.rowPreview, { color: theme.colors.textSecondary }]}>{item.draft?.trim() ? `草稿：${item.draft}` : conversationPreview(item)}</Text>
              </View>
            </Pressable>
          );
        }}
      />

      <View style={[styles.navSection, { borderColor: theme.colors.border }]}>
        {NAV_ITEMS.map((item) => (
          <Pressable key={item.route} accessibilityRole="button" onPress={() => navigation.navigate(item.route)} style={styles.navItem}>
            <Ionicons name={item.icon} size={17} color={theme.colors.textSecondary} />
            <Text style={[styles.navLabel, { color: theme.colors.text }]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={[styles.footer, { borderColor: theme.colors.border }]}>
        <View style={styles.account}>
          <View style={[styles.avatar, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="person" size={15} color={theme.colors.primary} />
          </View>
          <View style={styles.accountText}>
            <Text numberOfLines={1} style={[styles.accountName, { color: theme.colors.text }]}>{user?.displayName || '用户'}</Text>
            <Text numberOfLines={1} style={[styles.accountEmail, { color: theme.colors.textTertiary }]}>{user?.email || ''}</Text>
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="退出登录" onPress={() => void clearSession()} hitSlop={8} style={styles.logout}>
          <Ionicons name="log-out-outline" size={18} color={theme.colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: { width: 288, height: '100%', borderRightWidth: StyleSheet.hairlineWidth },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 12 },
  logo: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  brand: { fontSize: 18, fontWeight: '800' },
  newButton: { minHeight: 40, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginHorizontal: 14, marginBottom: 10 },
  newButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  list: { flex: 1, paddingHorizontal: 10 },
  emptyList: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  emptyText: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 9, marginVertical: 2 },
  rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 13, fontWeight: '700' },
  rowPreview: { fontSize: 11, marginTop: 2 },
  navSection: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8, paddingHorizontal: 8 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 38, borderRadius: 10, paddingHorizontal: 10 },
  navLabel: { fontSize: 13, fontWeight: '600' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 10 },
  account: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, minWidth: 0 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  accountText: { flex: 1, minWidth: 0 },
  accountName: { fontSize: 12, fontWeight: '700' },
  accountEmail: { fontSize: 10, marginTop: 1 },
  logout: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
