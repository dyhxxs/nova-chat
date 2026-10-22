import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) } }));
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
import { useAppStore } from '../src/store/useAppStore';
import { DEFAULT_VOICE_PREFERENCES, textRequestsVoice, type VoiceMessage } from '../src/lib/voice';
import { restoreLocalRecords } from '../src/lib/localSnapshot';
const recorded: VoiceMessage = { status: 'ready', fileId: '11111111-1111-4111-8111-111111111111', requestId: '22222222-2222-4222-8222-222222222222', durationMs: 2200 };
beforeEach(() => { vi.useFakeTimers(); useAppStore.getState().clearConversations(); });
afterEach(() => { vi.useRealTimers(); });
function finish(voice?: VoiceMessage) { const state = useAppStore.getState(); const turn = state.beginTurn('今晚聊聊吧', [], state.activeConversationId, 'test-model', voice); state.completeAssistant(turn.conversationId, turn.assistantMessageId, { segments: ['刚忙完', '想聊什么？'] }); return useAppStore.getState().conversations.find(item => item.id === turn.conversationId)!; }
describe('voice messages and reply preferences', () => {
  it('auto mode returns multiple voice bubbles to a voice message', () => { const conversation = finish(recorded); expect(conversation.messages[0]!.voice).toEqual(recorded); const replies = conversation.messages.filter(item => item.role === 'assistant'); expect(replies).toHaveLength(2); expect(replies.every(item => item.voice?.status === 'pending')).toBe(true); expect(replies[0]!.voice!.requestId).not.toBe(replies[1]!.voice!.requestId); });
  it('auto mode keeps typed messages as text', () => { expect(finish().messages.filter(item => item.role === 'assistant').every(item => !item.voice)).toBe(true); });
  it.each(['发语音给我听听我想你了', '发一条语音给我', '让我听听你的声音', '用声音回复我', 'voice reply please'])('auto mode speaks when typed request asks for voice: %s', text => {
    const state = useAppStore.getState();
    const turn = state.beginTurn(text, [], state.activeConversationId, 'test-model');
    state.completeAssistant(turn.conversationId, turn.assistantMessageId, { segments: ['好的，我说给你听。'] });
    expect(useAppStore.getState().conversations[0]!.messages.at(-1)!.voice?.status).toBe('pending');
  });
  it('does not treat an explicit request to avoid voice as a voice request', () => {
    expect(textRequestsVoice('不要发语音给我')).toBe(false);
    expect(textRequestsVoice('不用声音回复')).toBe(false);
    expect(finish().messages.filter(item => item.role === 'assistant').every(item => !item.voice)).toBe(true);
  });
  it.each(['voice', 'text'] as const)('honors the explicit %s reply preference', replyMode => { const state = useAppStore.getState(); state.setVoicePreferences(state.activeConversationId!, { ...DEFAULT_VOICE_PREFERENCES, replyMode }); expect(finish(recorded).messages.at(-1)!.voice?.status).toBe(replyMode === 'voice' ? 'pending' : undefined); });
  it('preserves audio, resumable tasks and preferences across local restoration', () => { const conversation = finish(recorded); const last = conversation.messages.at(-1)!; useAppStore.getState().setMessageVoice(conversation.id, last.id, { ...last.voice!, status: 'error', resumable: true, error: '连接中断' }); useAppStore.getState().setVoicePreferences(conversation.id, { ...DEFAULT_VOICE_PREFERENCES, replyMode: 'voice' }); const saved = useAppStore.getState().conversations; const restored = restoreLocalRecords(JSON.parse(JSON.stringify(saved)), []); expect(restored.repaired).toBe(false); expect(restored.conversations[0]!.messages[0]!.voice).toEqual(recorded); expect(restored.conversations[0]!.messages.at(-1)!.voice?.resumable).toBe(true); expect(restored.conversations[0]!.voicePreferences?.replyMode).toBe('voice'); });
  it('applies voice preference to delayed companion messages and deduplicates events', () => { const state = useAppStore.getState(); const id = state.activeConversationId!; const companionId = '33333333-3333-4333-8333-333333333333'; useAppStore.setState({ conversations: state.conversations.map(item => ({ ...item, kind: 'companion', companionId, voicePreferences: { ...DEFAULT_VOICE_PREFERENCES, replyMode: 'voice' } })) }); const event = { eventId: '44444444-4444-4444-8444-444444444444', conversationId: id, companionId, kind: 'message' as const, content: '刚看到你的消息', attachments: [], createdAt: Date.now() }; state.appendCompanionEvent(id, event); state.appendCompanionEvent(id, event); const messages = useAppStore.getState().conversations[0]!.messages; expect(messages).toHaveLength(1); expect(messages[0]!.voice?.status).toBe('pending'); });
  it('clears stale speech when regenerating a reply', () => { const conversation = finish(recorded); const reply = conversation.messages.find(item => item.role === 'assistant')!; expect(useAppStore.getState().prepareRegeneration(conversation.id, reply.id)).toBe(true); expect(useAppStore.getState().conversations[0]!.messages.at(-1)!.voice).toBeUndefined(); });
});


describe('local voice outbox', () => {
  const recording = { uri: 'file:///documents/voice-outbox/test.m4a', durationMs: 2200, mimeType: 'audio/mp4', requestId: recorded.requestId };
  it('stores a playable local bubble immediately, persists it and deduplicates recorder callbacks', () => {
    const state = useAppStore.getState(), id = state.activeConversationId!;
    expect(state.enqueueRecordedVoice(id, recording)).toBe(true);
    expect(state.enqueueRecordedVoice(id, recording)).toBe(true);
    const messages = useAppStore.getState().conversations[0]!.messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'user', content: '', voice: { status: 'pending', localRecording: { uri: recording.uri } } });
    const restored = restoreLocalRecords(JSON.parse(JSON.stringify(useAppStore.getState().conversations)), []);
    expect(restored.repaired).toBe(false);
    expect(restored.conversations[0]!.messages).toEqual(messages);
  });
  it('fills the original bubble once and inserts the reply before the next queued voice', () => {
    const state = useAppStore.getState(), id = state.activeConversationId!;
    state.enqueueRecordedVoice(id, recording);
    state.enqueueRecordedVoice(id, { ...recording, requestId: '33333333-3333-4333-8333-333333333333' });
    const original = useAppStore.getState().conversations[0]!.messages[0]!;
    const turn = state.completeRecordedVoice(id, original.id, '今晚聊聊吧', recorded);
    expect(turn).toBeDefined();
    const messages = useAppStore.getState().conversations[0]!.messages;
    expect(messages.map(item => item.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[0]).toMatchObject({ id: original.id, content: '今晚聊聊吧', voice: recorded });
    expect(messages[0]!.voice?.localRecording).toBeUndefined();
    expect(state.completeRecordedVoice(id, original.id, '重复回调', recorded)).toBeUndefined();
    expect(useAppStore.getState().conversations[0]!.messages).toHaveLength(3);
  });
  it('does not recreate a removed conversation on a late upload result', () => {
    const state = useAppStore.getState(), id = state.activeConversationId!;
    state.enqueueRecordedVoice(id, recording);
    const messageId = useAppStore.getState().conversations[0]!.messages[0]!.id;
    state.clearConversations();
    expect(state.completeRecordedVoice(id, messageId, '迟到的识别结果', recorded)).toBeUndefined();
    expect(useAppStore.getState().conversations[0]!.messages).toHaveLength(0);
  });
});
