import type { ChatMessage } from '@nova-chat/protocol';
import type { ConcurrencyGate } from './limits.js';

type Entry = { key: string; signal: AbortSignal; task: () => Promise<void>; resolve: () => void; reject: (error: unknown) => void; onAbort: () => void };

/** Accept consecutive companion messages while preserving the account's model concurrency limit. */
export class CompanionChatQueue {
  private readonly pending: Entry[] = [];
  private readonly active = new Set<string>();
  constructor(private readonly gate: ConcurrencyGate) {}

  canAccept(key: string) { return this.pending.filter(entry => entry.key === key).length + Number(this.active.has(key)) < 32; }

  run(key: string, signal: AbortSignal, task: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const entry: Entry = { key, signal, task, resolve, reject, onAbort: () => {
        const index = this.pending.indexOf(entry);
        if (index < 0) return;
        this.pending.splice(index, 1);
        signal.removeEventListener('abort', entry.onAbort);
        // Let the job persist and report cancellation without taking another job's slot.
        void Promise.resolve().then(task).then(resolve, reject);
        this.notifySlotAvailable();
      } };
      this.pending.push(entry);
      signal.addEventListener('abort', entry.onAbort, { once: true });
      if (signal.aborted) entry.onAbort();
      else this.notifySlotAvailable();
    });
  }

  notifySlotAvailable() {
    for (let index = 0; index < this.pending.length;) {
      const entry = this.pending[index]!;
      if (this.active.has(entry.key) || !this.gate.acquire(entry.key)) { index += 1; continue; }
      this.pending.splice(index, 1);
      entry.signal.removeEventListener('abort', entry.onAbort);
      this.active.add(entry.key);
      void Promise.resolve().then(entry.task).then(entry.resolve, entry.reject).finally(() => {
        this.active.delete(entry.key);
        this.gate.release(entry.key);
        this.notifySlotAvailable();
      });
    }
  }
}

/** Fill replies that finished after a later message's client snapshot was sent. */
export function completedCompanionContext(incoming: readonly ChatMessage[], previous: readonly ChatMessage[]): ChatMessage[] {
  const key = (message: ChatMessage) => JSON.stringify([message.content, message.attachments.map(file => file.id)]);
  const users = incoming.flatMap((message, index) => message.role === 'user' ? [index] : []);
  const oldUsers = previous.flatMap((message, index) => message.role === 'user' ? [index] : []);
  if (!oldUsers.length || users.length < 2) return [...incoming];
  // Previous history may be shorter because the gateway keeps only the latest 80 messages.
  let offset = Math.min(users.length - oldUsers.length, users.length - 2);
  for (; offset >= 0; offset -= 1) {
    if (offset + oldUsers.length > users.length - 1) continue;
    if (oldUsers.every((position, index) => key(previous[position]!) === key(incoming[users[offset + index]!]!))) break;
  }
  if (offset < 0) return [...incoming];
  const inserts = new Map<number, ChatMessage[]>();
  for (let index = 0; index < oldUsers.length; index += 1) {
    const userIndex = users[offset + index]!;
    const nextIndex = users[offset + index + 1]!;
    const currentReplies = incoming.slice(userIndex + 1, nextIndex).filter(message => message.role === 'assistant');
    if (currentReplies.length) continue;
    const replies = previous.slice(oldUsers[index]! + 1, oldUsers[index + 1] ?? previous.length).filter(message => message.role === 'assistant');
    if (replies.length) inserts.set(nextIndex, replies);
  }
  return incoming.flatMap((message, index) => [...(inserts.get(index) ?? []), message]);
}
