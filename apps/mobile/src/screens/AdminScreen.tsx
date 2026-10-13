import { CompanionProviderSection } from '../components/CompanionProviderSection';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { ThemedTextInput as TextInput } from '../components/ThemedText';
import { ThemedText as Text } from '../components/ThemedText';
import { Ionicons } from '@expo/vector-icons';
import { emptyProviderForm, providerFormFrom, providerFormInput, type ProviderForm } from '../lib/providerForm';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { KeyboardAwareView } from '../components/KeyboardAwareView';
import { useAppTheme } from '../hooks/useAppTheme';
import { safeDisplayName } from '../lib/userDisplayName';
import { friendlyNetworkError } from '../lib/errorMessage';
import {
  getProviderSettings, listUsers, saveProviderSettings, testProvider, updateUser,
} from '../services/gatewayApiClient';
import { useAppStore } from '../store/useAppStore';
import type { RootStackParamList, UserProfile } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Admin'>;

function Choice<T extends string>({ value, selected, label, onPress }: { value: T; selected: boolean; label: string; onPress: (value: T) => void }) {
  const theme = useAppTheme();
  return <Pressable onPress={() => onPress(value)} style={[styles.choice, { borderColor: selected ? theme.colors.primary : theme.colors.border, backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surfaceMuted }]}><Text style={[styles.choiceText, { color: selected ? theme.colors.primary : theme.colors.textSecondary }]}>{label}</Text></Pressable>;
}

