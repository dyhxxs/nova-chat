import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { speechDriver } from '../src/services/speechDriver.web';
const options = () => ({ rate: 0.8, language: 'zh-CN', onStart: vi.fn(), onDone: vi.fn(), onStopped: vi.fn(), onError: vi.fn() });
class Utterance { rate = 1; lang = ''; onstart?: () => void; onend?: () => void; onerror?: () => void; constructor(public text: string) {} }
const speak = vi.fn(); const cancel = vi.fn();
beforeEach(() => { speak.mockReset(); cancel.mockReset(); vi.stubGlobal('speechSynthesis', { speak, cancel }); vi.stubGlobal('SpeechSynthesisUtterance', Utterance); });
afterEach(async () => { await speechDriver.stop(); vi.unstubAllGlobals(); });
describe('browser speech adapter', () => {
  it('uses browser speech, selected rate/language and explicit callbacks', () => {
    const callbacks = options(); speechDriver.speak('合成测试', callbacks);
    const utterance = speak.mock.calls[0]![0] as Utterance;
    expect(utterance.text).toBe('合成测试'); expect(utterance.rate).toBe(0.8); expect(utterance.lang).toBe('zh-CN');
    utterance.onstart!(); utterance.onend!(); expect(callbacks.onStart).toHaveBeenCalledOnce(); expect(callbacks.onDone).toHaveBeenCalledOnce();
  });
  it('routes browser synthesis errors through the bounded controller callback', () => {
    const callbacks = options(); speechDriver.speak('测试', callbacks); (speak.mock.calls[0]![0] as Utterance).onerror!(); expect(callbacks.onError).toHaveBeenCalledOnce();
  });
  it('cancels instead of pausing or leaving queued text', async () => { await speechDriver.stop(); expect(cancel).toHaveBeenCalledOnce(); });
  it('unsupported browsers fail synchronously, not as an unhandled rejection', async () => {
    vi.stubGlobal('speechSynthesis', undefined);
    expect(() => speechDriver.speak('测试', options())).toThrow('unavailable'); await expect(speechDriver.stop()).resolves.toBeUndefined();
  });
  it('propagates synchronous engine failure for sanitized controller handling', () => {
    speak.mockImplementationOnce(() => { throw new Error('synthetic failure'); });
    expect(() => speechDriver.speak('测试', options())).toThrow('synthetic failure');
  });
});
