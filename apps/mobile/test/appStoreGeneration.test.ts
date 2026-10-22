import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn().mockResolvedValue(null), setItem: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn(),
}));

import { useAppStore } from '../src/store/useAppStore';

function assistantMessage(conversationId: string, messageId: string) {
  return useAppStore.getState().conversations
    .find((conversation) => conversation.id === conversationId)?.messages
    .find((message) => message.id === messageId);
}

describe('assistant generation model state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.getState().clearConversations();
    useAppStore.getState().updateSettings({ model: 'model-a' });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('keeps a turn bound to its requested model without reverting later settings', () => {
    const state = useAppStore.getState();
    const turn = state.beginTurn('hello', [], state.activeConversationId, ' model-a ');

    expect(assistantMessage(turn.conversationId, turn.assistantMessageId)?.requestedModel).toBe('model-a');

    useAppStore.getState().updateSettings({ model: 'model-b' });
    useAppStore.getState().completeAssistant(turn.conversationId, turn.assistantMessageId, {
      model: 'fallback-model',
      usage: { totalTokens: 12 },
    });

    expect(useAppStore.getState().settings.model).toBe('model-b');
    expect(assistantMessage(turn.conversationId, turn.assistantMessageId)).toEqual(expect.objectContaining({
      status: 'complete',
      requestedModel: 'model-a',
      model: 'fallback-model',
      usage: { totalTokens: 12 },
    }));
  });

  it('freezes the new model on regeneration and rejects duplicate regeneration', () => {
    const state = useAppStore.getState();
    const turn = state.beginTurn('hello', [], state.activeConversationId, 'model-a');
    state.completeAssistant(turn.conversationId, turn.assistantMessageId, { model: 'model-a' });
    state.updateSettings({ model: 'model-b' });

    expect(state.prepareRegeneration(turn.conversationId, turn.assistantMessageId)).toBe(true);
    expect(assistantMessage(turn.conversationId, turn.assistantMessageId)).toEqual(expect.objectContaining({
      status: 'streaming',
      content: '',
      requestedModel: 'model-b',
    }));
    expect(assistantMessage(turn.conversationId, turn.assistantMessageId)?.model).toBeUndefined();
    expect(state.prepareRegeneration(turn.conversationId, turn.assistantMessageId)).toBe(false);
  });

  it('preserves a nonretryable photo error and does not truncate later history on a retry', () => {
    const state = useAppStore.getState();
    const first = state.beginTurn('发张照片');
    state.failAssistant(first.conversationId, first.assistantMessageId, '图片服务未接受这次描述', false, undefined, 'provider_content_rejected');
    const followup = state.beginTurn('换个话题', [], first.conversationId);
    state.completeAssistant(followup.conversationId, followup.assistantMessageId);
    const before = useAppStore.getState().conversations;
    expect(state.prepareRegeneration(first.conversationId, first.assistantMessageId)).toBe(false);
    expect(useAppStore.getState().conversations).toBe(before);
    expect(assistantMessage(first.conversationId, first.assistantMessageId)).toMatchObject({ errorCode: 'provider_content_rejected', retryable: false, status: 'error' });
  });

  it('persists the durable request and frozen generation options for a turn', () => {
    vi.setSystemTime(new Date('2026-09-03T04:00:00.000Z'));
    const state = useAppStore.getState();
    const turn = state.beginTurn('hello', [], state.activeConversationId, 'model-a');
    const options = {
      reasoningEffort: 'medium' as const,
      verbosity: 'high' as const,
      maxOutputTokens: 4096,
      webSearch: true,
      codeInterpreter: false,
    };

    expect(state.bindAssistantGeneration(turn.conversationId, turn.assistantMessageId, {
      requestId: '  request-123  ',
      options,
      startedAt: 1234,
    })).toBe(true);
    expect(assistantMessage(turn.conversationId, turn.assistantMessageId)).toEqual(expect.objectContaining({
      generationRequestId: 'request-123',
      generationOptions: options,
      generationStartedAt: 1234,
      status: 'streaming',
    }));

    vi.setSystemTime(new Date('2026-09-03T04:00:05.000Z'));
    state.completeAssistant(turn.conversationId, turn.assistantMessageId, { model: 'model-a' });
    expect(assistantMessage(turn.conversationId, turn.assistantMessageId)).toEqual(expect.objectContaining({
      status: 'complete',
      generationRequestId: 'request-123',
      generationOptions: options,
      generationStartedAt: 1234,
      completedAt: Date.now(),
    }));
  });

  it('clears previous durable generation metadata when regenerating', () => {
    const state = useAppStore.getState();
    const turn = state.beginTurn('hello', [], state.activeConversationId, 'model-a');
    state.bindAssistantGeneration(turn.conversationId, turn.assistantMessageId, {
      requestId: 'old-request',
      options: {
        reasoningEffort: 'low',
        verbosity: 'low',
        maxOutputTokens: 1000,
        webSearch: false,
        codeInterpreter: false,
      },
      startedAt: 100,
    });
    state.completeAssistant(turn.conversationId, turn.assistantMessageId, { model: 'model-a' });

    expect(state.prepareRegeneration(turn.conversationId, turn.assistantMessageId)).toBe(true);
    expect(assistantMessage(turn.conversationId, turn.assistantMessageId)).toEqual(expect.objectContaining({
      status: 'streaming',
      requestedModel: 'model-a',
    }));
    const regenerated = assistantMessage(turn.conversationId, turn.assistantMessageId);
    expect(regenerated?.generationRequestId).toBeUndefined();
    expect(regenerated?.generationOptions).toBeUndefined();
    expect(regenerated?.generationStartedAt).toBeUndefined();
    expect(regenerated?.completedAt).toBeUndefined();
  });

  it('keeps conversation content isolated and ignores callbacks from an older request', () => {
    const state = useAppStore.getState();
    const conversationA = state.activeConversationId;
    const turnA = state.beginTurn('来自会话 A', [], conversationA, 'model-a');
    const conversationB = state.newConversation();
    const turnB = useAppStore.getState().beginTurn('来自会话 B', [], conversationB, 'model-a');

    useAppStore.getState().bindAssistantGeneration(conversationA, turnA.assistantMessageId, {
      requestId: 'request-a-old',
      options: { reasoningEffort: 'medium', verbosity: 'medium', maxOutputTokens: 1024, webSearch: false, codeInterpreter: false },
    });
    useAppStore.getState().bindAssistantGeneration(conversationB, turnB.assistantMessageId, {
      requestId: 'request-b',
      options: { reasoningEffort: 'medium', verbosity: 'medium', maxOutputTokens: 1024, webSearch: false, codeInterpreter: false },
    });

    useAppStore.getState().appendAssistantDelta(conversationA, turnA.assistantMessageId, ' A', 'request-a-old');
    useAppStore.getState().appendAssistantDelta(conversationA, turnA.assistantMessageId, ' 错误旧回调', 'request-a-new');
    useAppStore.getState().appendAssistantDelta(conversationB, turnB.assistantMessageId, ' B', 'request-b');

    expect(assistantMessage(conversationA, turnA.assistantMessageId)?.content).toBe(' A');
    expect(assistantMessage(conversationB, turnB.assistantMessageId)?.content).toBe(' B');

    useAppStore.getState().completeAssistant(conversationA, turnA.assistantMessageId, { requestId: 'request-a-new', model: 'wrong-model' });
    expect(assistantMessage(conversationA, turnA.assistantMessageId)?.status).toBe('streaming');
    useAppStore.getState().completeAssistant(conversationB, turnB.assistantMessageId, { requestId: 'request-b', model: 'model-a' });
    expect(assistantMessage(conversationB, turnB.assistantMessageId)?.status).toBe('complete');
  });

  it('normalizes conversation titles and rejects empty renames', () => {
    const state = useAppStore.getState();
    const conversationId = state.activeConversationId;

    expect(state.renameConversation(conversationId, '   新的   对话标题   ')).toBe(true);
    expect(useAppStore.getState().conversations.find((item) => item.id === conversationId)?.title).toBe('新的 对话标题');
    expect(state.renameConversation(conversationId, '     ')).toBe(false);
    expect(state.renameConversation(conversationId, 'x'.repeat(100))).toBe(true);
    expect(useAppStore.getState().conversations.find((item) => item.id === conversationId)?.title).toHaveLength(80);
  });

});


