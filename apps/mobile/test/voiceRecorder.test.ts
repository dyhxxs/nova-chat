import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), prepare: vi.fn(), stop: vi.fn(), record: vi.fn(), mode: vi.fn(), alert: vi.fn(), remove: vi.fn(), deleted: vi.fn(), appState: undefined as undefined | ((state: string) => void), recorder: { isRecording: false, uri: 'file:///voice.m4a' } }));
vi.mock('react-native', () => ({ Alert: { alert: mocks.alert }, Platform: { OS: 'android' }, AppState: { addEventListener: (_event: string, listener: (state: string) => void) => { mocks.appState = listener; return { remove: mocks.remove }; } }, Pressable: 'Pressable', View: 'View', StyleSheet: { create: (styles: unknown) => styles } }));
vi.mock('expo-audio', () => ({ AudioModule: { requestRecordingPermissionsAsync: mocks.permission }, RecordingPresets: { HIGH_QUALITY: {} }, setAudioModeAsync: mocks.mode, useAudioRecorder: () => ({ get isRecording() { return mocks.recorder.isRecording; }, get uri() { return mocks.recorder.uri; }, prepareToRecordAsync: mocks.prepare, stop: mocks.stop, record: mocks.record }), useAudioRecorderState: () => ({ durationMillis: 1000 }) }));
vi.mock('expo-file-system', () => ({ File: class { delete() { mocks.deleted(); } } }));
vi.mock('expo-haptics', () => ({ selectionAsync: vi.fn(async () => {}) }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('../src/components/ThemedText', () => ({ ThemedText: 'Text' }));
vi.mock('../src/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: {} }) }));
import { VoiceRecorder } from '../src/components/VoiceRecorder';
let root: ReactTestRenderer | undefined;
let onRecorded = vi.fn(async () => true);
const props = () => ({ active: true, disabled: false, onRecordStart: vi.fn(), onRecorded });
const hold = () => root!.root.find(node => typeof node.props.onResponderGrant === 'function');
async function mount() { await act(async () => { root = create(createElement(VoiceRecorder, props())); }); }
async function start() { await act(async () => { hold().props.onResponderGrant({ nativeEvent: { pageY: 200 } }); }); }
async function release(ms = 1200) { await act(async () => { vi.advanceTimersByTime(ms); hold().props.onResponderRelease(); }); }
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.recorder.isRecording = false;
  mocks.permission.mockResolvedValue({ granted: true }); mocks.prepare.mockResolvedValue(undefined); mocks.mode.mockResolvedValue(undefined);
  mocks.record.mockImplementation(() => { mocks.recorder.isRecording = true; }); mocks.stop.mockImplementation(async () => { mocks.recorder.isRecording = false; });
  onRecorded = vi.fn(async () => true);
});
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); root = undefined; vi.useRealTimers(); });
describe('hold-to-record lifecycle', () => {
  it('sends the original recording after release', async () => { await mount(); await start(); await release(); expect(onRecorded).toHaveBeenCalledOnce(); expect(onRecorded.mock.calls[0]).toEqual([expect.objectContaining({ uri: 'file:///voice.m4a', mimeType: 'audio/mp4', durationMs: 1200 }), false]); expect(mocks.stop).toHaveBeenCalledOnce(); });
  it('denied permission never starts or sends a recording', async () => { mocks.permission.mockResolvedValue({ granted: false }); await mount(); await start(); expect(mocks.record).not.toHaveBeenCalled(); expect(onRecorded).not.toHaveBeenCalled(); expect(mocks.alert).toHaveBeenCalled(); });
  it('release while permission is pending does not start later', async () => { let resolve!: (value: { granted: boolean }) => void; mocks.permission.mockImplementation(() => new Promise(done => { resolve = done; })); await mount(); await start(); await release(); await act(async () => { resolve({ granted: true }); }); expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.record).not.toHaveBeenCalled(); });
  it('release while recorder preparation is pending finishes the recording after setup', async () => { let resolve!: () => void; mocks.prepare.mockImplementation(() => new Promise<void>(done => { resolve = done; })); await mount(); await start(); expect(mocks.prepare).toHaveBeenCalledOnce(); await release(); await act(async () => { resolve(); }); await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); expect(mocks.record).toHaveBeenCalledOnce(); expect(mocks.stop).toHaveBeenCalledOnce(); expect(onRecorded).toHaveBeenCalledOnce(); });
  it('sliding up cancels and removes the recording', async () => { await mount(); await start(); await act(async () => { hold().props.onResponderMove({ nativeEvent: { pageY: 100 } }); }); await release(); expect(onRecorded).not.toHaveBeenCalled(); expect(mocks.deleted).toHaveBeenCalled(); });
  it('a short tap refuses an empty voice message', async () => { await mount(); await start(); await release(200); expect(onRecorded).not.toHaveBeenCalled(); expect(mocks.alert).toHaveBeenCalledWith('录音太短', expect.any(String)); });
  it('60-second limit sends once even when the finger releases afterward', async () => { await mount(); await start(); await act(async () => { vi.advanceTimersByTime(60_000); }); await release(0); expect(onRecorded).toHaveBeenCalledOnce(); expect(onRecorded.mock.calls[0]).toEqual([expect.objectContaining({ durationMs: 60_000 }), false]); });
  it('backgrounding and leaving the screen cancel recording', async () => { await mount(); await start(); await act(async () => { mocks.appState!('background'); }); expect(onRecorded).not.toHaveBeenCalled(); expect(mocks.stop).toHaveBeenCalled(); await start(); await act(async () => { root!.update(createElement(VoiceRecorder, { ...props(), active: false })); }); expect(onRecorded).not.toHaveBeenCalled(); });
  it('failed upload retains the same recording ID for retry', async () => { onRecorded.mockResolvedValueOnce(false); await mount(); await start(); await release(); const first = onRecorded.mock.calls[0]; expect(mocks.deleted).not.toHaveBeenCalled(); await act(async () => { root!.root.findByProps({ accessibilityLabel: '重试发送录音' }).props.onPress(); }); expect(onRecorded.mock.calls[1]).toEqual(first); expect(mocks.deleted).toHaveBeenCalled(); });
  it('speech-to-text mode supplies editable text without changing the recording', async () => { await mount(); await act(async () => { root!.root.findByProps({ accessibilityLabel: '切换语音和语音转文字' }).props.onPress(); }); await start(); await release(); expect(onRecorded.mock.calls[0]).toEqual([expect.objectContaining({ uri: 'file:///voice.m4a' }), true]); });
});
