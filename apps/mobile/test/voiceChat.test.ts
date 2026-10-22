import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, AppMessage } from '../src/types';
const mocks = vi.hoisted(() => ({ submit: vi.fn(), get: vi.fn(), update: vi.fn(), stopSpeech: vi.fn(async () => {}), mode: vi.fn(async () => {}), alert: vi.fn(), player: { pause: vi.fn(), replace: vi.fn(), play: vi.fn() }, state: undefined as any, appState: undefined as undefined | ((state: string) => void) }));
vi.mock('expo-audio', () => ({ useAudioPlayer: () => mocks.player, useAudioPlayerStatus: () => ({ duration: 4, currentTime: 1 }), setAudioModeAsync: mocks.mode }));
vi.mock('expo-speech', () => ({ stop: mocks.stopSpeech }));
vi.mock('react-native', () => ({ Alert: { alert: mocks.alert }, AppState: { addEventListener: (_event: string, callback: (state: string) => void) => { mocks.appState = callback; return { remove: vi.fn() }; } } }));
vi.mock('../src/store/useAppStore', () => ({ useAppStore: { getState: () => mocks.state } }));
vi.mock('../src/services/voiceClient', () => ({ submitSpeech: mocks.submit, getSpeech: mocks.get }));
import { useVoiceChat } from '../src/hooks/useVoiceChat';
const requestId = '11111111-1111-4111-8111-111111111111';
let conversation: Conversation, root: ReactTestRenderer | undefined, controls: ReturnType<typeof useVoiceChat>;
function Harness({ value = conversation }: { value?: Conversation }) { controls = useVoiceChat(value, 'https://gateway.test', 'synthetic-session'); return null; }
async function mount() { await act(async () => { root = create(createElement(Harness)); }); }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); vi.clearAllMocks(); conversation = { id: 'chat', title: '语音', createdAt: 0, updatedAt: 0, messages: [{ id: 'message', role: 'assistant', content: '晚上好呀', createdAt: 0, status: 'complete', attachments: [], voice: { status: 'pending', durationMs: 0, requestId } }] }; mocks.state = { accessToken: 'synthetic-session', settings: { serverUrl: 'https://gateway.test' }, conversations: [conversation], setMessageVoice: mocks.update }; mocks.submit.mockResolvedValue({ status: 'pending', durationMs: 0, requestId }); mocks.get.mockResolvedValue({ status: 'ready', durationMs: 2000, requestId, fileId: '22222222-2222-4222-8222-222222222222' }); });
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); root = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('voice generation recovery and playback', () => {
  it('plays an unsent local recording and never submits it to text-to-speech', async () => {
    conversation.messages[0] = { ...conversation.messages[0]!, role: 'user', content: '', voice: { status: 'pending', requestId, durationMs: 3000, localRecording: { uri: 'file:///local.m4a', mimeType: 'audio/mp4' } } };
    await mount();
    expect(mocks.submit).not.toHaveBeenCalled();
    await act(async () => controls.play(conversation.messages[0]!));
    expect(mocks.player.replace).toHaveBeenLastCalledWith({ uri: 'file:///local.m4a' });
    await act(async () => controls.retry({ ...conversation.messages[0]!, voice: { ...conversation.messages[0]!.voice!, status: 'error' } }));
    expect(mocks.update).toHaveBeenLastCalledWith('chat', 'message', expect.objectContaining({ status: 'pending', requestId }));
  });
  it('generates companion text playback with the conversation voice instead of system speech', async () => {
    conversation.voicePreferences={replyMode:'text',voiceId:'LK_test'};
    conversation.messages[0]!.voice=undefined;
    await mount();
    await act(async () => { controls.readAloud(conversation.messages[0]!); });
    expect(mocks.update).toHaveBeenCalledWith('chat','message',expect.objectContaining({status:'pending',voiceId:'LK_test'}));
    expect(mocks.stopSpeech).toHaveBeenCalled();
  });
  it('plays a requested text message when its cloned audio becomes ready', async () => {
    conversation.messages[0]!.voice=undefined;
    await mount(); await act(async () => { controls.readAloud(conversation.messages[0]!); });
    const ready={...conversation,messages:[{...conversation.messages[0]!,voice:{status:'ready' as const,requestId,durationMs:2000,fileId:'22222222-2222-4222-8222-222222222222'}}]};
    await act(async () => { root!.update(createElement(Harness,{value:ready})); });
    expect(mocks.player.play).toHaveBeenCalledOnce();
  });
  it('cancels requested text playback when the app goes to the background', async () => {
    conversation.messages[0]!.voice=undefined;
    await mount(); await act(async () => { controls.readAloud(conversation.messages[0]!); mocks.appState!('background'); });
    const ready={...conversation,messages:[{...conversation.messages[0]!,voice:{status:'ready' as const,requestId,durationMs:2000,fileId:'22222222-2222-4222-8222-222222222222'}}]};
    await act(async () => { root!.update(createElement(Harness,{value:ready})); });
    expect(mocks.player.play).not.toHaveBeenCalled();
  });
  it('recovers a lost paid POST response by querying the same request ID', async () => { mocks.submit.mockRejectedValue(new Error('连接中断')); await mount(); expect(mocks.submit).toHaveBeenCalledOnce(); expect(mocks.get).toHaveBeenCalledWith('https://gateway.test', 'synthetic-session', requestId, expect.any(AbortSignal)); expect(mocks.update).toHaveBeenCalledWith('chat', 'message', expect.objectContaining({ status: 'ready' })); });
  it('offers retry with the original ID when the task cannot yet be recovered', async () => { mocks.submit.mockRejectedValue(new Error('网络不可用')); mocks.get.mockRejectedValue(new Error('网络不可用')); await mount(); const voice = mocks.update.mock.calls[0]![2]; expect(voice).toMatchObject({ status: 'error', resumable: true, requestId }); await act(async () => { controls.retry({ ...conversation.messages[0]!, voice }); }); expect(mocks.update.mock.calls.at(-1)![2]).toMatchObject({ status: 'pending', requestId }); expect(mocks.submit).toHaveBeenCalledOnce(); });
  it('uses a fresh ID only after a known terminal failure', async () => { await mount(); const message: AppMessage = { ...conversation.messages[0]!, voice: { status: 'error', requestId, durationMs: 0, error: '合成失败' } }; await act(async () => { controls.retry(message); }); expect(mocks.update.mock.calls.at(-1)![2].requestId).not.toBe(requestId); });
  it('ignores an old provider response after an account change', async () => { let resolve!: (value: unknown) => void; mocks.submit.mockImplementation(() => new Promise(done => { resolve = done; })); await mount(); mocks.state.accessToken = 'new-session'; await act(async () => { resolve({ status: 'pending', durationMs: 0, requestId }); }); expect(mocks.update).not.toHaveBeenCalled(); });
  it('plays authenticated audio, stops the previous reader and stops on background', async () => { await mount(); const message: AppMessage = { ...conversation.messages[0]!, voice: { status: 'ready', requestId, durationMs: 3000, fileId: '22222222-2222-4222-8222-222222222222' } }; await act(async () => { await controls.play(message); }); expect(mocks.stopSpeech).toHaveBeenCalled(); expect(mocks.player.replace).toHaveBeenLastCalledWith({ uri: 'https://gateway.test/v1/files/22222222-2222-4222-8222-222222222222', headers: { 'x-nova-app-version': '1.1.31', 'x-nova-app-version-code': '33', Authorization: 'Bearer synthetic-session' } }); expect(mocks.player.play).toHaveBeenCalledOnce(); await act(async () => { mocks.appState!('background'); }); expect(controls.playingId).toBeUndefined(); expect(mocks.player.replace).toHaveBeenLastCalledWith(null); });
});
