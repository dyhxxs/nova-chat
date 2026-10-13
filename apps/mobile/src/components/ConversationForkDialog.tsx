import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText as Text } from './ThemedText';
import { useAppTheme } from '../hooks/useAppTheme';
import type { ForkPreview, ForkSelection } from '../lib/conversationFork';

type Props = { selected?: { source: ForkSelection; preview: ForkPreview }; error: string; onClose: () => void; onConfirm: () => void; onDismissError: () => void };
export function ConversationForkDialog({ selected, error, onClose, onConfirm, onDismissError }: Props) {
  const theme = useAppTheme();
  const rewrite = selected?.source.mode === 'rewrite';
  return <>
    {!!error && <View style={[styles.error, { backgroundColor: theme.colors.surfaceMuted }]}>
      <Text accessibilityLiveRegion="polite" style={[styles.flex, { color: theme.colors.danger }]}>{error}</Text>
      <Pressable onPress={onDismissError} accessibilityRole="button" accessibilityLabel="关闭分支提示" style={styles.icon}><Ionicons name="close" size={22} color={theme.colors.text} /></Pressable>
    </View>}
    <Modal visible={!!selected} onRequestClose={onClose} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.header, { borderColor: theme.colors.border }]}>
          <Text style={[styles.title, styles.flex, { color: theme.colors.text }]}>{rewrite ? '在新分支改写提问' : '从此回复创建分支'}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="取消创建分支" style={styles.icon}><Ionicons name="close" size={25} color={theme.colors.text} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.body, { color: theme.colors.text }]}>原对话和未发送草稿保持不变。新分支是当前账户下的独立本地副本，不会自动发送消息或调用模型。</Text>
          <Text style={[styles.body, { color: theme.colors.textSecondary }]}>{rewrite ? '仅复制这条提问之前的已完成消息，并把原问题放入新输入框；请修改后自行发送。原问题的回答和后续消息不复制。' : '仅复制截至这条回复的已完成消息；这之后的消息和原对话草稿不复制。'}</Text>
          {!!selected && <Text style={[styles.body, { color: theme.colors.text }]}>将复制 {selected.preview.messages} 条已完成消息、{selected.preview.attachments} 个已有附件引用；跳过 {selected.preview.omitted} 条失败或取消的片段。</Text>}
          {rewrite && <View style={[styles.preview, { backgroundColor: theme.colors.surfaceMuted }]}><Text style={{ color: theme.colors.textSecondary }}>待改写问题预览{(selected?.preview.draft.length ?? 0) > 600 ? '（仅前600字；输入框保留完整问题）' : ''}</Text><Text selectable style={[styles.body, { color: theme.colors.text }]}>{selected?.preview.draft.slice(0, 600)}</Text></View>}
          <Text style={[styles.body, { color: theme.colors.textSecondary }]}>已有附件只复用引用，不复制服务器文件，原文件失效后仍可能无法读取。复制的资料来源快照不会重新检索。自定义助手指令会保留；后续发送使用当前模型与工具设置，仍受上下文上限限制。</Text>
          <Text style={[styles.body, { color: theme.colors.textSecondary }]}>创建分支不是外部备份，也不会隐藏或脱敏原文。后续发送可能将这些历史内容交给网关和模型服务；敏感资料请谨慎处理。本地保存失败时请查看数据提示，不要卸载应用。</Text>
          <Pressable accessibilityRole="button" onPress={onConfirm} style={[styles.confirm, { backgroundColor: theme.colors.primary }]}><Text style={{ color: '#fff', fontWeight: '600' }}>{rewrite ? '创建分支并放入草稿' : '创建分支，不自动发送'}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.confirm}><Text style={{ color: theme.colors.textSecondary }}>取消，保留原对话</Text></Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </>;
}
const styles = StyleSheet.create({ screen: { flex: 1 }, flex: { flex: 1, minWidth: 0 }, header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: StyleSheet.hairlineWidth }, title: { fontSize: 20, fontWeight: '700' }, content: { padding: 20, gap: 16, paddingBottom: 32 }, body: { fontSize: 14, lineHeight: 23 }, icon: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, error: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16 }, preview: { padding: 14, gap: 8, borderRadius: 12 }, confirm: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, paddingHorizontal: 12 } });
