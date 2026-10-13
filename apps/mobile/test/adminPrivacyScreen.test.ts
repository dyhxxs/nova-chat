vi.mock('../src/components/CompanionProviderSection', () => ({ CompanionProviderSection: 'CompanionProviderSection' }));
import { createElement, type ComponentProps } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  get: vi.fn(), save: vi.fn(), test: vi.fn(), list: vi.fn(), updateUser: vi.fn(), updateSettings: vi.fn(),
  goBack: vi.fn(), appListeners: new Set<(state: string) => void>(), blurListeners: new Set<() => void>(),
}));
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', Alert: { alert: vi.fn() }, Pressable: 'Pressable', RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView', Switch: 'Switch', View: 'View', StyleSheet: { create: (styles: unknown) => styles },
  AppState: { addEventListener: (_event: string, callback: (state: string) => void) => { mocks.appListeners.add(callback); return { remove: () => mocks.appListeners.delete(callback) }; } },
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('../src/components/ThemedText', () => ({ ThemedText: 'Text', ThemedTextInput: 'TextInput' }));
vi.mock('../src/components/KeyboardAwareView', () => ({ KeyboardAwareView: 'KeyboardAwareView' }));
vi.mock('../src/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: {} }) }));
vi.mock('../src/services/gatewayApiClient', () => ({ getProviderSettings: mocks.get, saveProviderSettings: mocks.save, testProvider: mocks.test, listUsers: mocks.list, updateUser: mocks.updateUser }));
vi.mock('../src/store/useAppStore', async () => { const { create } = await import('zustand'); return { useAppStore: create(() => ({})) }; });
import { AdminScreen } from '../src/screens/AdminScreen';
import { useAppStore } from '../src/store/useAppStore';
const admin = { id: 'admin-1', email: 'admin@example.test', displayName: 'Admin', role: 'admin' as const, disabled: false, createdAt: 1, updatedAt: 1 };
const metadata = { apiBaseUrlSet: true, apiKeySet: true, apiMode: 'responses', authMode: 'bearer', defaultModel: 'model-a', allowedModels: ['model-a'] };
const secretResponse = { ...metadata, apiBaseUrl: 'https://old-private.example/v1', apiKey: 'old-secret', apiKeyPreview: '••••9746' };
let root: ReactTestRenderer | undefined;
const navigation = { goBack: mocks.goBack, addListener: (_event: string, callback: () => void) => { mocks.blurListeners.add(callback); return () => mocks.blurListeners.delete(callback); } };
async function mount() { await act(async () => { root = create(createElement(AdminScreen, { navigation } as unknown as ComponentProps<typeof AdminScreen>)); }); }
function inputs() { return root!.root.findAll((node) => String(node.type) === 'TextInput' && Boolean(node.props.accessibilityLabel)); }
async function enter() { await act(async () => { inputs()[0]!.props.onChangeText('https://new-private.example/v1'); inputs()[1]!.props.onChangeText('new-private-secret'); }); }
function button(label: string) { return root!.root.findAll((node) => String(node.type) === 'Pressable').find((node) => node.findAll((child) => String(child.type) === 'Text' && child.children.includes(label)).length > 0)!; }
function renderedText() { return JSON.stringify(root!.root.findAll((node) => String(node.type) === 'Text' || String(node.type) === 'TextInput').map((node) => ({ value: node.props.value, placeholder: node.props.placeholder, label: node.props.accessibilityLabel, text: node.children.filter((child) => typeof child === 'string') }))); }
function defer<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.get.mockReset().mockResolvedValue(secretResponse); mocks.save.mockReset().mockResolvedValue(secretResponse);
  mocks.test.mockReset().mockResolvedValue(['model-a']); mocks.list.mockReset().mockResolvedValue([admin]); mocks.updateSettings.mockReset();
  mocks.goBack.mockReset(); mocks.appListeners.clear(); mocks.blurListeners.clear();
  useAppStore.setState({ user: admin, accessToken: 'admin-session', settings: { serverUrl: 'https://gateway.test' }, updateSettings: mocks.updateSettings } as unknown as Parameters<typeof useAppStore.setState>[0]);
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.unstubAllGlobals(); });

describe('administrator write-only credential UI', () => {
  it('shows only configured placeholders and masked input, not saved URL or key suffixes', async () => {
    await mount(); expect(inputs()).toHaveLength(2);
    for (const input of inputs()) { expect(input.props.value).toBe(''); expect(input.props.secureTextEntry).toBe(true); expect(input.props.placeholder).toBe('已配置并隐藏；留空保持不变'); expect(input.props.autoComplete).toBe('off'); }
    const rendered = renderedText();
    for (const value of ['old-private.example', 'old-secret', '9746']) expect(rendered).not.toContain(value);
  });
  it('clears both values after a successful save even if the server sends legacy secret fields', async () => {
    await mount(); await enter();
    await act(async () => button('保存').props.onPress());
    expect(mocks.save).toHaveBeenCalledWith('https://gateway.test', 'admin-session', expect.objectContaining({ apiBaseUrl: 'https://new-private.example/v1', apiKey: 'new-private-secret' }));
    for (const input of inputs()) expect(input.props.value).toBe('');
    expect(renderedText()).not.toContain('new-private');
  });
  it('tests and saves existing credentials without reading or resending their values', async () => {
    await mount(); await act(async () => button('获取模型').props.onPress());
    expect(mocks.test).toHaveBeenCalledTimes(1); expect(mocks.save).toHaveBeenCalledTimes(1);
    for (const call of [mocks.test.mock.calls[0]!, mocks.save.mock.calls[0]!]) { expect(call[2]).not.toHaveProperty('apiBaseUrl'); expect(call[2]).not.toHaveProperty('apiKey'); }
    for (const input of inputs()) expect(input.props.value).toBe('');
  });
  it.each(['background', 'blur'])('clears unsaved secrets on %s and prevents a late model test from saving them', async (event) => {
    const pending = defer<string[]>(); mocks.test.mockReturnValue(pending.promise);
    await mount(); await enter(); await act(async () => { button('获取模型').props.onPress(); });
    await act(async () => { if (event === 'background') for (const listener of mocks.appListeners) listener('background'); else for (const listener of mocks.blurListeners) listener(); });
    for (const input of inputs()) expect(input.props.value).toBe('');
    await act(async () => pending.resolve(['model-a'])); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('does not save results from the previous administrator session', async () => {
    const pending = defer<string[]>(); mocks.test.mockReturnValue(pending.promise);
    await mount(); await enter(); await act(async () => { button('获取模型').props.onPress(); });
    await act(async () => { useAppStore.setState({ accessToken: 'new-admin-session' }); });
    await act(async () => pending.resolve(['model-a'])); expect(mocks.save).not.toHaveBeenCalled();
    for (const input of inputs()) expect(input.props.value).toBe('');
  });
});
