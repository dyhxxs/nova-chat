import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ThemedTextInput as TextInput } from '../components/ThemedText';
import { ThemedText as Text } from '../components/ThemedText';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { KeyboardAwareView } from '../components/KeyboardAwareView';
import { useAppTheme } from '../hooks/useAppTheme';
import { normalizeServerUrl } from '../lib/connection';
import { selectGatewayModel } from '../lib/modelSelection';
import { bootstrapAdmin, fetchGatewayModels, fetchSetupStatus, GatewayApiError, login, register, type SetupStatus } from '../services/gatewayApiClient';
import { useAppStore } from '../store/useAppStore';

type Mode = 'login' | 'register' | 'bootstrap';
const BUILT_IN_GATEWAY_URL = process.env.EXPO_PUBLIC_GATEWAY_URL?.trim() ?? '';

export function LoginScreen() {
  const theme = useAppTheme();
  const settings = useAppStore((state) => state.settings);
  const gatewayChanged = useAppStore((state) => state.gatewayChanged);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const setSession = useAppStore((state) => state.setSession);
  const deviceId = useAppStore((state) => state.deviceId);
  const [serverUrl, setServerUrl] = useState(BUILT_IN_GATEWAY_URL || settings.serverUrl);
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [setup, setSetup] = useState<SetupStatus>();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [bootstrapToken, setBootstrapToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();

  const inspectServer = async (value = serverUrl) => {
    const normalized = normalizeServerUrl(value);
    if (!normalized) {
      setSetup(undefined);
      setMessage({ ok: false, text: '请先配置网关地址。' });
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      const status = await fetchSetupStatus(normalized);
      setServerUrl(normalized);
      updateSettings({ serverUrl: normalized });
      setSetup(status);
      setMode((current) => status.needsBootstrap ? 'bootstrap' : current === 'register' && status.registrationEnabled ? 'register' : 'login');
      if (!BUILT_IN_GATEWAY_URL) setShowServerSettings(false);
      setMessage({ ok: true, text: status.needsBootstrap ? '网关已连接，需要创建首位管理员。初始化口令由服务器所有者提供，不是 SSH 或宝塔密码。' : status.providerConfigured === false ? '服务器已连接，但管理员尚未配置模型服务。请联系管理员完成配置。' : '服务器已连接，可以登录或注册。' });
    } catch (error) {
      setSetup(undefined);
      setMessage({ ok: false, text: error instanceof Error ? error.message : '无法连接网关。' });
    } finally { setBusy(false); }
  };

  useEffect(() => {
    const initialServerUrl = BUILT_IN_GATEWAY_URL || settings.serverUrl;
    if (initialServerUrl) void inspectServer(initialServerUrl);
    else setMessage({ ok: false, text: '请先打开“服务器连接设置”配置网关地址。' });
  }, []);

  const submit = async () => {
    const normalized = normalizeServerUrl(BUILT_IN_GATEWAY_URL || serverUrl || settings.serverUrl);
    if (!setup) {
      setMessage({ ok: false, text: '服务器尚未连接，请点击“重新连接服务器”。' });
      return;
    }
    if (!normalized || !email.trim() || !password) {
      setMessage({ ok: false, text: '请先配置网关地址、邮箱和密码。' });
      return;
    }
    if (password.length < 8) {
      setMessage({ ok: false, text: '密码至少需要 8 位。' });
      return;
    }
    if (mode === 'bootstrap' && !displayName.trim()) {
      setMessage({ ok: false, text: '请填写显示名称。' });
      return;
    }
    if (mode !== 'login' && password !== confirmPassword) {
      setMessage({ ok: false, text: '两次输入的密码不一致。' });
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      const result = mode === 'bootstrap'
        ? await bootstrapAdmin(normalized, { email, password, displayName, deviceId, bootstrapToken })
        : mode === 'register'
          ? await register(normalized, { email: email.trim(), password, displayName: '新用户', deviceId })
          : await login(normalized, { email, password, deviceId });
      let model = useAppStore.getState().settings.model;
      try {
        const catalog = await fetchGatewayModels(normalized, result.accessToken);
        model = selectGatewayModel(model, catalog.models, catalog.defaultModel);
      } catch {
        // Authentication succeeded; the gateway also performs a safe server-side model fallback.
      }
      await setSession(result.accessToken, result.user, normalized);
      // setSession resets account-scoped local state when the account changes.
      // Apply the login target/model after that reset so a previous account's
      // settings cannot leak into the newly authenticated account.
      updateSettings({ serverUrl: normalized, model });
    } catch (error) {
      const text = error instanceof GatewayApiError ? error.message : error instanceof Error ? error.message : '登录失败。';
      setMessage({ ok: false, text });
    } finally { setBusy(false); }
  };

  const allowRegister = setup?.registrationEnabled && !setup.needsBootstrap;
  return (
    <KeyboardAwareView style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={[styles.logo, { backgroundColor: theme.colors.primary }]}>
          <Ionicons name="chatbubbles-outline" size={32} color="#FFFFFF" />
        </View>
        <Text style={[styles.kicker, { color: theme.colors.primary, fontFamily: theme.fonts.bold }]}>A PLACE FOR YOUR THOUGHTS</Text>
        <Text style={[styles.title, { color: theme.colors.text, fontFamily: theme.fonts.bold }]}>Nova</Text>
        <Text style={[styles.version, { color: theme.colors.textTertiary }]}>版本 {Constants.expoConfig?.version ?? '开发版'}</Text>
        <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>聊聊生活，也把事情做好。</Text>
        <View style={styles.trustRow}>
          {['日常交流', '专属陪伴', '随时记录'].map((item) => (
            <View key={item} style={[styles.trustPill, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]}>
              <Ionicons name="checkmark-circle" size={13} color={theme.colors.success} />
              <Text style={[styles.trustText, { color: theme.colors.textSecondary }]}>{item}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          {gatewayChanged && <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>已切换到新版服务器，请重新登录。旧服务器的本地记录仍保留，不会自动混入新账号。</Text>}
          {showServerSettings && !BUILT_IN_GATEWAY_URL ? <>
            <Text style={[styles.label, { color: theme.colors.text }]}>服务器连接设置</Text>
            <View style={styles.serverRow}>
              <TextInput value={serverUrl} onChangeText={setServerUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://your-gateway.example.com" placeholderTextColor={theme.colors.textTertiary} style={[styles.input, styles.serverInput, { color: theme.colors.text, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }]} />
              <Pressable onPress={() => void inspectServer()} disabled={busy} style={[styles.testButton, { backgroundColor: theme.colors.primary }, busy && styles.disabled]}><Text style={styles.testText}>连接</Text></Pressable>
            </View>
            <Text style={[styles.hint, { color: theme.colors.textTertiary }]}>仅用于局域网开发或切换到另一套自建 Gateway；正式版本通常会在构建时内置地址。</Text>
          </> : <View style={[styles.gatewayNotice, { backgroundColor: theme.colors.primarySoft }]}><Ionicons name="shield-checkmark-outline" size={18} color={theme.colors.primary} /><Text style={[styles.gatewayNoticeText, { color: theme.colors.textSecondary }]}>{BUILT_IN_GATEWAY_URL ? (BUILT_IN_GATEWAY_URL.includes('.trycloudflare.com') ? '测试服务已预设；管理员电脑需保持在线' : '服务器已预设，无需手动配置') : '请使用下方“服务器连接设置”配置 Gateway'}</Text></View>}

          <View style={[styles.tabs, { backgroundColor: theme.colors.surfaceMuted }]}>
            {(['login', ...(allowRegister ? ['register'] : []), ...(setup?.needsBootstrap ? ['bootstrap'] : [])] as Mode[]).map((item) => (
              <Pressable key={item} onPress={() => { setMode(item); setMessage(undefined); }} disabled={busy} style={[styles.tab, mode === item && { backgroundColor: theme.colors.surface }]}>
                <Text style={[styles.tabText, { color: mode === item ? theme.colors.text : theme.colors.textSecondary }]}>{item === 'login' ? '登录' : item === 'register' ? '注册' : '初始化管理员'}</Text>
              </Pressable>
            ))}
          </View>

          {mode === 'bootstrap' && <><Text style={[styles.label, { color: theme.colors.text }]}>显示名称</Text><TextInput value={displayName} onChangeText={setDisplayName} maxLength={80} placeholder="你的名字" placeholderTextColor={theme.colors.textTertiary} style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }]} /></>}
          <Text style={[styles.label, { color: theme.colors.text }]}>邮箱</Text>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="name@example.com" placeholderTextColor={theme.colors.textTertiary} style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }]} />
          <Text style={[styles.label, { color: theme.colors.text }]}>密码</Text>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" placeholder="至少 8 位" placeholderTextColor={theme.colors.textTertiary} style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }]} />
          {mode !== 'login' && <><Text style={[styles.label, { color: theme.colors.text }]}>确认密码</Text><TextInput value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry autoCapitalize="none" placeholder="再次输入密码" placeholderTextColor={theme.colors.textTertiary} style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }]} /></>}
          {mode === 'bootstrap' && <><Text style={[styles.label, { color: theme.colors.text }]}>管理员初始化口令</Text><TextInput value={bootstrapToken} onChangeText={setBootstrapToken} secureTextEntry autoCapitalize="none" placeholder={setup?.bootstrapTokenRequired ? '由服务器部署者提供' : '开发模式可留空'} placeholderTextColor={theme.colors.textTertiary} style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }]} /></>}

          {!!message && <Text style={[styles.message, { color: message.ok ? theme.colors.success : theme.colors.danger }]}>{message.text}</Text>}
          <Pressable onPress={() => void submit()} disabled={busy || !setup} style={[styles.submit, { backgroundColor: theme.colors.primary }, busy && styles.disabled]}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{mode === 'login' ? '登录' : mode === 'register' ? '创建账户' : '创建管理员'}</Text>}
          </Pressable>
        </View>

        <Pressable accessibilityRole="button" onPress={() => void inspectServer()} disabled={busy} style={styles.serverSettingsLink}><Ionicons name="refresh-outline" size={16} color={theme.colors.primary} /><Text style={[styles.serverSettingsText, { color: theme.colors.primary }]}>{busy ? '正在连接服务器…' : '重新连接服务器'}</Text></Pressable>

        {!BUILT_IN_GATEWAY_URL && <Pressable onPress={() => setShowServerSettings((value) => !value)} style={styles.serverSettingsLink}><Ionicons name="server-outline" size={16} color={theme.colors.textTertiary} /><Text style={[styles.serverSettingsText, { color: theme.colors.textTertiary }]}>{showServerSettings ? '收起服务器连接设置' : '服务器连接设置'}</Text></Pressable>}
      </ScrollView>
    </KeyboardAwareView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 }, scroll: { flex: 1 }, container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 22, paddingVertical: 44 },
  logo: { width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center', shadowColor: '#356859', shadowOpacity: 0.04, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 5 },
  kicker: { fontSize: 10, letterSpacing: 1.8, marginTop: 17 }, title: { fontSize: 30, fontWeight: '800', marginTop: 5 }, version: { fontSize: 12, marginTop: 5 }, subtitle: { fontSize: 13, textAlign: 'center', marginTop: 7, marginBottom: 15 },
  trustRow: { width: '100%', maxWidth: 480, flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 7, marginBottom: 9 }, trustPill: { minHeight: 28, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 4 }, trustText: { fontSize: 10 },
  card: { width: '100%', maxWidth: 480, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, padding: 18 }, label: { fontSize: 13, fontWeight: '700', marginTop: 12, marginBottom: 7 },
  input: { height: 46, borderWidth: StyleSheet.hairlineWidth, borderRadius: 11, paddingHorizontal: 12, fontSize: 14 }, serverRow: { flexDirection: 'row', gap: 8 }, serverInput: { flex: 1 }, testButton: { width: 62, height: 46, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, testText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  gatewayNotice: { minHeight: 42, borderRadius: 11, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, gatewayNoticeText: { flex: 1, fontSize: 12, lineHeight: 17 }, hint: { fontSize: 11, lineHeight: 16, marginTop: 7 }, tabs: { flexDirection: 'row', padding: 3, borderRadius: 11, marginTop: 18 }, tab: { flex: 1, minHeight: 35, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }, tabText: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
  message: { fontSize: 12, lineHeight: 17, marginTop: 13 }, submit: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 16 }, submitText: { color: '#fff', fontSize: 15, fontWeight: '800' }, disabled: { opacity: 0.6 }, serverSettingsLink: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 18, padding: 8 }, serverSettingsText: { fontSize: 12 },
});
