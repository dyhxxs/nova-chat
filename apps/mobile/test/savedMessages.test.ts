import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn().mockResolvedValue(null), setItem: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn(),
}));

import { useAppStore } from '../src/store/useAppStore';
import { createConversationBackup, mergeConversationBackup, parseConversationBackup } from '../src/lib/conversationBackup';

function assistant(conversationId: string, messageId: string) {
  return useAppStore.getState().conversations.find((item) => item.id === conversationId)?.messages.find((item) => item.id === messageId);
}

describe('saved assistant replies', () => {
  beforeEach(() => {
    useAppStore.getState().clearConversations();
  });

  it('toggles only completed assistant messages and returns the new state', () => {
    const turn = useAppStore.getState().beginTurn('收藏这个回答');
    expect(useAppStore.getState().toggleMessageStarred(turn.conversationId, turn.assistantMessageId)).toBe(false);
    useAppStore.getState().completeAssistant(turn.conversationId, turn.assistantMessageId, { model: 'nova-test' });

    expect(useAppStore.getState().toggleMessageStarred(turn.conversationId, turn.assistantMessageId)).toBe(true);
    expect(assistant(turn.conversationId, turn.assistantMessageId)?.starred).toBe(true);
    expect(useAppStore.getState().toggleMessageStarred(turn.conversationId, turn.assistantMessageId)).toBe(false);
    expect(assistant(turn.conversationId, turn.assistantMessageId)?.starred).toBe(false);
  });

  it('keeps the star flag in portable backups and restores it on additive import', () => {
    const turn = useAppStore.getState().beginTurn('请记住重点');
    useAppStore.getState().completeAssistant(turn.conversationId, turn.assistantMessageId, { model: 'nova-test' });
    useAppStore.getState().toggleMessageStarred(turn.conversationId, turn.assistantMessageId);
    const source = useAppStore.getState().conversations;
    const backup = createConversationBackup(source);
    expect(backup.conversations[0]?.messages[1]?.starred).toBe(true);
    const parsed = parseConversationBackup(JSON.stringify(backup));
    const imported = mergeConversationBackup([], parsed).conversations[0];
    expect(imported?.messages[1]?.starred).toBe(true);
  });
});
