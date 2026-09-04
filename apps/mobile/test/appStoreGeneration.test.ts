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
