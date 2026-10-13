import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText as Text } from '../components/ThemedText';
import { KeyboardAwareView } from '../components/KeyboardAwareView';
import { useAppTheme } from '../hooks/useAppTheme';
import { BUILTIN_ASSISTANTS, type AssistantPreset } from '../lib/assistantPresets';
import { useAppStore } from '../store/useAppStore';
import type { RootStackParamList } from '../types';

type Draft = Omit<AssistantPreset, 'id' | 'updatedAt'> & { id?: string };
const emptyDraft = (): Draft => ({ name: '', description: '', instructions: '', starter: '' });
export function AssistantsScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Assistants'>) {
  const theme = useAppTheme();
  const presets = useAppStore((state) => state.assistantPresets);
  const scroll = useRef<ScrollView>(null);
  const [draft, setDraft] = useState<Draft>();
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState<string>();
  const [expanded, setExpanded] = useState<string>();
  const [saving, setSaving] = useState(false);
  const colors = { color: theme.colors.text, backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border };
  const edit = (preset?: AssistantPreset, copy = false) => {
    setNotice(''); setDeleting(undefined);
    setDraft(preset ? { ...preset, id: copy ? undefined : preset.id, name: copy ? `${preset.name} 副本`.slice(0, 60) : preset.name } : emptyDraft());
    scroll.current?.scrollTo({ y: 0, animated: true });
  };
  const save = async () => {
    if (!draft || saving) return;
    if (!draft.name.trim() || !draft.instructions.trim()) { setNotice('请填写助手名称和系统指令。'); return; }
    setSaving(true); setNotice('');
    try {
      useAppStore.getState().saveAssistantPreset(draft, draft.id);
      setDraft(undefined);
      await useAppStore.getState().flushPersistence();
      setNotice('助手已保存在当前设备、当前账号中。可以开始新对话了。');
    } catch { setNotice('保存未完成，请检查名称、指令和本地存储状态；已创建的助手会显示在下方，可在数据与备份中重试保存。'); }
    finally { setSaving(false); }
  };
  const button = (label: string, onPress: () => void, primary = false, danger = false) => <Pressable accessibilityRole="button" disabled={saving} onPress={onPress} style={[styles.button, { backgroundColor: primary ? theme.colors.primary : theme.colors.surfaceMuted }]}><Text style={{ color: primary ? '#fff' : danger ? theme.colors.danger : theme.colors.text, fontSize: 13, fontWeight: '700' }}>{label}</Text></Pressable>;
  const card = (preset: AssistantPreset, builtIn: boolean) => <View key={preset.id} style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
    <View style={styles.cardHeader}><View style={[styles.icon, { backgroundColor: theme.colors.primarySoft }]}><Ionicons name="sparkles-outline" size={20} color={theme.colors.primary} /></View><View style={{ flex: 1 }}><Text style={[styles.cardTitle, { color: theme.colors.text }]}>{preset.name}</Text><Text style={[styles.small, { color: theme.colors.textTertiary }]}>{builtIn ? '内置模板' : '我的助手 · 本机保存'}</Text></View></View>
    <Text style={[styles.description, { color: theme.colors.textSecondary }]}>{preset.description || '自定义工作方式与开场草稿'}</Text>
    <View style={styles.actions}>{button('开始新对话', () => { useAppStore.getState().newAssistantConversation(preset); navigation.popTo('Chat'); }, true)}{button(expanded === preset.id ? '收起指令' : '查看指令', () => setExpanded(expanded === preset.id ? undefined : preset.id))}{button(builtIn ? '复制定制' : '编辑', () => edit(preset, builtIn))}{!builtIn && button('删除', () => { setDeleting(preset.id); setNotice(''); }, false, true)}</View>
    {expanded === preset.id && <View style={[styles.preview, { backgroundColor: theme.colors.surfaceMuted }]}><Text selectable style={[styles.description, { color: theme.colors.text }]}>{preset.instructions}</Text>{!!preset.starter && <Text selectable style={[styles.description, { color: theme.colors.textSecondary }]}>开场草稿：{preset.starter}</Text>}</View>}
    {deleting === preset.id && <View style={styles.preview}><Text style={[styles.description, { color: theme.colors.danger }]}>删除“{preset.name}”？已有对话保留自己的指令副本，不受影响。</Text><View style={styles.actions}>{button('确认删除', () => { useAppStore.getState().deleteAssistantPreset(preset.id); if (draft?.id === preset.id) setDraft(undefined); setDeleting(undefined); }, false, true)}{button('取消', () => setDeleting(undefined))}</View></View>}
  </View>;
  const matches = (preset: AssistantPreset) => `${preset.name} ${preset.description}`.normalize('NFKC').toLocaleLowerCase().includes(query.trim().normalize('NFKC').toLocaleLowerCase());
  return <KeyboardAwareView style={{ flex: 1, backgroundColor: theme.colors.background }}><ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <View style={[styles.hero, { backgroundColor: theme.colors.primarySoft }]}><Text style={[styles.title, { color: theme.colors.text }]}>把好用的方法，变成专属助手</Text><Text style={[styles.description, { color: theme.colors.textSecondary }]}>先选择工作方式，再开始聊天。模板只填写草稿，不自动发送，不会在这里调用模型。</Text>{button('创建我的助手', () => edit(), true)}{button('备份或导入助手', () => navigation.navigate('Data'))}</View>
    {!!notice && <Text accessibilityRole="alert" style={[styles.description, { color: theme.colors.primary }]}>{notice}</Text>}
    {draft && <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.primary }]}>
      <Text style={[styles.cardTitle, { color: theme.colors.text }]}>{draft.id ? '编辑助手' : '创建助手'}</Text>
      {([{ key: 'name', label: '助手名称', max: 60, multiline: false }, { key: 'description', label: '用途说明（可选）', max: 200, multiline: false }, { key: 'instructions', label: '系统指令 · 定义角色与工作规则', max: 20_000, multiline: true }, { key: 'starter', label: '开场草稿（可选，不自动发送）', max: 10_000, multiline: true }] as const).map((field) => <View key={field.key} style={{ gap: 6 }}><Text style={[styles.small, { color: theme.colors.textSecondary }]}>{field.label}</Text><TextInput accessibilityLabel={field.label} value={draft[field.key]} onChangeText={(value) => setDraft((current) => current ? { ...current, [field.key]: value } : current)} maxLength={field.max} multiline={field.multiline} textAlignVertical="top" style={[styles.input, field.multiline && styles.multiline, colors]} /><Text style={[styles.count, { color: theme.colors.textTertiary }]}>{draft[field.key].length} / {field.max}</Text></View>)}
      <Text style={[styles.small, { color: theme.colors.textSecondary }]}>自定义助手仅保存在本机当前账号，不包含在对话备份里，可通过「数据与备份 → 助手模板迁移」单独迁移。请勿写入密钥。指令会在发送消息时交给配置的模型服务；模板不是专用工具，也不保证模型一定遵守。</Text>
      <View style={styles.actions}>{button(saving ? '保存中…' : '保存助手', () => { void save(); }, true)}{button('取消编辑', () => { setDraft(undefined); setNotice(''); })}</View>
    </View>}
    <TextInput accessibilityLabel="搜索助手" value={query} onChangeText={setQuery} placeholder="搜索助手名称或用途" placeholderTextColor={theme.colors.textTertiary} style={[styles.input, colors]} maxLength={100} />
    <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>我的助手 · {presets.length}/100</Text>
    {!presets.filter(matches).length && <Text style={[styles.description, { color: theme.colors.textTertiary }]}>{query ? '没有匹配的自定义助手。' : '还没有自定义助手。可从内置模板复制，也可以直接创建。'}</Text>}
    {presets.filter(matches).map((preset) => card(preset, false))}
    <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>灵感起点</Text>{BUILTIN_ASSISTANTS.filter(matches).map((preset) => card(preset, true))}
    <Text style={[styles.small, { color: theme.colors.textTertiary }]}>助手对话使用创建时的指令快照，替代设置里的全局系统指令。之后修改或删除模板不会改变已有对话；模型和工具仍按当前聊天设置使用。</Text>
  </ScrollView></KeyboardAwareView>;
}
const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 40 }, hero: { padding: 20, borderRadius: 22, gap: 14 }, title: { fontSize: 23, fontWeight: '800', lineHeight: 32 },
  description: { fontSize: 13, lineHeight: 21 }, small: { fontSize: 12, lineHeight: 19 }, sectionTitle: { fontSize: 17, fontWeight: '800', marginTop: 8 }, cardTitle: { fontSize: 17, fontWeight: '700' },
  card: { padding: 16, borderRadius: 20, borderWidth: 1, gap: 12 }, cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 }, icon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, button: { minHeight: 44, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 46, fontSize: 14 }, multiline: { minHeight: 110, maxHeight: 240 }, count: { fontSize: 10, textAlign: 'right' }, preview: { padding: 12, borderRadius: 12, gap: 12 },
});
