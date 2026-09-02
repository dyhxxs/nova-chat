import { describe, expect, it } from 'vitest';
import { isCorruptedDisplayName, normalizeUserProfile, safeDisplayName } from '../src/lib/userDisplayName';

const baseUser = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  email: 'admin@example.com',
  displayName: '管理员',
  role: 'admin' as const,
  disabled: false,
  createdAt: 0,
  updatedAt: 0,
};

describe('user display name normalization', () => {
  it('detects replacement characters without rejecting normal Chinese names', () => {
    expect(isCorruptedDisplayName('管理员')).toBe(false);
    expect(isCorruptedDisplayName('���')).toBe(true);
    expect(isCorruptedDisplayName('')).toBe(true);
  });

  it('uses a safe administrator fallback for a corrupted name', () => {
    expect(safeDisplayName({ ...baseUser, displayName: '���' })).toBe('管理员');
  });

  it('uses the email local part for a corrupted regular user name', () => {
    expect(safeDisplayName({ ...baseUser, role: 'user', displayName: '�', email: 'zhangsan@example.com' })).toBe('zhangsan');
  });

  it('normalizes profile responses before they reach the store', () => {
    expect(normalizeUserProfile({ ...baseUser, displayName: 'ï¿½' }).displayName).toBe('管理员');
  });
});
