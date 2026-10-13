import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), test: vi.fn(), app: new Set<(state: string) => void>(), blur: new Set<() => void>() }));
vi.mock('react-native', () => ({ ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', View: 'View', Modal: 'Modal', ScrollView: 'ScrollView', StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 }, AppState: { addEventListener: (_: string, callback: (state: string) => void) => { mocks.app.add(callback); return { remove: () => mocks.app.delete(callback) }; } } }));
vi.mock('../src/components/ThemedText', () => ({ ThemedText: 'Text', ThemedTextInput: 'TextInput' }));
vi.mock('../src/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: {} }) }));
vi.mock('../src/store/useAppStore', async () => { const { create } = await import('zustand'); return { useAppStore: create(() => ({})) }; });
vi.mock('../src/services/gatewayApiClient', () => ({ getCompanionProviderSettings: mocks.get, saveCompanionProviderSettings: mocks.save, testCompanionProvider: mocks.test }));
import { CompanionProviderSection } from '../src/components/CompanionProviderSection';
import { useAppStore } from '../src/store/useAppStore';
const metadata = { apiBaseUrlSet: true, apiKeySet: true, apiMode: 'chat-completions', authMode: 'bearer', defaultModel: 'deepseek-chat', allowedModels: ['deepseek-chat'], apiBaseUrl: 'https://legacy-private.example', apiKey: 'legacy-secret' };
const onBlur = (callback: () => void) => { mocks.blur.add(callback); return () => mocks.blur.delete(callback); };
let root: ReactTestRenderer | undefined;
const inputs = () => root!.root.findAll(node => String(node.type) === 'TextInput');
const button = (text: string) => root!.root.findAll(node => String(node.type) === 'Pressable').find(node => node.findAll(child => String(child.type) === 'Text' && child.children.join('').includes(text)).length)!;
const text = () => JSON.stringify(root!.toJSON());
async function mount() { await act(async () => { root = create(createElement(CompanionProviderSection, { onBlur })); }); }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mocks.get.mockReset().mockResolvedValue(metadata); mocks.save.mockReset().mockResolvedValue(metadata); mocks.test.mockReset().mockResolvedValue(['deepseek-chat', 'deepseek-reasoner']); mocks.app.clear(); mocks.blur.clear(); useAppStore.setState({ accessToken: 'qa-session', user: { role: 'admin' }, settings: { serverUrl: 'https://gateway.test' } } as any); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.unstubAllGlobals(); });
describe('independent companion credential form', () => {
 it('never renders returned credentials and masks both write-only fields', async () => { await mount(); expect(inputs().slice(0, 2).map(input => input.props.value)).toEqual(['', '']); for (const input of inputs().slice(0, 2)) expect(input.props.secureTextEntry).toBe(true); expect(text()).not.toContain('legacy-secret'); expect(text()).not.toContain('legacy-private'); });
 it('saves only the selected purpose and clears secrets before switching routes', async () => { await mount(); await act(async () => { inputs()[0]!.props.onChangeText('https://new.example/v1'); inputs()[1]!.props.onChangeText('new-test-key'); }); await act(async () => button('保存聊天配置').props.onPress()); expect(mocks.save).toHaveBeenCalledWith('https://gateway.test', 'qa-session', 'chat', expect.objectContaining({ apiKey: 'new-test-key', defaultModel: 'deepseek-chat' })); expect(inputs()[1]!.props.value).toBe(''); await act(async () => button('陪伴照片').props.onPress()); expect(mocks.get).toHaveBeenLastCalledWith('https://gateway.test', 'qa-session', 'image'); expect(inputs()[1]!.props.value).toBe(''); });
 it.each(['blur', 'background'])('clears drafts on %s and ignores late saves', async event => { let resolve!: (value: typeof metadata) => void; mocks.save.mockReturnValue(new Promise(done => { resolve = done; })); await mount(); await act(async () => inputs()[1]!.props.onChangeText('draft-secret')); await act(async () => { button('保存聊天配置').props.onPress(); }); await act(async () => { if (event === 'blur') for (const cb of mocks.blur) cb(); else for (const cb of mocks.app) cb('background'); }); expect(inputs()[1]!.props.value).toBe(''); await act(async () => resolve(metadata)); expect(text()).not.toContain('已保存，'); expect(inputs()[1]!.props.value).toBe(''); });
 it('queries only the companion route and saves the administrator-selected model after explicit save', async () => {
   await mount(); await act(async () => button('获取可用模型并选择').props.onPress());
   expect(mocks.test).toHaveBeenCalledWith('https://gateway.test', 'qa-session', 'chat', { apiMode: 'chat-completions', authMode: 'bearer' });
   expect(mocks.save).not.toHaveBeenCalled();
   await act(async () => button('deepseek-reasoner').props.onPress());
   expect(inputs()[2]!.props.value).toBe('deepseek-reasoner');
   await act(async () => button('保存聊天配置').props.onPress());
   expect(mocks.save).toHaveBeenCalledWith('https://gateway.test', 'qa-session', 'chat', expect.objectContaining({ defaultModel: 'deepseek-reasoner', allowedModels: ['deepseek-reasoner'] }));
 });
 it('queries newly entered credentials before a model is chosen and keeps the draft until save', async () => {
   await mount(); await act(async () => { inputs()[0]!.props.onChangeText('https://new.example/v1'); inputs()[1]!.props.onChangeText('draft-key'); inputs()[2]!.props.onChangeText(''); });
   await act(async () => button('获取可用模型并选择').props.onPress());
   expect(mocks.test).toHaveBeenCalledWith('https://gateway.test', 'qa-session', 'chat', expect.objectContaining({ apiBaseUrl: 'https://new.example/v1', apiKey: 'draft-key' }));
   expect(mocks.save).not.toHaveBeenCalled();
   await act(async () => button('deepseek-reasoner').props.onPress()); expect(inputs()[1]!.props.value).toBe('draft-key');
 });
 it('discards late model discovery after leaving the form', async () => {
   let resolve!: (models: string[]) => void; mocks.test.mockReturnValue(new Promise(done => { resolve = done; }));
   await mount(); await act(async () => { button('获取可用模型并选择').props.onPress(); });
   await act(async () => { for (const cb of mocks.blur) cb(); });
   await act(async () => resolve(['late-model'])); expect(text()).not.toContain('late-model'); expect(mocks.save).not.toHaveBeenCalled();
 });

});
