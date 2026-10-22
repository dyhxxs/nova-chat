import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectVoiceAudio, mp3DurationMs, VoiceProvider } from '../src/voiceProvider.js';
afterEach(() => vi.unstubAllGlobals());
describe('relay voice adapter', () => {
  it('uses native audio input and strips private thinking from transcripts', async () => {
    const request = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ thought: true, text: 'private reasoning' }, { text: '晚上好，今天过得怎么样？' }] } }] }), { status: 200 }));
    vi.stubGlobal('fetch', request);
    const service = new VoiceProvider('https://relay.test/v1/', 'synthetic-secret', 'doubao-tts-2.0', 'gem-3.8-flash');
    expect(await service.transcribe(Buffer.from('recorded-audio'), 'audio/mp4')).toBe('晚上好，今天过得怎么样？');
    expect(request.mock.calls[0]?.[0]).toBe('https://relay.test/v1beta/models/gem-3.8-flash:generateContent');
    const body = JSON.parse(request.mock.calls[0]![1].body as string);
    expect(body.contents[0].parts[1].inlineData.mimeType).toBe('audio/mp4');
    expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(0);
  });
  it('uses HD clone parameters without sending Doubao-only fields', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ code: 200, data: { task_id: 42 } })));
    vi.stubGlobal('fetch', request);
    expect(await new VoiceProvider('https://relay.test/v1', 'key', 'speech-2.8', 'asr').submit('刚忙完呀', 'LK_test')).toBe('42');
    const body = JSON.parse((request.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ model: 'speech-2.8', prompt: '刚忙完呀', params: { voice_id: 'LK_test', quality: 'hd', speed: '1', pitch: '0', emotion: 'auto', sound_effects: 'none' } });
  });
  it('checks business errors even when the relay responds with HTTP 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 402, msg: 'secret-upstream-detail' }), { status: 200 })));
    await expect(new VoiceProvider('https://relay.test/v1', 'key', 'tts', 'asr').submit('hello', 'voice')).rejects.toThrow('额度不足');
  });
  it('handles asynchronous completion and refuses empty/no-speech results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ candidates: [] }))));
    await expect(new VoiceProvider('https://relay.test/v1', 'key', 'tts', 'asr').transcribe(Buffer.alloc(20), 'audio/wav')).rejects.toMatchObject({ code: 'voice_no_speech' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ is_final: true, state: 'failed', error: 'secret' }))));
    expect(await new VoiceProvider('https://relay.test/v1', 'key', 'tts', 'asr').status('123')).toEqual({ state: 'error' });
  });
  it('recognizes native/web recordings and measures actual MP3 frames', () => {
    expect(detectVoiceAudio(Buffer.from('<html>not audio</html>'))).toBeUndefined();
    expect(detectVoiceAudio(Buffer.concat([Buffer.from([0,0,0,24]), Buffer.from('ftypM4A '), Buffer.alloc(8)]))?.mimeType).toBe('audio/mp4');
    expect(detectVoiceAudio(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(16)]))?.mimeType).toBe('audio/ogg');
    const frame = Buffer.alloc(417); frame.set([255,251,144,0]);
    expect(mp3DurationMs(Buffer.concat(Array.from({length: 100}, () => frame)))).toBe(2612);
  });
});
