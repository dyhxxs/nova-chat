import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ThemedText as Text, ThemedTextInput as TextInput } from './ThemedText';
import { useAppTheme } from '../hooks/useAppTheme';
import { useAppStore } from '../store/useAppStore';
import { emptyProviderForm, providerFormFrom, providerFormInput, type ProviderForm } from '../lib/providerForm';
import { friendlyNetworkError } from '../lib/errorMessage';
import { getCompanionProviderSettings, saveCompanionProviderSettings, testCompanionProvider } from '../services/gatewayApiClient';

type Purpose = 'chat' | 'image';
export function CompanionProviderSection({ onBlur }: { onBlur: (callback: () => void) => () => void }) {
  const theme = useAppTheme();
  const serverUrl = useAppStore(s => s.settings.serverUrl);
  const accessToken = useAppStore(s => s.accessToken);
  const [purpose, setPurpose] = useState<Purpose>('chat');
  const [form, setForm] = useState<ProviderForm>(emptyProviderForm);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [modelPicker, setModelPicker] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  const ticket = useRef(0);
  const valid = () => { const s = useAppStore.getState(); return s.user?.role === 'admin' && s.accessToken === accessToken && s.settings.serverUrl === serverUrl; };
  useEffect(() => {
    const id = ++ticket.current;
    setBusy(true); setNotice(''); setModels([]); setModelPicker(false); setModelQuery(''); setForm({ ...emptyProviderForm, apiMode: 'chat-completions', defaultModel: '', allowedModels: '' });
    void getCompanionProviderSettings(serverUrl, accessToken, purpose).then(value => { if (ticket.current === id) setForm(providerFormFrom(value)); }).catch(error => { if (ticket.current === id) setNotice(friendlyNetworkError(error)); }).finally(() => { if (ticket.current === id) setBusy(false); });
    return () => { ticket.current++; };
  }, [serverUrl, accessToken, purpose]);
  useEffect(() => {
    const clear = () => { ticket.current++; setForm(value => ({ ...value, apiBaseUrl: '', apiKey: '' })); setModels([]); setModelPicker(false); setModelQuery(''); setBusy(false); };
    const sub = AppState.addEventListener('change', value => { if (value !== 'active') clear(); });
    const unsubscribe = onBlur(clear);
    return () => { ticket.current++; sub.remove(); unsubscribe(); };
  }, [onBlur]);
  const save = async () => {
    if (!valid() || busy) return;
    const id = ++ticket.current; setBusy(true); setNotice('');
    try { const saved = await saveCompanionProviderSettings(serverUrl, accessToken, purpose, providerFormInput({ ...form, allowedModels: form.defaultModel })); if (ticket.current === id && valid()) { setForm(providerFormFrom(saved)); setNotice('已保存，用户端只显示角色和消息。'); } }
    catch (error) { if (ticket.current === id && valid()) setNotice(friendlyNetworkError(error)); }
    finally { if (ticket.current === id) setBusy(false); }
  };
  const updateForm = (patch: Partial<ProviderForm>) => {
    setForm(current => ({ ...current, ...patch }));
    setModels([]); setModelPicker(false); setNotice('');
  };
  const loadModels = async () => {
    if (!valid() || busy) return;
    const id = ++ticket.current; setBusy(true); setNotice('');
    try {
      const apiBaseUrl = form.apiBaseUrl.trim(); const apiKey = form.apiKey.trim();
      const available = await testCompanionProvider(serverUrl, accessToken, purpose, {
        ...(apiBaseUrl ? { apiBaseUrl } : {}), ...(apiKey ? { apiKey } : {}), apiMode: form.apiMode, authMode: form.authMode,
      });
      if (ticket.current !== id || !valid()) return;
      setModels([...new Set(available)]); setModelQuery('');
      if (!available.length) { setNotice('服务没有返回可用模型，可手动填写模型名称。'); return; }
      setModelPicker(true); setNotice('选择模型后，点保存配置生效。');
    } catch (error) { if (ticket.current === id && valid()) setNotice(friendlyNetworkError(error)); }
    finally { if (ticket.current === id && valid()) setBusy(false); }
  };
  const input = (key: 'apiBaseUrl' | 'apiKey' | 'defaultModel', title: string, hint: string) => <View style={{ gap: 8 }}><Text style={{ color: theme.colors.text, fontSize: 13 }}>{title}</Text><TextInput accessibilityLabel={`陪伴${purpose === 'chat' ? '文字' : '图片'}${title}`} value={form[key]} onChangeText={value => key === 'defaultModel' ? setForm(current => ({ ...current, [key]: value })) : updateForm({ [key]: value })} editable={!busy} secureTextEntry={key !== 'defaultModel'} autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" importantForAutofill="no" placeholder={hint} placeholderTextColor={theme.colors.textTertiary} style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]} /></View>;
  return <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
    <Text style={{ color: theme.colors.text, fontSize: 19, fontWeight: '600' }}>AI 陪伴专用服务</Text>
    <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 21 }}>陪伴文字由管理员独立指定模型，普通聊天切换模型不会影响它。陪伴照片可使用中转的 image 模型。</Text>
    <View style={styles.options}>{(['chat', 'image'] as const).map(value => <Pressable key={value} disabled={busy} onPress={() => setPurpose(value)} style={[styles.choice, { backgroundColor: value === purpose ? theme.colors.primarySoft : theme.colors.surfaceMuted }]}><Text style={{ color: value === purpose ? theme.colors.primary : theme.colors.textSecondary }}>{value === 'chat' ? '陪伴聊天' : '陪伴照片'}</Text></Pressable>)}</View>
    {input('apiBaseUrl', '服务地址', form.apiBaseUrlSet ? '已配置；留空保留' : 'https://provider.example.com/v1')}
    {input('apiKey', 'API Key', form.apiKeySet ? '已配置；留空保留' : '输入该服务的密钥')}
    {input('defaultModel', '模型', purpose === 'chat' ? '例如 deepseek-chat' : '例如 gpt-image-1')}
    <Pressable disabled={busy} accessibilityLabel="获取陪伴可用模型" onPress={() => void loadModels()} style={[styles.save, { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, opacity: busy ? 0.6 : 1 }]}><Text style={{ color: theme.colors.primary }}>获取可用模型并选择</Text></Pressable>
    <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 20 }}>填写地址和 Key 后可获取模型；已保存时留空即可使用原配置。模型由管理员选择，用户端不显示。</Text>
    {purpose === 'chat' && <View style={styles.options}>{(['chat-completions', 'responses'] as const).map(value => <Pressable key={value} disabled={busy} onPress={() => updateForm({ apiMode: value })} style={[styles.choice, { backgroundColor: value === form.apiMode ? theme.colors.primarySoft : theme.colors.surfaceMuted }]}><Text style={{ color: theme.colors.text, fontSize: 12 }}>{value === 'responses' ? 'Responses' : 'Chat Completions'}</Text></Pressable>)}</View>}
    <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>鉴权方式</Text>
    <View style={styles.options}>{(['bearer', 'api-key', 'none'] as const).map(value => <Pressable key={value} disabled={busy} onPress={() => updateForm({ authMode: value })} style={[styles.choice, { backgroundColor: value === form.authMode ? theme.colors.primarySoft : theme.colors.surfaceMuted }]}><Text style={{ color: theme.colors.text, fontSize: 12 }}>{value === 'none' ? '无鉴权' : value}</Text></Pressable>)}</View>
    {purpose === 'image' && <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 20 }}>服务需支持 /images/generations 和 /images/edits，才能在不同场景中保持同一张脸。</Text>}
    {!!notice && <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20 }}>{notice}</Text>}
    <Pressable disabled={busy} onPress={() => void save()} style={[styles.save, { backgroundColor: theme.colors.primary, opacity: busy ? 0.6 : 1 }]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '600' }}>保存{purpose === 'chat' ? '聊天' : '照片'}配置</Text>}</Pressable>
    {modelPicker && <Modal visible transparent animationType="fade" onRequestClose={() => setModelPicker(false)}>
      <View style={styles.overlay}><View style={[styles.modelSheet, { backgroundColor: theme.colors.surface }]}>
        <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '600' }}>选择{purpose === 'chat' ? '陪伴文字' : '陪伴图片'}模型</Text>
        <TextInput accessibilityLabel="筛选陪伴模型" value={modelQuery} onChangeText={setModelQuery} placeholder="搜索模型名称" placeholderTextColor={theme.colors.textTertiary} autoCapitalize="none" autoCorrect={false} style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.border }]} />
        <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">{models.filter(model => model.toLowerCase().includes(modelQuery.toLowerCase().trim())).map(model => <Pressable key={model} accessibilityLabel={`采用模型 ${model}`} onPress={() => { setForm(current => ({ ...current, defaultModel: model, allowedModels: model })); setModelPicker(false); }} style={[styles.modelRow, { backgroundColor: model === form.defaultModel ? theme.colors.primarySoft : theme.colors.surface }]}><Text style={{ color: theme.colors.text, fontSize: 14 }}>{model}{model === form.defaultModel ? '  ✓' : ''}</Text></Pressable>)}</ScrollView>
        <Pressable onPress={() => setModelPicker(false)} style={styles.save}><Text style={{ color: theme.colors.textSecondary }}>取消</Text></Pressable>
      </View></View>
    </Modal>}
  </View>;
}
const styles = StyleSheet.create({ overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.28)', justifyContent: 'center', padding: 24 }, modelSheet: { padding: 20, borderRadius: 20, gap: 16 }, modelRow: { padding: 14, borderRadius: 10, marginBottom: 4 }, card: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 20, gap: 16, marginBottom: 18 }, input: { minHeight: 48, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, fontSize: 14 }, options: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' }, choice: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10 }, save: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' } });
