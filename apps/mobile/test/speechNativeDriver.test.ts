import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ voices: vi.fn(), stop: vi.fn(), speak: vi.fn() }));
vi.mock('expo-speech', () => ({ maxSpeechInputLength: 4000, getAvailableVoicesAsync: native.voices, stop: native.stop, speak: native.speak }));
const options = (language?: string) => ({ rate: 1, language, onStart: vi.fn(), onDone: vi.fn(), onStopped: vi.fn(), onError: vi.fn() });
beforeEach(() => {
  vi.resetModules(); native.stop.mockReset().mockResolvedValue(undefined); native.speak.mockReset();
  native.voices.mockReset().mockResolvedValue([{ identifier: 'zh-voice', language: 'zh-CN', name: 'Synthetic Chinese', quality: 'Default' }, { identifier: 'en-voice', language: 'en-US', name: 'Synthetic English', quality: 'Default' }]);
});
afterEach(() => vi.restoreAllMocks());
describe('native TTS initialization and voice selection', () => {
  it('never accepts text before initialization, then selects the exact language voice', async () => {
    const { speechDriver } = await import('../src/services/speechDriver');
    expect(() => speechDriver.speak('不应排队的私有文本', options('zh-CN'))).toThrow('prepared');
    expect(native.speak).not.toHaveBeenCalled(); await speechDriver.prepare!(); speechDriver.speak('合成中文', options('zh-CN'));
    expect(native.speak.mock.calls[0]![1].voice).toBe('zh-voice');
  });
  it('shares a pending readiness request rather than adding native pending operations', async () => {
    let finish!: (voices: unknown[]) => void; native.voices.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { speechDriver } = await import('../src/services/speechDriver');
    const first = speechDriver.prepare!(); const second = speechDriver.prepare!(); expect(first).toBe(second); expect(native.voices).toHaveBeenCalledOnce();
    finish([{ identifier: 'voice', language: 'en-US' }]); await first;
  });
  it('rejects an unavailable engine and allows a later retry', async () => {
    native.voices.mockResolvedValueOnce([]); const { speechDriver } = await import('../src/services/speechDriver');
    await expect(speechDriver.prepare!()).rejects.toThrow('No system'); await speechDriver.prepare!();
    speechDriver.speak('retry', options('en-US')); expect(native.speak).toHaveBeenCalledOnce();
  });
  it('uses a same-language voice for regional tags but refuses unrelated languages', async () => {
    const { speechDriver } = await import('../src/services/speechDriver'); await speechDriver.prepare!();
    speechDriver.speak('hello', options('en-GB')); expect(native.speak.mock.calls[0]![1].voice).toBe('en-voice');
    expect(() => speechDriver.speak('bonjour', options('fr-FR'))).toThrow('not installed');
  });
  it('serializes stopping across controller instances', async () => {
    let finish!: () => void; native.stop.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const { speechDriver } = await import('../src/services/speechDriver'); const first = speechDriver.stop(); const second = speechDriver.stop();
    for (let i = 0; i < 5; i++) await Promise.resolve(); expect(native.stop).toHaveBeenCalledOnce(); finish(); await Promise.all([first, second]); expect(native.stop).toHaveBeenCalledTimes(2);
  });
});
