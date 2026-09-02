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
