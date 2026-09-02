import { createHash, timingSafeEqual } from 'node:crypto';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!expected) return true;
  if (!provided) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}

export function bearerToken(header: string | string[] | undefined): string | undefined {
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}
