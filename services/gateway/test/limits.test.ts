import { describe, expect, it } from 'vitest';
import { AsyncSemaphore, ConcurrencyGate, SlidingWindowLimiter } from '../src/limits.js';

describe('SlidingWindowLimiter', () => {
  it('limits and resets requests', () => {
    const limiter = new SlidingWindowLimiter(2, 1000);
    expect(limiter.consume('a', 0).allowed).toBe(true);
    expect(limiter.consume('a', 10).allowed).toBe(true);
    expect(limiter.consume('a', 20).allowed).toBe(false);
    expect(limiter.consume('a', 1000).allowed).toBe(true);
  });
});

describe('ConcurrencyGate', () => {
  it('releases capacity', () => {
    const gate = new ConcurrencyGate(1);
    expect(gate.acquire('a')).toBe(true);
    expect(gate.acquire('a')).toBe(false);
    gate.release('a');
    expect(gate.acquire('a')).toBe(true);
  });
});


describe('AsyncSemaphore', () => {
  it('queues work until the current permit is released', async () => {
    const semaphore = new AsyncSemaphore(1);
    const releaseFirst = await semaphore.acquire();
    let acquiredSecond = false;
    const second = semaphore.acquire().then((release) => {
      acquiredSecond = true;
      return release;
    });

    await Promise.resolve();
    expect(acquiredSecond).toBe(false);
    releaseFirst();
    const releaseSecond = await second;
    expect(acquiredSecond).toBe(true);
    releaseSecond();
  });

  it('removes an aborted waiter without consuming capacity', async () => {
    const semaphore = new AsyncSemaphore(1);
    const releaseFirst = await semaphore.acquire();
    const controller = new AbortController();
    const waiting = semaphore.acquire(controller.signal);
    controller.abort();

    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    releaseFirst();
    const releaseNext = await semaphore.acquire();
    releaseNext();
  });
});
