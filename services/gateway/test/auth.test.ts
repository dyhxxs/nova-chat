import { describe, expect, it } from 'vitest';
import { bearerToken, tokenMatches } from '../src/auth.js';

describe('auth', () => {
  it('accepts matching access tokens', () => {
    expect(tokenMatches('secret', 'secret')).toBe(true);
    expect(tokenMatches('wrong', 'secret')).toBe(false);
    expect(tokenMatches(undefined, 'secret')).toBe(false);
  });
  it('allows an empty configured token for local development', () => {
    expect(tokenMatches(undefined, '')).toBe(true);
  });
  it('parses bearer headers', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def');
    expect(bearerToken('Basic abc')).toBeUndefined();
  });
});
