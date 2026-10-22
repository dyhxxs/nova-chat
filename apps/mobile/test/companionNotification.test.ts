import { describe, expect, it } from 'vitest';
import { companionNotificationTarget } from '../src/lib/companionNotification';
const data = { type: 'companion-message', userId: 'account-1', serverUrl: 'https://gateway.test/', companionId: 'person-1', conversationId: 'topic-1', eventId: 'event-1' };
const scope = { authStatus: 'authenticated', user: { id: 'account-1' }, settings: { serverUrl: 'https://gateway.test' }, conversations: [{ id: 'topic-1', companionId: 'person-1' }] };
describe('notification conversation selection', () => {
  it('selects the matching companion topic and tolerates a trailing gateway slash', () => { expect(companionNotificationTarget(data, scope)).toBe('topic-1'); });
  it.each([
    { ...data, userId: 'account-2' }, { ...data, serverUrl: 'https://other.test' },
    { ...data, companionId: 'person-2' }, { ...data, conversationId: 'missing' }, { ...data, type: 'other' }, null,
  ])('rejects a notification from another account, server or topic', payload => { expect(companionNotificationTarget(payload, scope)).toBeUndefined(); });
  it('waits for authentication and does not target an ordinary chat', () => {
    expect(companionNotificationTarget(data, { ...scope, authStatus: 'unknown' })).toBeUndefined();
    expect(companionNotificationTarget(data, { ...scope, conversations: [{ id: 'topic-1' }] })).toBeUndefined();
  });
});
