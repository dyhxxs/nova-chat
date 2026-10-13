import { StorageMaintenanceSection } from '../components/StorageMaintenanceSection';
import { AssistantBackupSection } from '../components/AssistantBackupSection';
import { useEffect, useState } from 'react';
import { useAccountTask } from '../hooks/useAccountTask';
import { accountScope } from '../lib/accountScope';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText as Text } from '../components/ThemedText';
import { SettingsSection } from '../components/SettingsRow';
import { useAppTheme } from '../hooks/useAppTheme';
import { parseConversationBackup, serializeConversationBackup } from '../lib/conversationBackup';
import { pickBackupText, shareTextFile } from '../services/backupFiles';
import { snapshotStorage } from '../services/snapshotStorage';
import { useAppStore } from '../store/useAppStore';

export function DataScreen() {
  const theme = useAppTheme();
  const conversations = useAppStore((state) => state.conversations);
  const recoveryNotice = useAppStore((state) => state.recoveryNotice);
  const persistenceError = useAppStore((state) => state.persistenceError);
  const { scope, busy, run } = useAccountTask();
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const [pending, setPending] = useState<{ json: string; scope: string; conversations: number; messages: number }>();
  const messages = conversations.reduce((sum, item) => sum + item.messages.length, 0);
  const attachments = conversations.reduce((sum, item) => sum + item.messages.reduce((count, message) => count + message.attachments.length, 0), 0);

  useEffect(() => { setPending(undefined); setNotice(undefined); }, [scope]);
  const errorNotice = (error: unknown) => setNotice({ text: error instanceof Error ? error.message : '备份操作失败，请重试。', error: true });
  const exportBackup = () => run(async (isCurrent) => {
    setNotice(undefined); setPending(undefined);
    const json = serializeConversationBackup(useAppStore.getState().conversations);
    await shareTextFile(json, 'json', 'conversations', isCurrent);
    if (isCurrent()) setNotice({ text: '已打开保存/分享入口。请确认目标应用已实际保存文件；取消分享不会创建外部备份。' });
  }, errorNotice);
  const chooseBackup = () => run(async (isCurrent) => {
    setNotice(undefined); setPending(undefined);
    const startingScope = accountScope(useAppStore.getState());
    const json = await pickBackupText();
    if (json === undefined || !isCurrent()) return;
    const backup = parseConversationBackup(json);
    setPending({ json, scope: startingScope, conversations: backup.conversations.length, messages: backup.conversations.reduce((sum, item) => sum + item.messages.length, 0) });
  }, errorNotice);
  const importBackup = () => run(async (isCurrent) => {
    if (!pending || pending.scope !== accountScope(useAppStore.getState())) { setPending(undefined); return; }
    setNotice(undefined);
    const result = useAppStore.getState().importBackup(pending.json);
    setPending(undefined);
    try { await useAppStore.getState().flushPersistence(); }
    catch {
      if (isCurrent()) setNotice({ text: '已合并到当前会话，但本地保存尚未确认。不要关闭应用；请使用上方“重试保存”或立即导出备份。', error: true });
      return;
    }
    if (isCurrent()) setNotice({ text: '导入完成：新增 ' + result.imported + ' 个对话，跳过 ' + result.skipped + ' 个重复对话。原有内容未被覆盖。' });
  }, errorNotice);
  const exportRetained = (source: 'recovery' | 'migration' | 'recoveryMigration') => run(async (isCurrent) => {
    setNotice(undefined);
    const raw = await useAppStore.getState().exportRecoverySnapshot(source);
    if (!isCurrent()) return;
    if (!raw) { setNotice({ text: source === 'recovery' ? '当前账号没有待导出的恢复副本。' : '当前账号没有此类迁移档案。' }); return; }
    await shareTextFile(raw, 'json', 'recovery', isCurrent);
    if (isCurrent()) setNotice({ text: '已打开原始档案保存入口，请确认文件实际保存。此文件包含私有配置与对话，不是可直接导入的通用备份。' });
  }, errorNotice);
  const button = (label: string, icon: keyof typeof Ionicons.glyphMap, action: () => void, secondary = false) => (
    <Pressable accessibilityRole="button" disabled={busy} onPress={action} style={[styles.button, { backgroundColor: secondary ? theme.colors.surfaceMuted : theme.colors.primary }, busy && styles.disabled]}>
      <Ionicons name={icon} size={19} color={secondary ? theme.colors.text : '#fff'} /><Text style={[styles.buttonText, { color: secondary ? theme.colors.text : '#fff' }]}>{label}</Text>
    </Pressable>
  );
  return <ScrollView style={{ backgroundColor: theme.colors.background }} contentContainerStyle={styles.content}>
    <View style={[styles.hero, { backgroundColor: theme.colors.primarySoft }]}>
      <Ionicons name="folder-open-outline" size={32} color={theme.colors.primary} />
      <Text style={[styles.title, { color: theme.colors.text }]}>让对话留在你手中</Text>
      <Text style={[styles.description, { color: theme.colors.textSecondary }]}>对话仅保存在当前设备、当前账号下。换机或卸载前，请主动导出备份。</Text>
      <Text style={[styles.stats, { color: theme.colors.primary }]}>{conversations.length} 个对话 · {messages} 条消息 · {attachments} 个附件记录</Text>
    </View>
    <Text style={[styles.description, { color: theme.colors.textSecondary }]}>当前历史存储：{snapshotStorage.backend}。{snapshotStorage.backend === 'SQLite' ? '旧版账户快照会自动迁移并保留迁移前原文。升级后请勿直接降级旧版客户端；先导出对话和助手备份。' : '网页端受浏览器本地存储配额限制，请定期导出备份。'}</Text>
    {!!persistenceError && <View accessibilityRole="alert" style={[styles.notice, { borderColor: theme.colors.danger }]}>
      <Text style={{ color: theme.colors.danger }}>{persistenceError}</Text>
      {button('重试本地保存', 'refresh-outline', () => { void useAppStore.getState().flushPersistence().catch(() => undefined); }, true)}
    </View>}
    {!!recoveryNotice && <Text accessibilityRole="alert" style={[styles.notice, { color: theme.colors.danger, borderColor: theme.colors.danger }]}>{recoveryNotice}</Text>}
    <SettingsSection title="导出备份"><View style={styles.section}>
      <Text style={[styles.description, { color: theme.colors.textSecondary }]}>JSON 备份包含全部对话（含归档）、正文、模型和附件名称。不会导出登录令牌、API Key、系统指令、助手配置、未发送草稿、账户资料或服务器地址。</Text>
      <Text style={[styles.warning, { color: theme.colors.danger }]}>备份是未加密的明文，可能包含你在聊天中输入的敏感信息。只保存到你信任的位置，不要上传公共网盘。</Text>
      {button('导出全部对话 JSON', 'download-outline', () => { void exportBackup(); })}
    </View></SettingsSection>
    <SettingsSection title="导入备份"><View style={styles.section}>
      <Text style={[styles.description, { color: theme.colors.textSecondary }]}>选择 Nova v1 JSON 备份（最大 20 MB）。导入只添加缺少的对话，不覆盖现有记录，也不会恢复后台任务或发起模型请求。</Text>
      {button('选择备份文件', 'cloud-upload-outline', () => { void chooseBackup(); }, true)}
      {pending && <View style={[styles.preview, { backgroundColor: theme.colors.primarySoft }]}>
        <Text style={[styles.previewTitle, { color: theme.colors.text }]}>确认导入 {pending.conversations} 个对话 / {pending.messages} 条消息？</Text>
        <Text style={[styles.description, { color: theme.colors.textSecondary }]}>内容将合并到当前登录账号。重复的源对话会跳过；附件仅作为文字记录导入，原文件需要另外保存。</Text>
        {button('确认合并导入', 'checkmark-outline', () => { void importBackup(); })}
        {button('取消导入', 'close-outline', () => setPending(undefined), true)}
      </View>}
    </View></SettingsSection>
    <AssistantBackupSection />
    <SettingsSection title="故障恢复"><View style={styles.section}>
      <Text style={[styles.description, { color: theme.colors.textSecondary }]}>读取异常时保留原始本地快照，不静默覆盖。恢复副本仅供人工排障，不是可直接导入的 Nova 备份。它可能含有系统指令、助手配置、服务器地址和私人对话；请勿公开或随意发送给他人。</Text>
      {button('导出本地恢复副本', 'medkit-outline', () => { void exportRetained('recovery'); }, true)}
      {snapshotStorage.backend === 'SQLite' && button('导出迁移前原始快照', 'archive-outline', () => { void exportRetained('migration'); }, true)}
      {snapshotStorage.backend === 'SQLite' && button('导出恢复副本的迁移原文', 'archive-outline', () => { void exportRetained('recoveryMigration'); }, true)}
    </View></SettingsSection>
    <StorageMaintenanceSection />
    {busy && <ActivityIndicator accessibilityLabel="正在处理备份" color={theme.colors.primary} />}
    {!!notice && <Text accessibilityRole="alert" style={[styles.notice, { color: notice.error ? theme.colors.danger : theme.colors.success, borderColor: notice.error ? theme.colors.danger : theme.colors.success }]}>{notice.text}</Text>}
    <Text style={[styles.description, { color: theme.colors.textTertiary }]}>附件文件本体不在此备份中。需要保留的图片、文档请单独下载。也可以在历史记录的对话菜单中导出单个 JSON 或 Markdown。</Text>
  </ScrollView>;
}
const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 8 }, hero: { padding: 20, borderRadius: 22, gap: 10, marginBottom: 16 },
  title: { fontSize: 23, fontWeight: '800' }, description: { fontSize: 13, lineHeight: 21 }, stats: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  section: { padding: 16, gap: 12 }, warning: { fontSize: 12, lineHeight: 20 },
  button: { minHeight: 46, borderRadius: 13, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, buttonText: { fontSize: 14, fontWeight: '700' },
  preview: { padding: 14, borderRadius: 16, gap: 10 }, previewTitle: { fontWeight: '700', fontSize: 15 },
  notice: { borderWidth: 1, borderRadius: 14, padding: 14, lineHeight: 21, marginBottom: 12, gap: 12 }, disabled: { opacity: 0.5 },
});
