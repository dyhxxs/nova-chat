import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@nova-chat/protocol';
import { CompanionChatQueue, completedCompanionContext } from '../src/companionChatQueue.js';
import { ConcurrencyGate } from '../src/limits.js';
const turn = (role: 'user' | 'assistant', content: string): ChatMessage => ({ role, content, attachments: [] });

describe('continuous companion requests', () => {
  it('accepts a burst of messages and executes replies in FIFO order within the account limit', async () => {
    const gate = new ConcurrencyGate(2); const queue = new CompanionChatQueue(gate);
    let release!: () => void; const firstReply = new Promise<void>(resolve => { release = resolve; });
    const starts: number[] = []; let active = 0, peak = 0;
    const tasks = Array.from({ length: 5 }, (_, index) => queue.run('account', new AbortController().signal, async () => {
      starts.push(index); peak = Math.max(peak, ++active); if (index === 0) await firstReply; active -= 1;
    }));
    await Promise.resolve(); expect(starts).toEqual([0]); expect(queue.canAccept('account')).toBe(true);
    release(); await Promise.all(tasks); expect(starts).toEqual([0, 1, 2, 3, 4]); expect(peak).toBe(1);
  });
  it('cancels a waiting reply without stealing a slot held by another request', async () => {
    const gate = new ConcurrencyGate(1); const queue = new CompanionChatQueue(gate);
    expect(gate.acquire('account')).toBe(true);
    const controller = new AbortController(); const report = vi.fn(async () => expect(controller.signal.aborted).toBe(true));
    const pending = queue.run('account', controller.signal, report); controller.abort(); await pending;
    expect(report).toHaveBeenCalledTimes(1); expect(gate.acquire('account')).toBe(false);
    gate.release('account');
  });
  it('waits for an ordinary assistant slot and wakes when that slot is released', async () => {
    const gate = new ConcurrencyGate(1); const queue = new CompanionChatQueue(gate); gate.acquire('account');
    const task = vi.fn(async () => {}); const pending = queue.run('account', new AbortController().signal, task);
    await Promise.resolve(); expect(task).not.toHaveBeenCalled(); gate.release('account'); queue.notifySlotAvailable();
    await pending; expect(task).toHaveBeenCalledTimes(1);
  });
  it('bounds the pending burst and allows other accounts to proceed', async () => {
    const gate = new ConcurrencyGate(1); const queue = new CompanionChatQueue(gate); gate.acquire('busy');
    const controllers = Array.from({ length: 32 }, () => new AbortController());
    const pending = controllers.map(controller => queue.run('busy', controller.signal, async () => {}));
    expect(queue.canAccept('busy')).toBe(false); const other = vi.fn(async () => {});
    await queue.run('other', new AbortController().signal, other); expect(other).toHaveBeenCalledTimes(1);
    controllers.forEach(controller => controller.abort()); await Promise.all(pending); gate.release('busy');
  });
  it('adds replies completed after a later send, while preserving explicit client replies', () => {
    const previous = [turn('user', '你在看什么'), turn('assistant', '我在看《恶意》')];
    const incoming = [turn('user', '你在看什么'), turn('user', '把那本书的封面发给我看看')];
    expect(completedCompanionContext(incoming, previous)).toEqual([...previous, incoming[1]]);
    const complete = [incoming[0]!, turn('assistant', '已收到的两条聊天消息'), incoming[1]!];
    expect(completedCompanionContext(complete, previous)).toEqual(complete);
    expect(completedCompanionContext([turn('user', '别的话题'), incoming[1]!], previous)).toEqual([turn('user', '别的话题'), incoming[1]]);
  });
});
