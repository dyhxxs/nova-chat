import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText as Text, ThemedTextInput as TextInput } from '../components/ThemedText';
import { SettingsSection } from '../components/SettingsRow';
import { KeyboardAwareView } from '../components/KeyboardAwareView';
import { useAppTheme } from '../hooks/useAppTheme';
import { changeAccountPassword, GatewayApiError, listLoginSessions, revokeLoginSession, revokeOtherLoginSessions, type LoginSession } from '../services/gatewayApiClient';
import { useAppStore } from '../store/useAppStore';

type Confirmation = { kind: 'password' } | { kind: 'others' } | { kind: 'session'; session: LoginSession };
export function SecurityScreen() {
  const theme = useAppTheme();
  const serverUrl = useAppStore((state) => state.settings.serverUrl);
  const accessToken = useAppStore((state) => state.accessToken);
  const [sessions, setSessions] = useState<LoginSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const stillCurrent = useCallback(() => mounted.current && useAppStore.getState().accessToken === accessToken && useAppStore.getState().settings.serverUrl === serverUrl, [accessToken, serverUrl]);
  const reportError = useCallback((error: unknown) => {
    if (!stillCurrent()) return;
    const text = error instanceof GatewayApiError && error.status === 404
      ? '当前 Gateway 尚不支持账户安全管理，请管理员升级服务端后再试。'
      : error instanceof Error ? error.message : '操作失败，请重试。';
    setNotice({ text, error: true });
  }, [stillCurrent]);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const result = await listLoginSessions(serverUrl, accessToken, signal);
      if (stillCurrent() && !signal?.aborted) setSessions(result);
    } catch (error) { if (!signal?.aborted) reportError(error); }
    finally { if (stillCurrent() && !signal?.aborted) setLoading(false); }
  }, [accessToken, serverUrl, reportError, stillCurrent]);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const requestPasswordChange = () => {
    if (currentPassword.length < 8 || newPassword.length < 8 || newPassword.length > 200) { setNotice({ text: '请输入当前密码，新密码长度需要为 8–200 个字符。', error: true }); return; }
    if (newPassword !== repeatPassword) { setNotice({ text: '两次输入的新密码不一致。', error: true }); return; }
    if (currentPassword.normalize('NFKC') === newPassword.normalize('NFKC')) { setNotice({ text: '新密码不能与当前密码相同。', error: true }); return; }
    setNotice(undefined); setConfirmation({ kind: 'password' });
  };
  const confirm = async () => {
    if (!confirmation || busy) return;
    setBusy(true); setNotice(undefined);
    try {
      if (confirmation.kind === 'password') {
        await changeAccountPassword(serverUrl, accessToken, currentPassword, newPassword);
        if (!stillCurrent()) return;
        setCurrentPassword(''); setNewPassword(''); setRepeatPassword('');
        await useAppStore.getState().clearSession();
        return;
      }
      if (confirmation.kind === 'others') {
        const result = await revokeOtherLoginSessions(serverUrl, accessToken);
        if (!stillCurrent()) return;
        setNotice({ text: `已退出 ${result.revoked} 个其他登录会话。当前设备保持登录。` });
      } else {
        const result = await revokeLoginSession(serverUrl, accessToken, confirmation.session.id);
        if (!stillCurrent()) return;
        if (result.currentSessionRevoked) { await useAppStore.getState().clearSession(); return; }
        setNotice({ text: '已退出所选登录会话。' });
      }
      setConfirmation(undefined);
      await refresh();
    } catch (error) { reportError(error); }
    finally { if (mounted.current) setBusy(false); }
  };
  const button = (title: string, action: () => void, secondary = false, disabled = false) => <Pressable accessibilityRole="button" disabled={busy || disabled} onPress={action} style={[styles.button, { backgroundColor: secondary ? theme.colors.surfaceMuted : theme.colors.primary }, (busy || disabled) && styles.disabled]}>
    <Text style={[styles.buttonText, { color: secondary ? theme.colors.text : '#fff' }]}>{title}</Text>
  </Pressable>;
  return <KeyboardAwareView style={{ flex: 1, backgroundColor: theme.colors.background }}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <View style={[styles.hero, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name="shield-checkmark-outline" size={30} color={theme.colors.primary} />
        <Text style={[styles.title, { color: theme.colors.text }]}>账户安全</Text>
        <Text style={[styles.description, { color: theme.colors.textSecondary }]}>修改密码、查看有效登录会话，并退出不再使用或不认识的设备。</Text>
      </View>
      {!!notice && <Text accessibilityRole="alert" style={[styles.notice, { color: notice.error ? theme.colors.danger : theme.colors.success, borderColor: notice.error ? theme.colors.danger : theme.colors.success }]}>{notice.text}</Text>}
      {!!confirmation && <View style={[styles.confirm, { backgroundColor: theme.colors.primarySoft }]}>
        <Text style={[styles.confirmTitle, { color: theme.colors.text }]}>{confirmation.kind === 'password' ? '确认修改密码并退出所有设备？' : confirmation.kind === 'others' ? '退出所有其他登录会话？' : confirmation.session.current ? '退出当前设备？' : '退出所选登录会话？'}</Text>
        <Text style={[styles.description, { color: theme.colors.textSecondary }]}>{confirmation.kind === 'password' ? '修改成功后请使用新密码重新登录。本地对话会保留。' : '被退出的会话不能继续访问网关。'}相关会话的后台生成会停止，但已经发生的上游用量无法撤销。</Text>
        {button(busy ? '处理中…' : '确认执行', () => { void confirm(); })}
        {button('取消', () => setConfirmation(undefined), true)}
      </View>}
      <SettingsSection title="修改密码"><View style={styles.section}>
        {([
          { label: '当前密码', value: currentPassword, change: setCurrentPassword, autocomplete: 'current-password' },
          { label: '新密码', value: newPassword, change: setNewPassword, autocomplete: 'new-password' },
          { label: '确认新密码', value: repeatPassword, change: setRepeatPassword, autocomplete: 'new-password' },
        ] as const).map((field) => <View key={field.label} style={styles.field}>
          <Text style={[styles.label, { color: theme.colors.text }]}>{field.label}</Text>
          <TextInput accessibilityLabel={field.label} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete={field.autocomplete} maxLength={200} editable={!busy && !confirmation} value={field.value} onChangeText={field.change} placeholder={field.label === '新密码' ? '至少 8 个字符，建议使用长且唯一的密码' : field.label} placeholderTextColor={theme.colors.textTertiary} style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]} />
        </View>)}
        <Text style={[styles.description, { color: theme.colors.textSecondary }]}>修改密码会撤销全部登录会话，包括当前设备。密码不写入手机本地存储。</Text>
        {button('修改密码', requestPasswordChange, false, !!confirmation)}
      </View></SettingsSection>
      <SettingsSection title={`有效登录会话${sessions.length ? ` · ${sessions.length}` : ''}`}><View style={styles.section}>
        <Text style={[styles.description, { color: theme.colors.textSecondary }]}>同一设备重复登录可能有多个会话。设备标识由客户端提供，不能作为设备身份的可信证明。</Text>
        {loading ? <ActivityIndicator accessibilityLabel="正在加载登录会话" color={theme.colors.primary} /> : sessions.length === 0 ? <Text style={{ color: theme.colors.textSecondary }}>暂无可显示的会话，请刷新或检查网关版本。</Text> : sessions.map((session) => <View key={session.id} style={[styles.session, { borderColor: theme.colors.border }]}>
          <View style={styles.sessionHeading}><Ionicons name={session.current ? 'phone-portrait-outline' : 'laptop-outline'} size={20} color={theme.colors.primary} /><Text style={[styles.label, { color: theme.colors.text }]}>{session.current ? '当前登录会话' : '其他登录会话'}</Text></View>
          <Text selectable style={[styles.description, { color: theme.colors.textSecondary }]}>设备：{session.deviceId}</Text>
          <Text style={[styles.meta, { color: theme.colors.textTertiary }]}>登录：{new Date(session.createdAt).toLocaleString('zh-CN')}{'\n'}到期：{new Date(session.expiresAt).toLocaleString('zh-CN')}</Text>
          {button(session.current ? '退出当前会话' : '退出此会话', () => setConfirmation({ kind: 'session', session }), true, !!confirmation)}
        </View>)}
        {button('刷新登录会话', () => { setNotice(undefined); void refresh(); }, true, loading || !!confirmation)}
        {sessions.some((item) => !item.current) && button('退出全部其他会话', () => setConfirmation({ kind: 'others' }), false, !!confirmation)}
      </View></SettingsSection>
    </ScrollView>
  </KeyboardAwareView>;
}
const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 }, hero: { padding: 20, borderRadius: 22, gap: 10, marginBottom: 22 }, title: { fontSize: 23, fontWeight: '800' },
  description: { fontSize: 13, lineHeight: 21 }, section: { padding: 16, gap: 14 }, field: { gap: 8 }, label: { fontSize: 14, fontWeight: '700' },
  input: { height: 48, paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, fontSize: 14 }, button: { minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', padding: 10 }, buttonText: { fontSize: 14, fontWeight: '700' }, disabled: { opacity: 0.5 },
  notice: { padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 16, lineHeight: 20 }, confirm: { padding: 16, borderRadius: 18, gap: 12, marginBottom: 18 }, confirmTitle: { fontSize: 16, fontWeight: '700' },
  session: { paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 }, sessionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 }, meta: { fontSize: 11, lineHeight: 18 },
});
