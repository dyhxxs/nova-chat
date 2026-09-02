import { describe, expect, it } from 'vitest';
import { titleFromMessage } from '../src/lib/title';

describe('titleFromMessage', () => {
  it('creates a compact title', () => {
    expect(titleFromMessage('  帮我   写一封邮件  ')).toBe('帮我 写一封邮件');
    expect(titleFromMessage('a'.repeat(40))).toBe(`${'a'.repeat(28)}…`);
  });
});
