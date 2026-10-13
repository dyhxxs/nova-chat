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
