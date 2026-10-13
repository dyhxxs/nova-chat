import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SettingsSection } from './SettingsRow';
import { ThemedText as Text } from './ThemedText';
import { useAppTheme } from '../hooks/useAppTheme';
import { accountScope } from '../lib/accountScope';
import { formatStorageBytes, retainedArchiveBytes, type ArchiveCleanupPlan, type StorageOverview } from '../lib/storageMaintenance';
import { useAppStore } from '../store/useAppStore';

export function StorageMaintenanceSection() {
  const theme = useAppTheme();
  const scope = useAppStore(accountScope);
  const blocked = useAppStore((state) => state.storageReadBlocked);
  const [info, setInfo] = useState<StorageOverview>();
  const [plan, setPlan] = useState<ArchiveCleanupPlan>();
  const [confirmedBackup, setConfirmedBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const operation = useRef(0);
  useEffect(() => {
    operation.current++;
    setInfo(undefined); setPlan(undefined); setConfirmedBackup(false); setNotice(undefined); setBusy(false);
    return () => { operation.current++; };
  }, [scope, blocked]);
  const perform = async (action: (isCurrent: () => boolean) => Promise<void>) => {
    if (busy) return;
    const id = ++operation.current;
    const isCurrent = () => operation.current === id && accountScope(useAppStore.getState()) === scope;
    setBusy(true); setNotice(undefined);
    try { await action(isCurrent); }
    catch (error) { if (isCurrent()) setNotice({ text: error instanceof Error ? error.message : '存储维护失败，保留档案未被确认清理，请刷新检查。', error: true }); }
    finally { if (isCurrent()) setBusy(false); }
  };
  const refresh = () => {
    setPlan(undefined); setConfirmedBackup(false);
    void perform(async (isCurrent) => { const result = await useAppStore.getState().getStorageOverview(); if (isCurrent()) setInfo(result); });
  };
  const preview = () => {
    setPlan(undefined); setConfirmedBackup(false);
    void perform(async (isCurrent) => {
      const result = await useAppStore.getState().prepareArchiveCleanup();
      if (isCurrent()) { setInfo(result.overview); setPlan(result); }
    });
  };
  const clear = () => {
    if (!plan || !confirmedBackup) return;
    const pending = plan;
    setPlan(undefined); setConfirmedBackup(false);
    void perform(async (isCurrent) => {
      const result = await pending.confirm();
      if (!isCurrent()) return;
      setInfo(undefined);
      setNotice({ text: '已逻辑移除 ' + formatStorageBytes(result.logicalBytesRemoved) + ' 保留档案。当前聊天、助手和草稿未删除；这不代表数据库文件立即缩小，也不是安全擦除。' });
      try { const next = await useAppStore.getState().getStorageOverview(); if (isCurrent()) setInfo(next); }
      catch { if (isCurrent()) setNotice({ text: '档案清理已完成，但统计刷新失败，请重试刷新。', error: true }); }
    });
  };
  const button = (label: string, action: () => void, disabled = false, danger = false) => <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || disabled }} disabled={busy || disabled} onPress={action}
    style={[styles.button, { backgroundColor: danger ? theme.colors.danger : theme.colors.surfaceMuted }, (busy || disabled) && styles.disabled]}>
    <Text style={{ color: danger ? '#fff' : theme.colors.text, fontWeight: '700' }}>{label}</Text>
  </Pressable>;
  return <SettingsSection title="存储检查与保留档案"><View style={styles.section}>
    <Text style={[styles.description, { color: theme.colors.textSecondary }]}>按当前账号和网关检查已落盘的 UTF-8 文本大小。不是整库磁盘占用，也不包含附件文件或外部备份。检查可能先安全迁移旧恢复副本。</Text>
    {button('检查 / 刷新存储统计', refresh)}
    {info && <View style={styles.details}>
      <Text style={{ color: theme.colors.text }}>活动快照：{formatStorageBytes(info.snapshotBytes)}</Text>
      <Text style={{ color: theme.colors.text }}>故障恢复副本：{formatStorageBytes(info.recoveryBytes)}</Text>
      <Text style={{ color: theme.colors.text }}>历史迁移档案：{formatStorageBytes(info.migrationBytes)}</Text>
      <Text style={{ color: theme.colors.text }}>恢复副本的迁移档案：{formatStorageBytes(info.recoveryMigrationBytes)}</Text>
      {info.cleanupSupported ? button('预览保留档案清理', preview, blocked || retainedArchiveBytes(info) === 0) :
        <Text style={[styles.description, { color: theme.colors.textSecondary }]}>Web 不支持跨标签页原子清理，此处只提供统计，不删除恢复副本。</Text>}
    </View>}
    {blocked && <Text accessibilityRole="alert" style={[styles.description, { color: theme.colors.danger }]}>历史读取仍被阻止；请先保留并恢复数据，当前禁止清理档案。</Text>}
    {plan && <View style={[styles.preview, { borderColor: theme.colors.danger }]}>
      <Text style={{ color: theme.colors.danger, fontWeight: '800' }}>确认移除 {formatStorageBytes(retainedArchiveBytes(plan.overview))} 保留原文？</Text>
      <Text style={[styles.description, { color: theme.colors.textSecondary }]}>只清理当前账号的上述三类档案，不能撤销。标准聊天备份不含助手、草稿或原始私有配置，请分别保存所需内容，并核实外部文件可用。打开分享入口不等于备份成功。</Text>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: confirmedBackup, disabled: busy }} disabled={busy} onPress={() => setConfirmedBackup(!confirmedBackup)} style={styles.acknowledge}>
        <Text style={{ color: theme.colors.text }}>{confirmedBackup ? '☑' : '☐'} 我已核实所需外部备份，并接受永久移除保留档案</Text>
      </Pressable>
      {button('确认清理保留档案', clear, !confirmedBackup, true)}
      {button('取消，不清理', () => { setPlan(undefined); setConfirmedBackup(false); })}
    </View>}
    {busy && <ActivityIndicator accessibilityLabel="正在检查存储" color={theme.colors.primary} />}
    {notice && <Text accessibilityRole="alert" style={[styles.description, { color: notice.error ? theme.colors.danger : theme.colors.text }]}>{notice.text}</Text>}
    <Text style={[styles.description, { color: theme.colors.textTertiary }]}>不会执行整库清空、VACUUM 或删除其他账号数据。SQLite / WAL / 系统缓存可能仍保留已删除文本的物理副本。</Text>
  </View></SettingsSection>;
}
const styles = StyleSheet.create({
  section: { padding: 16, gap: 12 }, description: { fontSize: 13, lineHeight: 21 }, details: { gap: 10 },
  button: { minHeight: 46, borderRadius: 13, padding: 12, alignItems: 'center', justifyContent: 'center' },
  preview: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 12 }, acknowledge: { minHeight: 48, justifyContent: 'center' }, disabled: { opacity: 0.5 },
});
