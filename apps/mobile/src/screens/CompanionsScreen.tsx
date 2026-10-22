import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { ThemedTextInput as TextInput, ThemedText as Text } from '../components/ThemedText';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { COMPANION_DEFAULT_PERSONALITY, COMPANION_DEFAULT_SPEAKING_STYLE, resolveCompanionPersona, type CompanionProfile } from '@nova-chat/protocol';
import { CompanionAvatar } from '../components/CompanionAvatar';
import { KeyboardAwareView } from '../components/KeyboardAwareView';
import { useAppTheme } from '../hooks/useAppTheme';
import { friendlyNetworkError } from '../lib/errorMessage';
import { createId } from '../lib/id';
import { createCompanion, listCompanions, updateCompanion, uploadAttachment } from '../services/gatewayApiClient';
import { useAppStore } from '../store/useAppStore';
import type { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Companions'>;
type Draft = { id?: string; name: string; userName: string; personality: string; speakingStyle: string; personaPrompt: string; appearance: string; avatarFileId: string | null; memoryEnabled: boolean; proactiveMessagesEnabled: boolean; memories: string };
const draftFrom = (p?: CompanionProfile): Draft => ({ id: p?.id, name: p?.name ?? '', userName: p?.userName ?? '', personality: (p ? resolveCompanionPersona(p.personality, p.speakingStyle).personality : COMPANION_DEFAULT_PERSONALITY).join('\n'), speakingStyle: (p ? resolveCompanionPersona(p.personality, p.speakingStyle).speakingStyle : COMPANION_DEFAULT_SPEAKING_STYLE).join('\n'), personaPrompt: p?.personaPrompt ?? '', appearance: p?.appearance ?? '', avatarFileId: p?.avatarFileId ?? null, memoryEnabled: p?.memoryEnabled ?? false, proactiveMessagesEnabled: p?.proactiveMessagesEnabled ?? true, memories: p?.memories.join('\n') ?? '' });
const lines = (s: string) => s.split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, 12);