describe('companion completion and background messages', () => {
  beforeEach(() => { vi.useFakeTimers(); useAppStore.getState().clearConversations(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
  it('splits messages without losing later sentences and removes intentional empty companion replies', () => {
    const state = useAppStore.getState(); const id = state.activeConversationId;
    useAppStore.setState({ conversations: state.conversations.map(c => c.id === id ? { ...c, companionId: 'companion-a' } : c) });
    const turn = state.beginTurn('你好', [], id, 'companion-model');
    state.completeAssistant(id, turn.assistantMessageId, { segments: ['一', '二', '三', '四', '五', '六'], model: 'companion-model' });
    const messages = useAppStore.getState().conversations.find(c => c.id === id)!.messages;
    expect(messages.filter(m => m.role === 'assistant').map(m => m.content)).toEqual(['一', '二', '三', '四\n五\n六']);
    const silent = state.beginTurn('不用回', [], id, 'companion-model');
    state.completeAssistant(id, silent.assistantMessageId, { segments: [] });
    expect(assistantMessage(id, silent.assistantMessageId)).toBeUndefined();
    expect(useAppStore.getState().conversations.find(c => c.id === id)!.messages.at(-1)?.content).toBe('不用回');
  });

  it('appends a photo once in its own topic while keeping a newer user message', () => {
    const state = useAppStore.getState(); const id = state.activeConversationId;
    useAppStore.setState({ conversations: state.conversations.map(c => c.id === id ? { ...c, companionId: 'companion-a' } : c) });
    state.beginTurn('我去吃饭了', [], id);
    const event = { eventId: 'event-a', companionId: 'companion-a', conversationId: id, kind: 'photo' as const, content: '给你', createdAt: Date.now(), attachments: [{ id: 'image-a', name: '照片.png', mimeType: 'image/png', kind: 'image' as const, size: 100 }] };
    state.appendCompanionEvent(id, { ...event, companionId: 'companion-b' });
    state.appendCompanionEvent(id, { ...event, conversationId: 'other-topic' });
    expect(useAppStore.getState().conversations.find(c => c.id === id)!.messages.some(m => m.sourceEventId)).toBe(false);
    state.appendCompanionEvent(id, event); state.appendCompanionEvent(id, event);
    const messages = useAppStore.getState().conversations.find(c => c.id === id)!.messages;
    expect(messages.filter(m => m.sourceEventId === 'event-a')).toHaveLength(1);
    expect(messages.some(m => m.content === '我去吃饭了')).toBe(true);
    expect(messages.at(-1)).toMatchObject({ content: '给你', attachments: event.attachments, sourceEventId: 'event-a', status: 'complete' });
  });

  it('tracks unread companion messages per topic and clears them when the topic is opened', () => {
    const state = useAppStore.getState();
    const firstTopic = state.newCompanionConversation('companion-a', '角色 A');
    const secondTopic = useAppStore.getState().newCompanionConversation('companion-a', '角色 A');
    const event = {
      eventId: 'event-unread', companionId: 'companion-a', conversationId: firstTopic,
      kind: 'message' as const, content: '你还好吗？', attachments: [], createdAt: Date.now(),
    };

    useAppStore.getState().appendCompanionEvent(firstTopic, event);
    expect(useAppStore.getState().conversations.find(item => item.id === firstTopic)?.unreadCount).toBe(1);

    useAppStore.getState().appendCompanionEvent(firstTopic, event);
    expect(useAppStore.getState().conversations.find(item => item.id === firstTopic)?.unreadCount).toBe(1);

    useAppStore.getState().setActiveConversation(firstTopic);
    expect(useAppStore.getState().conversations.find(item => item.id === firstTopic)?.unreadCount).toBe(0);

    const currentTopicEvent = { ...event, eventId: 'event-current', conversationId: secondTopic };
    useAppStore.getState().setActiveConversation(secondTopic);
    useAppStore.getState().appendCompanionEvent(secondTopic, currentTopicEvent);
    expect(useAppStore.getState().conversations.find(item => item.id === secondTopic)?.unreadCount).toBe(0);
  });
});
