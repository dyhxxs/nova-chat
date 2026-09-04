type Bucket = { count: number; resetAt: number };

export class SlidingWindowLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
  ) {}

  consume(key: string, now = Date.now()): { allowed: boolean; retryAfterMs: number } {
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      this.prune(now);
      return { allowed: true, retryAfterMs: 0 };
    }
    if (existing.count >= this.limit) {
      return { allowed: false, retryAfterMs: Math.max(0, existing.resetAt - now) };
    }
    existing.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  private prune(now: number) {
    if (this.buckets.size < 1_000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

type SemaphoreWaiter = {
  signal?: AbortSignal;
  resolve: (release: () => void) => void;
  reject: (reason: unknown) => void;
  onAbort?: () => void;
};

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

/**
 * A small FIFO semaphore for work shared by all authenticated users of one
 * gateway process. Waiting callers can be cancelled without consuming a slot.
 */
export class AsyncSemaphore {
  private readonly queue: SemaphoreWaiter[] = [];
  private active = 0;

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('AsyncSemaphore limit must be a positive integer');
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.releaseOnce());
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter: SemaphoreWaiter = { signal, resolve, reject };
      const onAbort = () => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) this.queue.splice(index, 1);
        signal?.removeEventListener('abort', onAbort);
        reject(abortError());
      };
      waiter.onAbort = onAbort;
      signal?.addEventListener('abort', onAbort, { once: true });
      this.queue.push(waiter);
    });
  }

  private releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.pump();
    };
  }

  private pump() {
    while (this.active < this.limit && this.queue.length) {
      const waiter = this.queue.shift()!;
      waiter.signal?.removeEventListener('abort', waiter.onAbort!);
      if (waiter.signal?.aborted) {
        waiter.reject(abortError());
        continue;
      }
      this.active += 1;
      waiter.resolve(this.releaseOnce());
    }
  }
}

export class ConcurrencyGate {
  private readonly active = new Map<string, number>();
  constructor(private readonly limit: number) {}

  acquire(key: string): boolean {
    const current = this.active.get(key) ?? 0;
    if (current >= this.limit) return false;
    this.active.set(key, current + 1);
    return true;
  }

  release(key: string) {
    const current = this.active.get(key) ?? 0;
    if (current <= 1) this.active.delete(key);
    else this.active.set(key, current - 1);
  }
}