export function CompanionsScreen({ navigation, route }: Props) {
  const theme = useAppTheme();
  const serverUrl = useAppStore(state => state.settings.serverUrl);
  const accessToken = useAppStore(state => state.accessToken);
  const conversations = useAppStore(state => state.conversations);
  const [profiles, setProfiles] = useState<CompanionProfile[]>([]);
  const [draft, setDraft] = useState<Draft>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const scope = useRef('');
  useEffect(() => navigation.addListener('beforeRemove', event => {
    // Selecting a topic pops both lists back to the existing Chat instance.
    if (event?.data.action.type === 'POP_TO' && (event.data.action.payload as { name?: string } | undefined)?.name === 'Chat') return;
    const state = useAppStore.getState();
    if (state.authStatus !== 'authenticated' || state.conversations.find(item => item.id === state.activeConversationId)?.kind !== 'companion') return;
    const ordinary = state.conversations.filter(item => item.kind !== 'companion' && !item.archived).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (ordinary) state.setActiveConversation(ordinary.id);
    else state.newConversation();
  }), [navigation]);
  scope.current = `${serverUrl}|${accessToken}`;
  const load = useCallback(async () => {
    const ticket = `${serverUrl}|${accessToken}`;
    setLoading(true); setNotice('');
    try { const next = await listCompanions(serverUrl, accessToken); if (scope.current !== ticket) return; setProfiles(next); if (route.params?.editId) setDraft(draftFrom(next.find(p => p.id === route.params?.editId))); }
    catch (error) { if (scope.current === ticket) setNotice(friendlyNetworkError(error)); }
    finally { if (scope.current === ticket) setLoading(false); }
  }, [serverUrl, accessToken, route.params?.editId]);
  useEffect(() => { setProfiles([]); setDraft(undefined); void load(); return () => { scope.current = ''; }; }, [load]);
  const save = async () => {
    if (!draft || busy) return;
    if (!draft.name.trim()) { setNotice('给 TA 起个名字吧。'); return; }
    const ticket = scope.current;
    setBusy(true); setNotice('');
    try {
      const original = profiles.find(p => p.id === draft.id);
      const face = draft.appearance !== original?.appearance && draft.avatarFileId === original?.avatarFileId ? null : draft.avatarFileId;
      const input = { name: draft.name.trim(), userName: draft.userName.trim(), personality: lines(draft.personality), speakingStyle: lines(draft.speakingStyle), personaPrompt: draft.personaPrompt.trim(), appearance: draft.appearance.trim(), avatarFileId: face, memoryEnabled: draft.memoryEnabled, memories: draft.memoryEnabled ? lines(draft.memories) : [], proactiveMessagesEnabled: draft.proactiveMessagesEnabled };
      const result = draft.id ? await updateCompanion(serverUrl, accessToken, draft.id, input) : await createCompanion(serverUrl, accessToken, input);
      if (scope.current !== ticket) return;
      setProfiles(current => [result, ...current.filter(p => p.id !== result.id)]); setDraft(undefined); navigation.setParams({ editId: undefined });
      useAppStore.getState().updateCompanionName(result.id, result.name);
    } catch (error) { if (scope.current === ticket) setNotice(friendlyNetworkError(error)); }
    finally { if (scope.current === ticket) setBusy(false); }
  };
  const pickFace = async () => {
    if (busy || !draft) return;
    const ticket = scope.current;
    setNotice(''); setBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
      if (result.canceled || scope.current !== ticket) return;
      const asset = result.assets[0]; if (!asset) return;
      setBusy(true);
      const ref = await uploadAttachment(serverUrl, accessToken, { localId: createId(), uri: asset.uri, name: asset.fileName ?? 'companion-face.jpg', mimeType: asset.mimeType ?? 'image/jpeg', size: asset.fileSize, kind: 'image' });
      if (scope.current === ticket) setDraft(current => current && { ...current, avatarFileId: ref.id });
    } catch (error) { if (scope.current === ticket) setNotice(friendlyNetworkError(error)); }
    finally { if (scope.current === ticket) setBusy(false); }
  };
  const open = (p: CompanionProfile) => navigation.navigate('CompanionConversations', { companionId: p.id, companionName: p.name });
  const inputStyle = [styles.input, { color: theme.colors.text, backgroundColor: theme.colors.surface, borderColor: theme.colors.border }];
  const field = (key: 'name' | 'userName' | 'personality' | 'speakingStyle' | 'personaPrompt' | 'appearance' | 'memories', title: string, placeholder: string, multiline = false) => <View style={{ gap: 8 }}><Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600' }}>{title}</Text><TextInput accessibilityLabel={title} value={draft?.[key] ?? ''} onChangeText={value => setDraft(current => current && { ...current, [key]: value, ...(key === 'personaPrompt' && !current.name.trim() ? { name: value.match(/^你是([^，,。\n]{1,20})/u)?.[1]?.trim() ?? '' } : {}) })} placeholder={placeholder} placeholderTextColor={theme.colors.textTertiary} multiline={multiline} maxLength={key === 'personaPrompt' ? 12000 : key === 'appearance' ? 2000 : key === 'name' || key === 'userName' ? 80 : 2000} style={[inputStyle, multiline && styles.multiline]} /></View>;
  return <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.heading}><View style={{ flex: 1 }}><Text style={[styles.title, { color: theme.colors.text }]}>有人听你说</Text><Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>先选一个人设，再聊不同的话题。</Text></View><Pressable accessibilityLabel="创建陪伴角色" onPress={() => { setNotice(''); setDraft(draftFrom()); }} style={[styles.add, { backgroundColor: theme.colors.primary }]}><Ionicons name="add" size={24} color="#fff" /></Pressable></View>
      {loading && <ActivityIndicator color={theme.colors.primary} />}
      {!!notice && !draft && <Pressable onPress={() => void load()}><Text style={{ color: theme.colors.danger, lineHeight: 22 }}>{notice} · 点按重试</Text></Pressable>}
      <View style={[styles.list, { backgroundColor: theme.colors.surface }]}>{profiles.map(p => {
        const chats = conversations.filter(c => c.kind === 'companion' && c.companionId === p.id && !c.archived);
         const unreadCount = chats.reduce((total, chat) => total + (chat.unreadCount ?? 0), 0);
        const recent = [...chats].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        const last = recent?.messages.filter(m => m.status === 'complete').at(-1);
         return <View key={p.id} style={[styles.row, { borderColor: theme.colors.border }]}><Pressable onPress={() => open(p)} style={styles.contact} accessibilityLabel={`查看${p.name}的对话${unreadCount ? `，${unreadCount}条未读消息` : ''}`}><CompanionAvatar name={p.name} fileId={p.avatarFileId} serverUrl={serverUrl} accessToken={accessToken} size={56} /><View style={{ flex: 1, gap: 7 }}><View style={styles.nameLine}><Text numberOfLines={1} style={{ color: theme.colors.text, fontSize: 17, fontWeight: '600', flexShrink: 1 }}>{p.name}</Text>{!!unreadCount && <Text accessibilityLabel={`${unreadCount} 条未读消息`} style={styles.unreadBadge}>{unreadCount > 99 ? '99+' : unreadCount}</Text>}</View><Text numberOfLines={1} style={{ color: theme.colors.textSecondary, fontSize: 13 }}>{last?.content || (last?.attachments.length ? '分享了一张照片' : '点一下，查看或新建对话。')}</Text><Text style={{ color: theme.colors.textTertiary, fontSize: 12 }}>{chats.length} 个对话 · 各聊各的话题</Text></View></Pressable><Pressable accessibilityLabel={`${p.name}的角色与长相设置`} onPress={() => { setNotice(''); setDraft(draftFrom(p)); }} style={styles.edit}><Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.textSecondary} /></Pressable></View>;
      })}</View>
      <Text style={[styles.footnote, { color: theme.colors.textTertiary }]}>每个人设可以有多个独立对话。人设和长相共用，聊天上下文各自保存。</Text>
    </ScrollView>
    <Modal visible={!!draft} animationType="slide" onRequestClose={() => { if (!busy) setDraft(undefined); }}>
      <KeyboardAwareView style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.modalBar, { borderColor: theme.colors.border }]}><Pressable disabled={busy} onPress={() => { setDraft(undefined); navigation.setParams({ editId: undefined }); }} style={styles.edit}><Ionicons name="close" size={24} color={theme.colors.text} /></Pressable><Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: '600' }}>角色与长相</Text><Pressable disabled={busy} onPress={() => void save()} style={styles.edit}>{busy ? <ActivityIndicator color={theme.colors.primary} /> : <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>保存</Text>}</Pressable></View>
        <ScrollView contentContainerStyle={[styles.content, { gap: 24 }]} keyboardShouldPersistTaps="handled">
          {!!notice && <Text style={{ color: theme.colors.danger, lineHeight: 22 }}>{notice}</Text>}
          {field('name', '名字', '你想怎么称呼 TA？')}{field('userName', 'TA 怎么称呼你', '可选')}
          <View style={{ gap: 10 }}>
            {field('personaPrompt', '人设提示词', '粘贴完整提示词，写下 TA 的背景、性格、说话方式和对话示范。', true)}
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 20 }}>可以直接粘贴整段人设，最多 12000 字。填写后，角色按这份提示词聊天；不填则使用下面的性格和聊天方式。</Text>
          </View>
          <View style={{ gap: 16 }}>
            <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: '600' }}>TA 的长相</Text>
          <View style={{ alignItems: 'center', gap: 12 }}><CompanionAvatar name={draft?.name || 'TA'} fileId={draft?.avatarFileId} serverUrl={serverUrl} accessToken={accessToken} size={112} /><Pressable disabled={busy} onPress={() => void pickFace()} style={[styles.photoButton, { borderColor: theme.colors.border }]}><Ionicons name="image-outline" size={18} color={theme.colors.primary} /><Text style={{ color: theme.colors.primary }}>上传或替换脸部照片</Text></Pressable>{draft?.avatarFileId && <Pressable disabled={busy} onPress={() => setDraft(current => current && { ...current, avatarFileId: null })}><Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>重新生成长相</Text></Pressable>}</View>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 20 }}>上传人物照片作为 TA 的长相，之后的照片会以它为参考。也可以不上传，用描述建立长相。</Text>
            {field('appearance', '长相描述（可选）', '例如：短发、深棕色眼睛、自然清爽的成年女性', true)}
          </View>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 20 }}>没有设置长相时，第一张照片会成为 TA 的长相。之后发来的照片沿用这张脸。修改描述后，下一张照片会按新描述建立长相。</Text>
          {!draft?.personaPrompt.trim() && <>{field('personality', '性格与兴趣', '每行写一条你喜欢的特点', true)}{field('speakingStyle', '聊天方式', '例如：自然、少用表情、简短回复', true)}</>}
          <View style={styles.switchRow}><Text style={{ color: theme.colors.text, fontSize: 14, flex: 1, marginRight: 12 }}>在人设的各对话中共享已保存记忆</Text><Switch value={draft?.memoryEnabled} onValueChange={value => setDraft(current => current && { ...current, memoryEnabled: value })} trackColor={{ true: theme.colors.primary }} /></View>
          <View style={styles.switchRow}><Text style={{ color: theme.colors.text, fontSize: 14, flex: 1, marginRight: 12 }}>允许 TA 主动找我聊天</Text><Switch value={draft?.proactiveMessagesEnabled} onValueChange={value => setDraft(current => current && { ...current, proactiveMessagesEnabled: value })} trackColor={{ true: theme.colors.primary }} /></View>
          {draft?.memoryEnabled && field('memories', '想让 TA 记住的事', '每行一条；仅这些记忆会用于 TA 的多个对话', true)}
        </ScrollView>
      </KeyboardAwareView>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({ root: { flex: 1 }, content: { padding: 24, paddingBottom: 48, gap: 24 }, heading: { flexDirection: 'row', alignItems: 'center', gap: 16, marginVertical: 12 }, title: { fontSize: 28, fontWeight: '700', lineHeight: 38 }, subtitle: { fontSize: 14, marginTop: 8 }, add: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, list: { borderRadius: 20, overflow: 'hidden' }, row: { padding: 16, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth }, contact: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14 }, nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 }, unreadBadge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, textAlign: 'center', lineHeight: 20, backgroundColor: '#E5484D', color: '#FFFFFF', fontSize: 10, fontWeight: '800' }, edit: { minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' }, footnote: { fontSize: 12, lineHeight: 20 }, modalBar: { paddingTop: 32, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth }, input: { minHeight: 50, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, fontSize: 15 }, multiline: { minHeight: 100, paddingVertical: 14, textAlignVertical: 'top' }, photoButton: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: 12, borderWidth: 1 }, switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' } });
