import { describe, expect, it } from 'vitest';
import { ConcurrencyGate, SlidingWindowLimiter } from '../src/limits.js';

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
