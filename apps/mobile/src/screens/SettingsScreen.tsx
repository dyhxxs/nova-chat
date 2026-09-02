import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { ReasoningEffort, Verbosity } from '@nova-chat/protocol';
import { KeyboardAwareView } from '../components/KeyboardAwareView';
import { ModelPickerModal } from '../components/ModelPickerModal';
import { SettingsLink, SettingsSection } from '../components/SettingsRow';
import { UserAvatar } from '../components/UserAvatar';
import { useAppTheme } from '../hooks/useAppTheme';
import { friendlyNetworkError } from '../lib/errorMessage';
import { selectGatewayModel } from '../lib/modelSelection';
import { safeDisplayName } from '../lib/userDisplayName';
import { fetchGatewayModels, logout } from '../services/gatewayApiClient';
import { useAppStore } from '../store/useAppStore';
import type { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;
const BUILT_IN_GATEWAY_URL = process.env.EXPO_PUBLIC_GATEWAY_URL?.trim() ?? '';
const efforts: { value: ReasoningEffort; label: string }[] = [
  { value: 'none', label: '无' }, { value: 'low', label: '低' }, { value: 'medium', label: '中' },
  { value: 'high', label: '高' }, { value: 'xhigh', label: '极高' },
];
const verbosities: { value: Verbosity; label: string }[] = [
  { value: 'low', label: '简洁' }, { value: 'medium', label: '适中' }, { value: 'high', label: '详细' },
];

function Chip<T extends string>({ value, selected, label, onPress }: { value: T; selected: boolean; label: string; onPress: (value: T) => void }) {
  const theme = useAppTheme();
  return <Pressable onPress={() => onPress(value)} style={[styles.chip, { backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surfaceMuted, borderColor: selected ? theme.colors.primary : 'transparent' }]}><Text style={[styles.chipText, { color: selected ? theme.colors.primary : theme.colors.textSecondary }]}>{label}</Text></Pressable>;
}

export function SettingsScreen({ navigation }: Props) {
  const theme = useAppTheme();
  const settings = useAppStore((state) => state.settings);
  const update = useAppStore((state) => state.updateSettings);
  const user = useAppStore((state) => state.user);
  const accessToken = useAppStore((state) => state.accessToken);
  const clearSession = useAppStore((state) => state.clearSession);
  const clearConversations = useAppStore((state) => state.clearConversations);
  const setConnectionStatus = useAppStore((state) => state.setConnectionStatus);
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string }>();

  const loadModels = async () => {
    if (!settings.serverUrl.trim() || !accessToken) {
      setStatus({ ok: false, text: '当前没有可用的 Gateway 会话。' });
      setConnectionStatus('offline');
      return;
    }
    setBusy(true); setStatus(undefined); setConnectionStatus('checking');
    try {
      const result = await fetchGatewayModels(settings.serverUrl, accessToken);
      setModels(result.models);
      const selectedModel = selectGatewayModel(settings.model, result.models, result.defaultModel);
      if (selectedModel !== settings.model) update({ model: selectedModel });
      setStatus({ ok: true, text: '连接成功，获取到 ' + result.models.length + ' 个可用模型。' });
      setConnectionStatus('online');
    } catch (error) {
      setStatus({ ok: false, text: friendlyNetworkError(error) });
      setConnectionStatus('offline');
    } finally { setBusy(false); }
  };

  const signOut = () => Alert.alert('退出登录', '退出后本地对话仍会保留。', [
    { text: '取消', style: 'cancel' },
    { text: '退出', style: 'destructive', onPress: () => { void logout(settings.serverUrl, accessToken).catch(() => undefined).finally(() => clearSession()); } },
  ]);
  const changeServer = () => Alert.alert('更换服务器', '将退出当前账户并返回登录页，设备上的本地对话不会被删除。', [
    { text: '取消', style: 'cancel' },
    { text: '继续', style: 'destructive', onPress: () => { update({ serverUrl: '' }); void logout(settings.serverUrl, accessToken).catch(() => undefined).finally(() => clearSession()); } },
  ]);
  const clear = () => Alert.alert('清空本地对话', '此操作无法撤销。', [{ text: '取消', style: 'cancel' }, { text: '清空', style: 'destructive', onPress: clearConversations }]);

  return <>
    <KeyboardAwareView style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <SettingsSection title="账户与连接">
          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.text }]}>当前账户</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="打开个人信息" onPress={() => navigation.navigate('Profile')} style={({ pressed }) => [styles.accountRow, pressed && { opacity: 0.75 }]}>
              <UserAvatar user={user} serverUrl={settings.serverUrl} accessToken={accessToken} size={48} />
              <View style={styles.accountBody}><Text numberOfLines={1} style={[styles.accountName, { color: theme.colors.text }]}>{user ? safeDisplayName(user) : '未登录'}</Text><Text numberOfLines={1} style={[styles.accountEmail, { color: theme.colors.textSecondary }]}>{user?.email ?? ''}</Text></View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.textTertiary} />
            </Pressable>
            <Text selectable style={[styles.hint, { color: theme.colors.textSecondary }]}>当前 Gateway：{settings.serverUrl || '未配置'}</Text>
            <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>所有聊天、模型和附件都通过 Gateway 转发，API Key 由管理员统一配置。</Text>
          </View>
          {user?.role === 'admin' && <><View style={[styles.divider, { backgroundColor: theme.colors.border }]} /><SettingsLink icon="shield-checkmark-outline" title="管理控制台" subtitle="配置 API、模型和用户权限" onPress={() => navigation.navigate('Admin')} /></>}
          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} /><SettingsLink icon="person-circle-outline" title="个人信息" subtitle="修改显示名称和头像" onPress={() => navigation.navigate('Profile')} />
          {!BUILT_IN_GATEWAY_URL && <><View style={[styles.divider, { backgroundColor: theme.colors.border }]} /><SettingsLink icon="server-outline" title="更换服务器" subtitle="退出当前账户并重新配置 Gateway" onPress={changeServer} /></>}
          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} /><SettingsLink icon="log-out-outline" title="退出登录" subtitle="退出后可重新登录当前 Gateway" danger onPress={signOut} />
          <Pressable onPress={() => void loadModels()} disabled={busy} style={[styles.primaryButton, { backgroundColor: theme.colors.primary }, busy && styles.disabled]}><Ionicons name="pulse-outline" size={17} color="#fff" /><Text style={styles.primaryText}>{busy ? '连接中…' : '刷新模型列表'}</Text></Pressable>
          {!!status && <Text style={[styles.status, { color: status.ok ? theme.colors.success : theme.colors.danger }]}>{status.text}</Text>}
        </SettingsSection>

        <SettingsSection title="模型与能力">
          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.text }]}>模型 ID</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="选择管理员发布的模型" disabled={!models.length} onPress={() => setPickerVisible(true)} style={({ pressed }) => [styles.gatewayModelPicker, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }, pressed && { opacity: 0.75 }, !models.length && styles.disabled]}>
              <View style={styles.gatewayModelText}><Text numberOfLines={1} style={[styles.value, { color: theme.colors.text }]}>{settings.model || '管理员尚未发布模型'}</Text><Text style={[styles.hint, { color: theme.colors.textSecondary }]}>模型由管理员发布，点击此处选择</Text></View>
              <Ionicons name="chevron-down" size={19} color={theme.colors.textSecondary} />
            </Pressable>
          </View>
          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
          <View style={styles.field}><Text style={[styles.label, { color: theme.colors.text }]}>推理强度</Text><View style={styles.chips}>{efforts.map((item) => <Chip key={item.value} {...item} selected={settings.reasoningEffort === item.value} onPress={(reasoningEffort) => update({ reasoningEffort })} />)}</View></View>
          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
          <View style={styles.field}><Text style={[styles.label, { color: theme.colors.text }]}>回答详略</Text><View style={styles.chips}>{verbosities.map((item) => <Chip key={item.value} {...item} selected={settings.verbosity === item.value} onPress={(verbosity) => update({ verbosity })} />)}</View></View>
          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
          <View style={styles.switchRow}><View style={styles.switchText}><Text style={[styles.labelInline, { color: theme.colors.text }]}>网页搜索</Text><Text style={[styles.hint, { color: theme.colors.textSecondary }]}>由管理员配置的 Responses 服务提供</Text></View><Switch value={settings.webSearch} onValueChange={(webSearch) => update({ webSearch })} /></View>
          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
          <View style={styles.switchRow}><View style={styles.switchText}><Text style={[styles.labelInline, { color: theme.colors.text }]}>代码解释器</Text><Text style={[styles.hint, { color: theme.colors.textSecondary }]}>由模型服务商托管，不会执行网关主机命令</Text></View><Switch value={settings.codeInterpreter} onValueChange={(codeInterpreter) => update({ codeInterpreter })} /></View>
          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
          <View style={styles.field}><Text style={[styles.label, { color: theme.colors.text }]}>最大输出</Text><View style={styles.chips}>{[4096, 8192, 16384, 32768].map((value) => <Chip key={value} value={String(value)} label={(value / 1024) + 'K'} selected={settings.maxOutputTokens === value} onPress={() => update({ maxOutputTokens: value })} />)}</View></View>
          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
          <View style={styles.field}><Text style={[styles.label, { color: theme.colors.text }]}>系统指令</Text><TextInput value={settings.instructions} onChangeText={(instructions) => update({ instructions })} multiline maxLength={20_000} placeholder="定义助手的风格和规则" placeholderTextColor={theme.colors.textTertiary} textAlignVertical="top" style={[styles.input, styles.promptInput, { color: theme.colors.text, backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]} /></View>
        </SettingsSection>

        <SettingsSection title="数据与帮助"><SettingsLink icon="information-circle-outline" title="关于 Nova" subtitle="安全架构、版本和功能边界" onPress={() => navigation.navigate('About')} /><View style={[styles.divider, { backgroundColor: theme.colors.border, marginHorizontal: 14 }]} /><SettingsLink icon="trash-outline" title="清空本地对话" subtitle="不会删除服务器账户" danger onPress={clear} /></SettingsSection>
        <Text style={[styles.footer, { color: theme.colors.textTertiary }]}>Nova 是独立客户端，不代表任何模型服务商。工具、模型、隐私和计费取决于管理员配置的第三方服务。</Text>
      </ScrollView>
    </KeyboardAwareView>
    <ModelPickerModal visible={pickerVisible} models={models} selectedModel={settings.model} onSelect={(model) => update({ model })} onClose={() => setPickerVisible(false)} />
  </>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, scroll: { flex: 1 }, container: { padding: 16, paddingBottom: 46 }, field: { padding: 14 }, label: { fontSize: 14, fontWeight: '700', marginBottom: 9 }, labelInline: { fontSize: 14, fontWeight: '700' }, value: { fontSize: 14, fontWeight: '600' }, accountRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 11 }, accountBody: { flex: 1, minWidth: 0 }, accountName: { fontSize: 15, fontWeight: '700' }, accountEmail: { fontSize: 12, marginTop: 3 },
  input: { height: 44, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, fontSize: 14 }, promptInput: { height: 120, paddingTop: 11, paddingBottom: 11 }, hint: { fontSize: 11, lineHeight: 16, marginTop: 5 }, divider: { height: StyleSheet.hairlineWidth }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { minWidth: 52, minHeight: 34, paddingHorizontal: 11, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, chipText: { fontSize: 12, fontWeight: '700' },
  primaryButton: { height: 43, marginHorizontal: 14, marginTop: 8, borderRadius: 11, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 }, primaryText: { color: '#fff', fontWeight: '800', fontSize: 13 }, disabled: { opacity: 0.55 }, status: { fontSize: 12, marginHorizontal: 15, marginBottom: 13, lineHeight: 17 },
  gatewayModelPicker: { minHeight: 55, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center' }, gatewayModelText: { flex: 1, minWidth: 0, paddingRight: 8 }, switchRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9 }, switchText: { flex: 1, paddingRight: 12 }, footer: { textAlign: 'center', fontSize: 11, lineHeight: 17, paddingHorizontal: 20 },
});
