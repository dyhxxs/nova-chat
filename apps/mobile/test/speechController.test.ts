import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpeechController, type SpeechDriver } from '../src/lib/speechController';
import { accountScope } from '../src/lib/accountScope';
import { isSpeechSourceCurrent, type SpeechContext, type SpeechSource } from '../src/lib/speechSource';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture(content = '第一段。'.repeat(120)) {
  const context: SpeechContext = { dataOwnerId: 'user-a', dataOwnerServerUrl: 'https://a.test', accessToken: 'synthetic-only', activeConversationId: 'chat-a', conversations: [{ id: 'chat-a', messages: [{ id: 'answer', role: 'assistant', status: 'complete', content, createdAt: 1, attachments: [] }] }] };
  const source: SpeechSource = { scope: accountScope(context), conversationId: 'chat-a', messageId: 'answer', content };
  let available = true;
  const speak = vi.fn<SpeechDriver['speak']>();
  const stop = vi.fn<SpeechDriver['stop']>().mockResolvedValue();
  const notify = vi.fn();
  const controller = new SpeechController({ maxLength: 4000, speak, stop }, input => available && isSpeechSourceCurrent(input, context), notify);
  return { context, source, speak, stop, notify, controller, unavailable: () => { available = false; controller.refresh(); }, options: (index = 0) => speak.mock.calls[index]![1] };
}
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => vi.useRealTimers());

