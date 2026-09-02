import type { UserProfile } from '../types';

const REPLACEMENT_CHARACTER = '\uFFFD';

export type DisplayNameUser = Pick<UserProfile, 'displayName' | 'email' | 'role'>;

export function isCorruptedDisplayName(value: unknown): boolean {
  if (typeof value !== 'string') return true;
  const name = value.trim();
  // U+FFFD is what Android displays as a black diamond with a question mark
  // when the original text was decoded with the wrong charset. The visible
  // mojibake spelling is included for data produced by older clients.
  return !name || name.includes(REPLACEMENT_CHARACTER) || name.includes('ï¿½');
}

export function safeDisplayName(user: DisplayNameUser): string {
  const name = typeof user.displayName === 'string' ? user.displayName.trim() : '';
  if (!isCorruptedDisplayName(name)) return name;
  if (user.role === 'admin') return '管理员';

  const emailLocalPart = typeof user.email === 'string' ? user.email.split('@', 1)[0]?.trim() ?? '' : '';
  return !isCorruptedDisplayName(emailLocalPart) ? emailLocalPart : '用户';
}

export function normalizeUserProfile(user: UserProfile): UserProfile {
  return { ...user, displayName: safeDisplayName(user) };
}