export function AdminScreen({ navigation }: Props) {
  const theme = useAppTheme();
  const subscribeBlur = useCallback((callback: () => void) => navigation.addListener('blur', callback), [navigation]);
  const serverUrl = useAppStore((state) => state.settings.serverUrl);
  const accessToken = useAppStore((state) => state.accessToken);
  const currentUser = useAppStore((state) => state.user);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const [form, setForm] = useState<ProviderForm>(emptyProviderForm);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<string>();
  const mounted = useRef(false);
  const operation = useRef(0);
  const isCurrentAdmin = useCallback(() => {
    const state = useAppStore.getState();
    return mounted.current && state.user?.role === 'admin' && state.user.id === currentUser?.id
      && state.accessToken === accessToken && state.settings.serverUrl === serverUrl;
  }, [accessToken, currentUser?.id, serverUrl]);

  useEffect(() => {
    mounted.current = true;
    const clearDraft = () => {
      operation.current++;
      setForm((item) => ({ ...item, apiBaseUrl: '', apiKey: '' }));
      setStatus(undefined);
      setBusy(false);
    };
    const subscription = AppState.addEventListener('change', (state) => { if (state !== 'active') clearDraft(); });
    const unsubscribe = navigation.addListener('blur', clearDraft);
    return () => { mounted.current = false; operation.current++; subscription.remove(); unsubscribe(); };
  }, [navigation]);

  const load = useCallback(async () => {
    if (!isCurrentAdmin()) return;
    const ticket = ++operation.current;
    const [provider, userList] = await Promise.all([
      getProviderSettings(serverUrl, accessToken), listUsers(serverUrl, accessToken),
    ]);
    if (!isCurrentAdmin() || ticket !== operation.current) return;
    setForm(providerFormFrom(provider));
    setUsers(userList);
  }, [accessToken, isCurrentAdmin, serverUrl]);

  useEffect(() => {
    if (currentUser?.role !== 'admin') { navigation.goBack(); return; }
    setForm(emptyProviderForm); setUsers([]); setStatus(undefined); setBusy(true);
    void load().catch((error) => { if (isCurrentAdmin()) setStatus(friendlyNetworkError(error)); }).finally(() => { if (isCurrentAdmin()) setBusy(false); });
  }, [currentUser?.role, isCurrentAdmin, load, navigation]);

  const refresh = async () => {
    setRefreshing(true);
    try { await load(); } catch (error) { setStatus(friendlyNetworkError(error)); }
    finally { setRefreshing(false); }
  };

  const save = async () => {
    if (!isCurrentAdmin() || busy) return;
    const ticket = ++operation.current;
    setBusy(true); setStatus(undefined);
    try {
      const saved = await saveProviderSettings(serverUrl, accessToken, providerFormInput(form));
      if (!isCurrentAdmin() || ticket !== operation.current) return;
      setForm(providerFormFrom(saved));
      updateSettings({ model: saved.defaultModel });
      setStatus('配置已保存。第三方地址和密钥均已隐藏，管理员也无法查看；留空可继续使用已保存配置。');
    } catch (error) { if (isCurrentAdmin() && ticket === operation.current) setStatus(friendlyNetworkError(error)); }
    finally { if (isCurrentAdmin() && ticket === operation.current) setBusy(false); }
  };

  const test = async () => {
    if (!isCurrentAdmin() || busy) return;
    const ticket = ++operation.current;
    setBusy(true); setStatus(undefined);
    try {
      const input = providerFormInput(form);
      const models = await testProvider(serverUrl, accessToken, input);
      if (!isCurrentAdmin() || ticket !== operation.current) return;
      if (!models.length) { setStatus('服务未返回可用模型，配置未保存。'); return; }
      const defaultModel = models.includes(input.defaultModel) ? input.defaultModel : models[0]!;
      const saved = await saveProviderSettings(serverUrl, accessToken, { ...input, defaultModel, allowedModels: models });
      if (!isCurrentAdmin() || ticket !== operation.current) return;
      setForm(providerFormFrom(saved));
      updateSettings({ model: saved.defaultModel });
      setStatus(`连接成功，已保存 ${models.length} 个模型；第三方地址和密钥均已隐藏，管理员也无法查看。`);
    } catch (error) { if (isCurrentAdmin() && ticket === operation.current) setStatus(friendlyNetworkError(error)); }
    finally { if (isCurrentAdmin() && ticket === operation.current) setBusy(false); }
  };

  const changeUser = async (user: UserProfile, patch: Partial<Pick<UserProfile, 'role' | 'disabled'>>) => {
    try {
      const updated = await updateUser(serverUrl, accessToken, user.id, patch);
      setUsers((items) => items.map((item) => item.id === updated.id ? updated : item));
    } catch (error) { Alert.alert('更新失败', friendlyNetworkError(error)); }
  };

  if (busy && !users.length) return <View style={styles.center}><ActivityIndicator color={theme.colors.primary} /></View>;
  return (
    <KeyboardAwareView style={[styles.root, { backgroundColor: theme.colors.background }]}>
    <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.colors.primary} />}>
      <CompanionProviderSection onBlur={subscribeBlur} />
      <Text style={[styles.intro, { color: theme.colors.textSecondary }]}>第三方地址和密钥只写入网关，保存后不再回显，管理员也无法查看原值或密钥尾号。已配置时留空即可保留；更换地址必须同时填写新的密钥。</Text>
      <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <View style={styles.cardTitleRow}><Ionicons name="server-outline" size={20} color={theme.colors.primary} /><Text style={[styles.cardTitle, { color: theme.colors.text }]}>普通聊天模型服务</Text></View>
        <Text style={[styles.label, { color: theme.colors.text }]}>API Base URL</Text>
        <TextInput accessibilityLabel="第三方地址（只写）" editable={!busy && !refreshing} secureTextEntry autoComplete="off" textContentType="none" importantForAutofill="no" value={form.apiBaseUrl} onChangeText={(apiBaseUrl) => setForm((item) => ({ ...item, apiBaseUrl }))} autoCapitalize="none" autoCorrect={false} placeholder={form.apiBaseUrlSet ? '已配置并隐藏；留空保持不变' : '填写第三方服务地址'} placeholderTextColor={theme.colors.textTertiary} style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }]} />
        <Text style={[styles.label, { color: theme.colors.text }]}>API Key</Text>
        <TextInput accessibilityLabel="第三方密钥（只写）" editable={!busy && !refreshing} autoCorrect={false} autoComplete="off" textContentType="none" importantForAutofill="no" value={form.apiKey} onChangeText={(apiKey) => setForm((item) => ({ ...item, apiKey }))} secureTextEntry autoCapitalize="none" placeholder={form.apiKeySet ? '已配置并隐藏；留空保持不变' : '填写服务商 API Key'} placeholderTextColor={theme.colors.textTertiary} style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }]} />
        <Text style={[styles.label, { color: theme.colors.text }]}>协议</Text>
        <View style={styles.choices}><Choice value="responses" label="Responses（文件与工具）" selected={form.apiMode === 'responses'} onPress={(apiMode) => setForm((item) => ({ ...item, apiMode }))} /><Choice value="chat-completions" label="Chat Completions" selected={form.apiMode === 'chat-completions'} onPress={(apiMode) => setForm((item) => ({ ...item, apiMode }))} /></View>
        <Text style={[styles.label, { color: theme.colors.text }]}>鉴权方式</Text>
        <View style={styles.choices}>{(['bearer', 'api-key', 'none'] as const).map((value) => <Choice key={value} value={value} label={value === 'bearer' ? 'Bearer' : value === 'api-key' ? 'api-key' : '无鉴权'} selected={form.authMode === value} onPress={(authMode) => setForm((item) => ({ ...item, authMode }))} />)}</View>
        <Text style={[styles.label, { color: theme.colors.text }]}>默认模型</Text>
        <TextInput value={form.defaultModel} onChangeText={(defaultModel) => setForm((item) => ({ ...item, defaultModel }))} autoCapitalize="none" autoCorrect={false} placeholder="gpt-5.6-sol" placeholderTextColor={theme.colors.textTertiary} style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }]} />
        <Text style={[styles.label, { color: theme.colors.text }]}>允许模型（逗号分隔，可手动调整）</Text>
        <TextInput value={form.allowedModels} onChangeText={(allowedModels) => setForm((item) => ({ ...item, allowedModels }))} multiline autoCapitalize="none" autoCorrect={false} placeholder="gpt-5.6-sol, gpt-5.6-terra" placeholderTextColor={theme.colors.textTertiary} style={[styles.input, styles.multiline, { color: theme.colors.text, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }]} />
        {!!status && <Text style={[styles.status, { color: theme.colors.textSecondary }]}>{status}</Text>}
        <View style={styles.buttons}><Pressable onPress={() => void save()} disabled={busy} style={[styles.primary, { backgroundColor: theme.colors.primary }]}><Ionicons name="save-outline" size={17} color="#fff" /><Text style={styles.primaryText}>保存</Text></Pressable><Pressable onPress={() => void test()} disabled={busy} style={[styles.secondary, { borderColor: theme.colors.border }]}><Ionicons name="pulse-outline" size={17} color={theme.colors.text} /><Text style={[styles.secondaryText, { color: theme.colors.text }]}>获取模型</Text></Pressable></View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <View style={styles.cardTitleRow}><Ionicons name="people-outline" size={20} color={theme.colors.primary} /><Text style={[styles.cardTitle, { color: theme.colors.text }]}>用户管理</Text><Text style={[styles.count, { color: theme.colors.textTertiary }]}>{users.length} 人</Text></View>
        {users.map((user, index) => <View key={user.id} style={[styles.userRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }]}>
          <View style={styles.userInfo}><Text style={[styles.userName, { color: theme.colors.text }]}>{safeDisplayName(user)}{user.id === currentUser?.id ? '（你）' : ''}</Text><Text style={[styles.userEmail, { color: theme.colors.textSecondary }]}>{user.email} · {user.role === 'admin' ? '管理员' : '用户'}</Text></View>
          <Pressable onPress={() => void changeUser(user, { role: user.role === 'admin' ? 'user' : 'admin' })} style={[styles.roleButton, { borderColor: theme.colors.border }]}><Text style={[styles.roleText, { color: theme.colors.textSecondary }]}>{user.role === 'admin' ? '降为用户' : '设为管理员'}</Text></Pressable>
          <Switch value={!user.disabled} onValueChange={(enabled) => void changeUser(user, { disabled: !enabled })} trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.primarySoft }} thumbColor={!user.disabled ? theme.colors.primary : theme.colors.textTertiary} />
        </View>)}
      </View>
      <Text style={[styles.footer, { color: theme.colors.textTertiary }]}>网页搜索、代码解释器和附件读取能力，取决于第三方接口的兼容程度。</Text>
    </ScrollView>
    </KeyboardAwareView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 }, scroll: { flex: 1 },
  container: { padding: 16, paddingBottom: 48, gap: 16 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, intro: { fontSize: 13, lineHeight: 20 },
  card: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 15 }, cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }, cardTitle: { fontSize: 17, fontWeight: '800' }, count: { marginLeft: 'auto', fontSize: 12 },
  label: { fontSize: 13, fontWeight: '700', marginTop: 12, marginBottom: 7 }, input: { minHeight: 44, borderWidth: StyleSheet.hairlineWidth, borderRadius: 11, paddingHorizontal: 12, fontSize: 14 }, multiline: { height: 76, paddingTop: 10, textAlignVertical: 'top' }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choice: { minHeight: 36, justifyContent: 'center', borderRadius: 10, borderWidth: 1, paddingHorizontal: 11 }, choiceText: { fontSize: 12, fontWeight: '700' },
  status: { fontSize: 12, lineHeight: 18, marginTop: 12 }, buttons: { flexDirection: 'row', gap: 9, marginTop: 14 }, primary: { flex: 1, height: 44, borderRadius: 11, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' }, primaryText: { color: '#fff', fontWeight: '800', fontSize: 13 }, secondary: { flex: 1.3, height: 44, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' }, secondaryText: { fontWeight: '700', fontSize: 12 },
  userRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 8 }, userInfo: { flex: 1 }, userName: { fontSize: 14, fontWeight: '700' }, userEmail: { fontSize: 11, marginTop: 3 }, roleButton: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 7 }, roleText: { fontSize: 10, fontWeight: '700' }, footer: { fontSize: 11, lineHeight: 17, textAlign: 'center', paddingHorizontal: 14 },
});
