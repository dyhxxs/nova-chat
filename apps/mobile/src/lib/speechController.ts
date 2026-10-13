import { prepareSpeechText, splitSpeechText } from './speechText';
import type { SpeechSource } from './speechSource';
export type SpeechRate = 0.8 | 1 | 1.2;
export type SpeechLanguage = 'auto' | 'zh-CN' | 'en-US';
export type SpeechState = { phase: 'idle' | 'preparing' | 'speaking' | 'error'; messageId?: string; chunk: number; total: number; error?: string };
export type SpeechDriver = {
  maxLength: number;
  prepare?: () => Promise<void>;
  stop: () => Promise<void>;
  speak: (text: string, options: { rate: number; language?: string; onStart: () => void; onDone: () => void; onStopped: () => void; onError: () => void }) => void;
};
const idle = (): SpeechState => ({ phase: 'idle', chunk: 0, total: 0 });
const engineError = '朗读未能完成。请检查系统文字转语音设置、可用声音和媒体音量；iPhone还需关闭静音模式。';

/** One utterance at a time; stale callbacks never enqueue additional private text. */
export class SpeechController {
  private sequence = 0;
  private source?: SpeechSource;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private stopQueue: Promise<void> = Promise.resolve();
  private state = idle();
  constructor(private driver: SpeechDriver, private isCurrent: (source: SpeechSource) => boolean, private notify: (state: SpeechState) => void) {}
  getState() { return this.state; }
  private publish(state: SpeechState) { this.state = state; if (!this.disposed) this.notify(state); }
  private clearTimer() { if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined; }
  private queueStop() {
    const stopped = this.stopQueue.catch(() => undefined).then(() => this.driver.stop());
    this.stopQueue = stopped;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('stop timeout')), 3000);
      stopped.then(() => { clearTimeout(timer); resolve(); }, () => { clearTimeout(timer); reject(new Error('stop failed')); });
    });
  }
  private valid(id: number, source: SpeechSource) { return !this.disposed && id === this.sequence && this.isCurrent(source); }
  private fail(id: number, error: string) {
    if (this.disposed || id !== this.sequence) return;
    this.sequence++; this.clearTimer(); this.source = undefined;
    this.publish({ phase: 'error', chunk: 0, total: 0, error });
    void this.queueStop().catch(() => undefined);
  }
  cancel() {
    if (this.disposed) return;
    const id = ++this.sequence; this.clearTimer(); this.source = undefined; this.publish(idle());
    void this.queueStop().catch(() => {
      if (!this.disposed && id === this.sequence) this.publish({ phase: 'error', chunk: 0, total: 0, error: '语音服务未确认停止，请检查系统媒体播放；在确认停止前不会开始新的朗读。' });
    });
  }
  refresh() { if (this.source && !this.isCurrent(this.source)) this.cancel(); }
  async start(source: SpeechSource, rate: SpeechRate = 1, language: SpeechLanguage = 'auto') {
    if (this.disposed || !this.isCurrent(source)) return;
    const id = ++this.sequence;
    this.clearTimer(); this.source = source;
    this.publish({ phase: 'preparing', messageId: source.messageId, chunk: 0, total: 0 });
    let chunks: string[];
    try {
      if (![0.8, 1, 1.2].includes(rate) || !['auto', 'zh-CN', 'en-US'].includes(language)) throw new Error('请选择支持的语速和语言。');
      chunks = splitSpeechText(prepareSpeechText(source.content).text, this.driver.maxLength);
    } catch (error) { this.fail(id, error instanceof Error ? error.message : '无法准备朗读正文。'); return; }
    try { await this.queueStop(); }
    catch { this.fail(id, '语音服务未确认停止旧播放，请稍后重试或检查系统文字转语音设置。'); return; }
    if (!this.valid(id, source)) { if (id === this.sequence) this.cancel(); return; }
    // Android Expo Speech may queue text before TTS initialization, and stop() does
    // not clear that module-level queue. Never submit any text until voices are ready.
    if (this.driver.prepare) {
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('prepare timeout')), 10000);
          Promise.resolve().then(() => this.driver.prepare!()).then(
            () => { clearTimeout(timer); resolve(); },
            () => { clearTimeout(timer); reject(new Error('prepare failed')); },
          );
        });
      } catch { this.fail(id, engineError); return; }
    }
    if (!this.valid(id, source)) { if (id === this.sequence) this.cancel(); return; }
    const utteranceLanguage = language === 'auto' ? (/[\p{Script=Han}]/u.test(source.content) ? 'zh-CN' : undefined) : language;
    const next = (index: number) => {
      if (!this.valid(id, source)) { if (id === this.sequence) this.cancel(); return; }
      if (index >= chunks.length) { this.source = undefined; this.clearTimer(); this.publish(idle()); return; }
      const text = chunks[index]!;
      let finished = false;
      const current = () => !finished && this.valid(id, source);
      this.publish({ phase: 'preparing', messageId: source.messageId, chunk: index + 1, total: chunks.length });
      const timeout = () => { if (current()) { finished = true; this.fail(id, engineError); } else if (!finished && id === this.sequence) this.cancel(); };
      this.timer = setTimeout(timeout, 10000);
      try {
        this.driver.speak(text, {
          rate, language: utteranceLanguage,
          onStart: () => {
            if (!current()) return;
            this.clearTimer(); this.timer = setTimeout(timeout, 180000);
            this.publish({ phase: 'speaking', messageId: source.messageId, chunk: index + 1, total: chunks.length });
          },
          onDone: () => {
            if (!current()) return;
            finished = true; this.clearTimer(); queueMicrotask(() => next(index + 1));
          },
          onStopped: () => { if (current()) { finished = true; this.cancel(); } },
          onError: () => { if (current()) { finished = true; this.fail(id, engineError); } },
        });
      } catch { if (current()) { finished = true; this.fail(id, engineError); } }
    };
    next(0);
  }
  dispose() { this.cancel(); this.disposed = true; }
}
