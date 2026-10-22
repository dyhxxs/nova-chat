import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ ActivityIndicator: 'ActivityIndicator', Image: 'Image', Linking: {}, Platform: { OS: 'android' }, Pressable: 'Pressable', View: 'View', StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 } }));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('expo-haptics', () => ({ selectionAsync: vi.fn() }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('react-native-marked', () => ({ Renderer: class {}, useMarkdown: () => [] }));
vi.mock('../src/components/ThemedText', () => ({ ThemedText: 'Text' }));
vi.mock('../src/components/CompanionAvatar', () => ({ CompanionAvatar: () => null }));
vi.mock('../src/components/KnowledgeSources', () => ({ KnowledgeSources: () => null }));
vi.mock('../src/components/UserAvatar', () => ({ UserAvatar: () => null }));
vi.mock('../src/components/TypingDots', () => ({ TypingDots: () => null }));
vi.mock('../src/services/gatewayImageCache', () => ({ loadGatewayImage: vi.fn(), invalidateGatewayImage: vi.fn() }));
vi.mock('../src/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: {}, fonts: {} }) }));
import { MessageBubble } from '../src/components/MessageBubble';
import { loadGatewayImage } from '../src/services/gatewayImageCache';
import { restoreLocalRecords } from '../src/lib/localSnapshot';
import type { AppMessage } from '../src/types';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReactTestRenderer | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; });
const message: AppMessage = { id: 'error', role: 'assistant', content: '', attachments: [], createdAt: 1, status: 'error', errorMessage: '图片服务未接受这次描述，请调整场景或描述后再试。', errorCode: 'provider_content_rejected', retryable: false };

describe('photo error recovery', () => {
  it.each([true, false])('does not offer the same rejected request again (companion=%s)', async companion => {
    const retry = vi.fn(); const edit = vi.fn();
    await act(async () => { root = create(createElement(MessageBubble, { companion, message, onRetry: retry, onEditRequest: edit })); });
    const buttons = root!.root.findAllByType('Pressable' as any);
    expect(buttons.filter(button => ['重试陪伴回复', '重新生成'].includes(button.props.accessibilityLabel))).toHaveLength(0);
    const editButton = buttons.find(button => button.props.accessibilityLabel === '修改照片描述');
    expect(editButton).toBeDefined();
    await act(async () => editButton!.props.onPress());
    expect(edit).toHaveBeenCalledOnce(); expect(retry).not.toHaveBeenCalled();
  });
  it('keeps a transient companion connection error retryable', async () => {
    await act(async () => { root = create(createElement(MessageBubble, { companion: true, message: { ...message, errorCode: 'network_error', retryable: true }, onRetry: vi.fn() })); });
    expect(root!.root.findAllByType('Pressable' as any).some(button => button.props.accessibilityLabel === '重试陪伴回复')).toBe(true);
  });
  it('recognizes an old persisted rejection without an error code and retains new structured errors across restore', async () => {
    await act(async () => { root = create(createElement(MessageBubble, { companion: true, message: { ...message, errorCode: undefined }, onEditRequest: vi.fn() })); });
    expect(root!.root.findAllByType('Pressable' as any).some(button => button.props.accessibilityLabel === '修改照片描述')).toBe(true);
    const restored = restoreLocalRecords([{ id: 'old', title: '旧版', createdAt: 1, updatedAt: 1, messages: [message] }], []);
    expect(restored.conversations[0]?.messages[0]).toMatchObject({ errorCode: 'provider_content_rejected', retryable: false });
    expect(restored.repaired).toBe(false);
  });
});


describe('complete companion media messages', () => {
  const voice = { status: 'ready' as const, durationMs: 3200, requestId: '11111111-1111-4111-8111-111111111111', fileId: '22222222-2222-4222-8222-222222222222' };
  it.each(['user', 'assistant'] as const)('keeps the %s transcript collapsed until requested', async role => {
    const value = { ...message, role, status: 'complete' as const, content: '这是识别文字', voice };
    await act(async () => { root = create(createElement(MessageBubble, { companion: true, message: value })); });
    expect(root!.root.findAllByProps({ children: value.content })).toHaveLength(0);
    await act(async () => root!.root.findByProps({ accessibilityLabel: '语音转文字' }).props.onPress());
    expect(root!.root.findAllByProps({ children: value.content }).length).toBeGreaterThan(0);
    await act(async () => root!.root.findByProps({ accessibilityLabel: '收起语音文字' }).props.onPress());
    await act(async () => root!.update(createElement(MessageBubble, { companion: true, message: { ...value, content: '识别文字更新' } })));
    expect(root!.root.findAllByProps({ children: '识别文字更新' })).toHaveLength(0);
  });
  it('reveals ready voice without exposing intermediate text or a playback progress track', async () => {
    await act(async () => { root = create(createElement(MessageBubble, { companion: true, message: { ...message, status: 'complete', content: '半成品', voice: { ...voice, status: 'pending' } } })); });
    expect(root!.toJSON()).toBeNull();
    await act(async () => root!.update(createElement(MessageBubble, { companion: true, message: { ...message, status: 'complete', content: '半成品', voice }, voicePlaying: true })));
    expect(root!.root.findAllByProps({ accessibilityLabel: '暂停语音' })).toHaveLength(1);
    expect(root!.root.findAll(node => node.props.style?.height === 2)).toHaveLength(0);
    expect(root!.root.findAllByProps({ children: '半成品' })).toHaveLength(0);
  });
  it('hides streamed photo captions until generation completes', async () => {
    await act(async () => { root = create(createElement(MessageBubble, { companion: true, message: { ...message, status: 'streaming', content: '这张给你～' } })); });
    expect(root!.toJSON()).toBeNull();
  });
  const photo = { id: '33333333-3333-4333-8333-333333333333', kind: 'image' as const, name: 'photo.png', mimeType: 'image/png', size: 100 };
  it('waits for photo download AND image decoding before revealing the whole bubble', async () => {
    let resolve!: (uri: string) => void;
    vi.mocked(loadGatewayImage).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await act(async () => { root = create(createElement(MessageBubble, { companion: true, serverUrl: 'https://test', accessToken: 'synthetic', message: { ...message, status: 'complete', attachments: [photo], content: '这张给你～' } })); });
    const outer = () => root!.root.findAllByType('View' as any)[0]!;
    expect(outer().props.accessibilityElementsHidden).toBe(true);
    await act(async () => resolve('file:///photo.png'));
    expect(outer().props.accessibilityElementsHidden).toBe(true);
    await act(async () => root!.root.findByType('Image' as any).props.onLoad({ nativeEvent: { source: { width: 600, height: 800 } } }));
    expect(outer().props.accessibilityElementsHidden).toBe(false);
    expect(root!.root.findAllByType('ActivityIndicator' as any)).toHaveLength(0);
  });
  it('reveals an actionable loading failure instead of hiding a failed photo forever', async () => {
    vi.mocked(loadGatewayImage).mockRejectedValueOnce(new Error('offline'));
    await act(async () => { root = create(createElement(MessageBubble, { companion: true, serverUrl: 'https://test', accessToken: 'synthetic', message: { ...message, status: 'complete', attachments: [photo] } })); });
    expect(root!.root.findAllByType('View' as any)[0]!.props.accessibilityElementsHidden).toBe(false);
    expect(root!.root.findAllByProps({ accessibilityLabel: '重新加载图片 photo.png' })).toHaveLength(1);
  });
});
