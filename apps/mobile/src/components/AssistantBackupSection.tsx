import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { ThemedText as Text } from './ThemedText';
import { SettingsSection } from './SettingsRow';
import { useAccountTask } from '../hooks/useAccountTask';
import { useAppTheme } from '../hooks/useAppTheme';
import { accountScope } from '../lib/accountScope';
import { MAX_ASSISTANT_BACKUP_BYTES, parseAssistantBackup, previewAssistantImport, serializeAssistantBackup, type AssistantBackup } from '../lib/assistantBackup';
import { pickBackupText, shareTextFile } from '../services/backupFiles';
import { useAppStore } from '../store/useAppStore';

export function AssistantBackupSection() {
  const theme = useAppTheme();
  const { scope, busy, run } = useAccountTask();
  const presets = useAppStore((state) => state.assistantPresets);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<{ json: string; backup: AssistantBackup; scope: string; imported: number; skipped: number }>();
  const [trusted, setTrusted] = useState(false);
  useEffect(() => { setPending(undefined); setTrusted(false); setNotice(''); }, [scope]);
  const small = { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 21 };
  const button = (label: string, action: () => void, disabled = false) => <Pressable accessibilityRole="button" disabled={busy || disabled} onPress={action} style={{ minHeight: 46, padding: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceMuted, opacity: busy || disabled ? 0.5 : 1 }}><Text style={{ color: theme.colors.primary, fontWeight: '700' }}>{label}</Text></Pressable>;
  const errorNotice = (error: unknown) => setNotice(error instanceof Error ? error.message : '助手备份操作失败，请重试。');
  const exportTemplates = () => run(async (isCurrent) => {
    setNotice(''); setPending(undefined);
    const json = serializeAssistantBackup(useAppStore.getState().assistantPresets);
    await shareTextFile(json, 'json', 'assistants', isCurrent);
    if (isCurrent()) setNotice('已打开助手备份保存入口，请确认目标应用已实际保存。');
  }, errorNotice);
  const chooseTemplates = () => run(async (isCurrent) => {
    const startingScope = accountScope(useAppStore.getState());
    setNotice(''); setPending(undefined); setTrusted(false);
    const json = await pickBackupText(MAX_ASSISTANT_BACKUP_BYTES);
    if (json === undefined || !isCurrent()) return;
    const backup = parseAssistantBackup(json);
    const preview = previewAssistantImport(useAppStore.getState().assistantPresets, backup);
    setPending({ json, backup, scope: startingScope, imported: preview.imported, skipped: preview.skipped });
  }, errorNotice);
  const importTemplates = () => run(async (isCurrent) => {
    if (!pending || !trusted) return;
    setNotice('');
    const result = useAppStore.getState().importAssistantBackup(pending.json, pending.scope);
    setPending(undefined); setTrusted(false);
    try { await useAppStore.getState().flushPersistence(); }
    catch {
      if (isCurrent()) setNotice('助手已加入当前会话，但本地保存尚未确认。不要关闭应用；请在数据页重试本地保存，或先导出助手备份。');
      return;
    }
    if (isCurrent()) setNotice('已新增 ' + result.imported + ' 个助手，跳过 ' + result.skipped + ' 个重复模板。原有模板未覆盖；未创建对话或发送请求。');
  }, errorNotice);
  return <SettingsSection title={'助手模板迁移 · ' + presets.length + '/100'}><View style={{ padding: 16, gap: 12 }}>
    <Text style={small}>这是独立的 Nova v1 助手备份（最大 10 MB），与对话备份互不通用。只导出自定义助手，不包含内置模板、聊天、账户、网关或登录凭据。</Text>
    <Text style={{ ...small, color: theme.colors.danger }}>注意：此备份包含助手的完整系统指令和开场草稿，均为未加密明文。请勿写入密钥，导出后仅保存到可信位置。</Text>
    {button('导出自定义助手（含私有指令）', () => { void exportTemplates(); }, presets.length === 0)}
    {button('选择助手备份并预览', () => { void chooseTemplates(); })}
    {pending && <View style={{ padding: 12, gap: 10, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14 }}>
      <Text style={{ color: theme.colors.text, fontWeight: '700' }}>预计新增 {pending.imported} 个，跳过 {pending.skipped} 个重复模板</Text>
      <Text style={small}>按来源标识或完全相同的内容去重；同一来源的更新不会覆盖本地编辑。确认时会重新检查容量。导入不会调用模型，之后主动使用助手发送消息时才会应用这些指令。</Text>
      <ScrollView nestedScrollEnabled style={{ maxHeight: 340 }} contentContainerStyle={{ gap: 14 }}>
        {pending.backup.presets.map((item) => <View key={item.sourceId} style={{ gap: 5 }}>
          <Text style={{ color: theme.colors.text, fontWeight: '700' }}>{item.name}</Text>
          {!!item.description && <Text style={small}>{item.description}</Text>}
          <Text selectable style={small}>指令：{item.instructions.slice(0, 800)}{item.instructions.length > 800 ? '…（预览前 800 字；导入后可在助手库查看完整指令）' : ''}</Text>
          {!!item.starter && <Text selectable style={small}>开场草稿：{item.starter.slice(0, 300)}{item.starter.length > 300 ? '…（预览前 300 字）' : ''}</Text>}
        </View>)}
      </ScrollView>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: trusted }} disabled={busy} onPress={() => setTrusted((value) => !value)} style={{ minHeight: 48, paddingVertical: 10 }}>
        <Text style={{ ...small, color: theme.colors.primary }}>{trusted ? '☑' : '☐'} 我信任模板来源，已检查指令，并理解导入后仍需主动使用才会发送给模型。</Text>
      </Pressable>
      {button('确认增量导入助手', () => { void importTemplates(); }, !trusted || pending.imported === 0)}
      {button('取消预览', () => { setPending(undefined); setTrusted(false); })}
    </View>}
    {busy && <ActivityIndicator accessibilityLabel="正在处理助手备份" color={theme.colors.primary} />}
    {!!notice && <Text accessibilityRole="alert" style={small}>{notice}</Text>}
  </View></SettingsSection>;
}