describe('read-aloud controller', () => {
  it('does not autoplay; waits for old stop before sending one chunk', async () => {
    const f = fixture(); expect(f.speak).not.toHaveBeenCalled();
    let finish!: () => void; f.stop.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const task = f.controller.start(f.source, 0.8, 'zh-CN'); await flush();
    expect(f.speak).not.toHaveBeenCalled(); finish(); await task;
    expect(f.speak).toHaveBeenCalledTimes(1); expect(f.options().rate).toBe(0.8); expect(f.options().language).toBe('zh-CN');
    expect(f.speak.mock.calls[0]![0].length).toBeLessThanOrEqual(200);
    f.options().onStart(); expect(f.controller.getState().phase).toBe('speaking');
    f.controller.dispose();
  });
  it('queues only after completion, ignores duplicate and old chunk callbacks', async () => {
    const f = fixture(); await f.controller.start(f.source);
    const old = f.options(); old.onStart(); old.onDone(); old.onDone(); await flush();
    expect(f.speak).toHaveBeenCalledTimes(2);
    old.onError(); old.onStopped(); old.onStart();
    expect(f.controller.getState().phase).toBe('preparing');
    f.controller.dispose();
  });
  it('finishes all chunks and clears private source state', async () => {
    const f = fixture('短回复'); await f.controller.start(f.source); f.options().onDone(); await flush();
    expect(f.controller.getState()).toEqual({ phase: 'idle', chunk: 0, total: 0 });
    expect(JSON.stringify(f.notify.mock.calls)).not.toContain('短回复');
    expect(JSON.stringify(f.notify.mock.calls)).not.toContain('synthetic-only');
    f.controller.dispose();
  });
  it('waits for native readiness without submitting text, then rechecks authority', async () => {
    const f = fixture(); let ready!: () => void;
    const prepare = vi.fn(() => new Promise<void>(resolve => { ready = resolve; }));
    const controller = new SpeechController({ maxLength: 4000, speak: f.speak, stop: f.stop, prepare }, input => isSpeechSourceCurrent(input, f.context), f.notify);
    const task = controller.start(f.source); await flush(); expect(f.speak).not.toHaveBeenCalled();
    f.context.accessToken = ''; controller.refresh(); ready(); await task;
    expect(f.speak).not.toHaveBeenCalled(); controller.dispose(); f.controller.dispose();
  });
  it('times out readiness and never submits canceled text on late engine initialization', async () => {
    const f = fixture(); let ready!: () => void;
    const controller = new SpeechController({ maxLength: 4000, speak: f.speak, stop: f.stop, prepare: () => new Promise<void>(resolve => { ready = resolve; }) }, () => true, f.notify);
    const task = controller.start(f.source); await flush(); await vi.advanceTimersByTimeAsync(10001); await task;
    expect(controller.getState().phase).toBe('error'); ready(); await flush(); expect(f.speak).not.toHaveBeenCalled(); controller.dispose(); f.controller.dispose();
  });
  it('manual stop prevents any queued or late speech', async () => {
    const f = fixture(); await f.controller.start(f.source); f.controller.cancel();
    f.options().onDone(); f.options().onError(); await flush();
    expect(f.speak).toHaveBeenCalledTimes(1); expect(f.controller.getState().phase).toBe('idle');
    f.controller.dispose();
  });
  it('does not resurrect a canceled request after slow stop completes', async () => {
    const f = fixture(); let finish!: () => void;
    f.stop.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const task = f.controller.start(f.source); await flush(); f.controller.cancel(); finish(); await task; await flush();
    expect(f.speak).not.toHaveBeenCalled(); f.controller.dispose();
  });
  it('two rapid starts only speak the latest request after serialized stops', async () => {
    const f = fixture('hello'); let finish!: () => void;
    f.stop.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = f.controller.start(f.source, 0.8); await flush();
    const second = f.controller.start(f.source, 1.2, 'en-US'); finish(); await Promise.all([first, second]);
    expect(f.speak).toHaveBeenCalledTimes(1); expect(f.options().rate).toBe(1.2); expect(f.options().language).toBe('en-US');
    f.controller.dispose();
  });
  it('background or route blur invalidates the active source immediately', async () => {
    const f = fixture(); await f.controller.start(f.source); f.unavailable(); f.options().onDone(); await flush();
    expect(f.controller.getState().phase).toBe('idle'); expect(f.speak).toHaveBeenCalledTimes(1); f.controller.dispose();
  });
  it.each(['account', 'session', 'gateway', 'conversation', 'deleted', 'regenerated', 'changed'] as const)('stops on %s change and rejects stale replay', async change => {
    const f = fixture(); await f.controller.start(f.source);
    switch (change) {
      case 'account': f.context.dataOwnerId = 'user-b'; break;
      case 'session': f.context.accessToken = 'other-synthetic'; break;
      case 'gateway': f.context.dataOwnerServerUrl = 'https://b.test'; break;
      case 'conversation': f.context.activeConversationId = 'chat-b'; break;
      case 'deleted': f.context.conversations = []; break;
      case 'regenerated': f.context.conversations[0]!.messages[0]!.status = 'streaming'; break;
      case 'changed': f.context.conversations[0]!.messages[0]!.content = 'replacement'; break;
    }
    f.controller.refresh(); f.options().onDone(); await f.controller.start(f.source); await flush();
    expect(f.controller.getState().phase).toBe('idle'); expect(f.speak).toHaveBeenCalledTimes(1); f.controller.dispose();
  });
  it('unrelated conversation changes do not stop the active answer', async () => {
    const f = fixture(); await f.controller.start(f.source);
    f.context.conversations.push({ id: 'unrelated', messages: [] }); f.controller.refresh();
    expect(f.controller.getState().phase).toBe('preparing'); f.controller.dispose();
  });
  it('checks authority again even if a store subscription was delayed', async () => {
    const f = fixture(); let finish!: () => void;
    f.stop.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const task = f.controller.start(f.source); await flush(); f.context.accessToken = ''; finish(); await task;
    expect(f.speak).not.toHaveBeenCalled(); f.controller.dispose();
  });
  it('fails closed on stop rejection rather than overlapping audio', async () => {
    const f = fixture(); f.stop.mockRejectedValueOnce(new Error('secret engine output'));
    await f.controller.start(f.source); expect(f.speak).not.toHaveBeenCalled();
    expect(f.controller.getState().phase).toBe('error'); expect(JSON.stringify(f.notify.mock.calls)).not.toContain('secret'); f.controller.dispose();
  });
  it('times out a hung stop without speaking and ignores its late resolution', async () => {
    const f = fixture(); let finish!: () => void;
    f.stop.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const task = f.controller.start(f.source); await flush(); await vi.advanceTimersByTimeAsync(3001); await task;
    expect(f.controller.getState().phase).toBe('error'); expect(f.speak).not.toHaveBeenCalled();
    finish(); await flush(); expect(f.speak).not.toHaveBeenCalled(); f.controller.dispose();
  });
  it('start watchdog stops a silent engine and ignores late callbacks', async () => {
    const f = fixture(); await f.controller.start(f.source); await vi.advanceTimersByTimeAsync(10001);
    expect(f.controller.getState().phase).toBe('error'); f.options().onStart(); f.options().onDone(); await flush();
    expect(f.speak).toHaveBeenCalledTimes(1); f.controller.dispose();
  });
  it('completion watchdog prevents a permanently stuck segment', async () => {
    const f = fixture(); await f.controller.start(f.source); f.options().onStart(); await vi.advanceTimersByTimeAsync(180001);
    expect(f.controller.getState().phase).toBe('error'); f.controller.dispose();
  });
  it.each(['callback', 'throw'] as const)('sanitizes engine %s failures', async mode => {
    const f = fixture();
    if (mode === 'throw') f.speak.mockImplementationOnce(() => { throw new Error('private text from engine'); });
    await f.controller.start(f.source); if (mode === 'callback') f.options().onError();
    expect(f.controller.getState().phase).toBe('error'); expect(JSON.stringify(f.notify.mock.calls)).not.toContain('private'); f.controller.dispose();
  });
  it('native stop callbacks clear state without resuming', async () => {
    const f = fixture(); await f.controller.start(f.source); f.options().onStopped(); await flush();
    expect(f.controller.getState().phase).toBe('idle'); expect(f.speak).toHaveBeenCalledTimes(1); f.controller.dispose();
  });
  it('rejects unspoken content without sending it to the engine', async () => {
    const f = fixture('```\nprivate code\n```'); await f.controller.start(f.source);
    expect(f.controller.getState().phase).toBe('error'); expect(f.speak).not.toHaveBeenCalled(); f.controller.dispose();
  });
  it('disposing stops playback and disables future notifications and starts', async () => {
    const f = fixture(); await f.controller.start(f.source); f.controller.dispose(); const count = f.notify.mock.calls.length;
    f.options().onDone(); f.options().onError(); await f.controller.start(f.source); await flush();
    expect(f.notify).toHaveBeenCalledTimes(count); expect(f.speak).toHaveBeenCalledTimes(1);
  });
  it('does not offer incomplete replies or user messages', () => {
    const f = fixture(); const message = f.context.conversations[0]!.messages[0]!;
    for (const status of ['streaming', 'error', 'cancelled'] as const) { message.status = status; expect(isSpeechSourceCurrent(f.source, f.context)).toBe(false); }
    message.status = 'complete'; message.role = 'user'; expect(isSpeechSourceCurrent(f.source, f.context)).toBe(false); f.controller.dispose();
  });
});
