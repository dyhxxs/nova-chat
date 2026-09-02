import { describe, expect, it } from 'vitest';
import { normalizeServerUrl, toRestUrl, toWebSocketUrl } from '../src/lib/connection';

describe('connection helpers', () => {
  it('normalizes gateway URLs', () => {
    expect(normalizeServerUrl(' example.com/ ')).toBe('https://example.com');
    expect(toRestUrl('https://example.com/', '/v1/auth/me')).toBe('https://example.com/v1/auth/me');
    expect(toWebSocketUrl('https://example.com/')).toBe('wss://example.com/v1/chat/stream');
  });
});
