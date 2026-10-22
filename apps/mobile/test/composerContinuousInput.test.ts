vi.mock('../src/components/VoiceRecorder', () => ({ VoiceRecorder: () => null }));
vi.mock('../src/components/VoicePreferencesPanel', () => ({ VoicePreferencesPanel: () => null }));
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ dismiss: vi.fn() }));
vi.mock('react-native', () => ({ ActivityIndicator: 'ActivityIndicator', Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView', TextInput: 'TextInput', View: 'View', Keyboard: { dismiss: mocks.dismiss }, StyleSheet: { create: (value: unknown) => value } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('expo-haptics', () => ({ impactAsync: vi.fn(async () => {}), ImpactFeedbackStyle: { Light: 'light' } }));
vi.mock('../src/components/ThemedText', () => ({ ThemedText: 'Text' }));
vi.mock('../src/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: {}, fonts: {} }) }));
import { Composer } from '../src/components/Composer';
let root: ReactTestRenderer | undefined;
const props = () => ({ voiceActive: false, voiceConversationId: 'test-conversation', onRecordStart: vi.fn(), onRecorded: vi.fn(), onVoicePreferences: vi.fn(), serverUrl: 'https://gateway.test', accessToken: 'test', companion: true, text: '继续说', onChangeText: vi.fn(), onSentDraft: vi.fn(), generating: true, uploading: false, attachments: [], reasoningLabel: '', autoTools: false, knowledgeBase: false, webSearch: false, codeInterpreter: false, onSend: vi.fn(async () => true), onStop: vi.fn(), onToggleKnowledge: vi.fn(), onOpenKnowledge: vi.fn(), onToggleAutoTools: vi.fn(), onOpenOptions: vi.fn(), onToggleWebSearch: vi.fn(), onToggleCodeInterpreter: vi.fn(), onTakePhoto: vi.fn(), onAddImage: vi.fn(), onAddDocument: vi.fn(), onRemoveAttachment: vi.fn() });
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mocks.dismiss.mockReset(); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.unstubAllGlobals(); });
describe('continuous chat input', () => {
  it('sends during a companion reply without dismissing the keyboard or presenting a generation control', async () => {
    const value = props(); await act(async () => { root = create(createElement(Composer, value)); });
    const send = root!.root.findByProps({ accessibilityLabel: '发送消息' });
    expect(send.props.disabled).toBe(false);
    expect(root!.root.findAllByProps({ accessibilityLabel: '停止生成' })).toHaveLength(0);
    await act(async () => { await send.props.onPress(); });
    expect(value.onSend).toHaveBeenCalledWith('继续说'); expect(value.onSentDraft).toHaveBeenCalledWith('继续说');
    expect(mocks.dismiss).not.toHaveBeenCalled();
    expect(root!.root.findByType('TextInput' as any).props.submitBehavior).toBe('submit');
  });
  it('keeps the input editable during submission while preventing duplicate submissions', async () => {
    let finish!: (sent: boolean) => void;
    const value = { ...props(), onSend: vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; })) };
    await act(async () => { root = create(createElement(Composer, value)); });
    const send = root!.root.findByProps({ accessibilityLabel: '发送消息' });
    await act(async () => { send.props.onPress(); send.props.onPress(); });
    expect(value.onSend).toHaveBeenCalledTimes(1);
    expect(root!.root.findByType('TextInput' as any).props.editable).toBe(true);
    await act(async () => { finish(true); });
    expect(mocks.dismiss).not.toHaveBeenCalled();
  });
});
