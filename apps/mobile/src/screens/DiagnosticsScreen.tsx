import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText as Text } from '../components/ThemedText';
import { useAppTheme } from '../hooks/useAppTheme';
import { formatDiagnosticReport, runConnectionDiagnostics, type DiagnosticReport } from '../services/connectionDiagnostics';
import { useAppStore } from '../store/useAppStore';

export function DiagnosticsScreen() {
  const theme = useAppTheme();
  const controller = useRef<AbortController | undefined>(undefined);
  const [report, setReport] = useState<DiagnosticReport>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => () => { controller.current?.abort(); controller.current = undefined; }, []);
  const run = async () => {
    if (controller.current) return;
    const abort = new AbortController(); controller.current = abort;
    const state = useAppStore.getState();
    setBusy(true); setReport(undefined); setNotice('');
    try {
      const result = await runConnectionDiagnostics({ serverUrl: state.settings.serverUrl, accessToken: state.accessToken, deviceId: state.deviceId, signal: abort.signal });
      if (controller.current !== abort || useAppStore.getState().accessToken !== state.accessToken || useAppStore.getState().settings.serverUrl !== state.settings.serverUrl) return;
      setReport(result);
    } catch { if (controller.current === abort) setNotice('诊断未完成，请稍后重试。'); }
    finally { if (controller.current === abort) { controller.current = undefined; setBusy(false); } }
  };
  const copy = async () => {
    if (!report) return;
    try { await Clipboard.setStringAsync(formatDiagnosticReport(report, { version: Constants.expoConfig?.version ?? 'unknown', platform: Platform.OS })); setNotice('已复制脱敏报告，不含服务器地址、账号、令牌和聊天内容。'); }
    catch { setNotice('无法访问剪贴板，请检查权限后重试。'); }
  };
  return <ScrollView style={{ backgroundColor: theme.colors.background }} contentContainerStyle={styles.content}>
    <View style={[styles.hero, { backgroundColor: theme.colors.primarySoft }]}><Ionicons name="pulse-outline" size={32} color={theme.colors.primary} /><Text style={[styles.title, { color: theme.colors.text }]}>连接问题，一步步定位</Text><Text style={[styles.description, { color: theme.colors.textSecondary }]}>依次检查地址、网关、登录与模型目录、实时连接。仅连接你配置的 Gateway，不发送对话、不上传文件、不发起模型生成。</Text></View>
    <Pressable accessibilityRole="button" onPress={() => busy ? controller.current?.abort() : void run()} style={[styles.button, { backgroundColor: busy ? theme.colors.surfaceMuted : theme.colors.primary }]}>{busy && <ActivityIndicator color={theme.colors.primary} />}<Text style={{ color: busy ? theme.colors.text : '#fff', fontWeight: '700' }}>{busy ? '取消检查' : '开始连接检查'}</Text></Pressable>
    <Text style={[styles.description, { color: theme.colors.textTertiary }]}>每项最多等待约 6 秒。HTTP 健康检查通过并不表示上游 API Key、模型权限、额度或附件处理可用；这些需要管理员另行核实。</Text>
    {report?.steps.map((step) => {
      const color = step.status === 'ok' ? theme.colors.success : step.status === 'error' ? theme.colors.danger : theme.colors.textSecondary;
      return <View key={step.id} style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}><View style={styles.row}><Ionicons name={step.status === 'ok' ? 'checkmark-circle-outline' : step.status === 'error' ? 'close-circle-outline' : 'information-circle-outline'} size={23} color={color} /><Text style={[styles.stepTitle, { color: theme.colors.text }]}>{step.label}</Text><Text style={{ color, fontSize: 11 }}>{step.durationMs} ms</Text></View><Text selectable style={[styles.description, { color: theme.colors.textSecondary }]}>{step.detail}</Text></View>;
    })}
    {report && <Pressable accessibilityRole="button" onPress={() => { void copy(); }} style={[styles.button, { backgroundColor: theme.colors.surfaceMuted }]}><Ionicons name="copy-outline" size={18} color={theme.colors.text} /><Text style={{ color: theme.colors.text, fontWeight: '700' }}>复制脱敏诊断报告</Text></Pressable>}
    {!!notice && <Text accessibilityRole="alert" style={[styles.description, { color: theme.colors.primary }]}>{notice}</Text>}
    <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}><Text style={[styles.stepTitle, { color: theme.colors.text }]}>常见排查顺序</Text><Text style={[styles.description, { color: theme.colors.textSecondary }]}>1. 地址错误：确认根地址和代理路径，不要填写模型 API 地址。{'\n'}2. 网关不可达：检查设备网络、HTTPS 证书、隧道或服务器状态。{'\n'}3. 登录失败：重登；旧版网关可能需要更新。{'\n'}4. 实时握手失败：检查代理是否支持 WebSocket Upgrade。{'\n'}5. 全部通过但生成失败：把生成错误与脱敏报告交给管理员，不要发送密码或 API Key。</Text></View>
  </ScrollView>;
}
const styles = StyleSheet.create({ content: { padding: 16, paddingBottom: 40, gap: 14 }, hero: { borderRadius: 22, padding: 20, gap: 12 }, title: { fontSize: 24, fontWeight: '800' }, description: { fontSize: 13, lineHeight: 22 }, button: { minHeight: 48, padding: 14, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }, card: { padding: 16, borderRadius: 16, borderWidth: 1, gap: 10 }, row: { flexDirection: 'row', alignItems: 'center', gap: 8 }, stepTitle: { flex: 1, fontSize: 15, fontWeight: '700' } });
