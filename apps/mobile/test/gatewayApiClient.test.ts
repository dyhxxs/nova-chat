import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-file-system', () => ({
  File: class TestFile {},
  UploadType: { MULTIPART: 0 },
}));

import { cancelGenerationJob, getGenerationJob, login, logout, removeAvatar, testProvider } from '../src/services/gatewayApiClient';

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'user@example.com',
  displayName: '测试用户',
  role: 'user' as const,
  disabled: false,
  createdAt: 1,
  updatedAt: 1,
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

describe('gateway JSON request headers', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not advertise JSON for bodyless POST and DELETE requests', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: 'cancelled' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, models: ['model-a'] }))
      .mockResolvedValueOnce(jsonResponse({ user }));

    await cancelGenerationJob('http://gateway.test', 'session-token', 'request-1', '00000000-0000-4000-8000-000000000010');
    await logout('http://gateway.test', 'session-token');
    await testProvider('http://gateway.test', 'session-token');
    await removeAvatar('http://gateway.test', 'session-token');

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'POST', 'POST', 'DELETE']);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.body).toBeUndefined();
      expect(init?.headers).toEqual(expect.objectContaining({ authorization: 'Bearer session-token' }));
      expect(init?.headers).not.toHaveProperty('content-type');
    }
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://gateway.test/v1/chat/jobs/request-1/cancel?conversationId=00000000-0000-4000-8000-000000000010');
  });

  it('scopes durable generation lookups to the conversation id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      requestId: 'request-1', conversationId: '00000000-0000-4000-8000-000000000010', status: 'running', text: '', createdAt: 1, updatedAt: 1,
    }));

    await getGenerationJob('http://gateway.test', 'session-token', 'request-1', '00000000-0000-4000-8000-000000000010');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://gateway.test/v1/chat/jobs/request-1?conversationId=00000000-0000-4000-8000-000000000010');
  });

  it('keeps JSON content type when a JSON body is present', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ user, accessToken: 'token', expiresAt: 1000 }));

    await login('http://gateway.test', { email: user.email, password: 'correct-horse-battery-staple', deviceId: 'device-1' });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.headers).toEqual(expect.objectContaining({ 'content-type': 'application/json' }));
    expect(JSON.parse(String(init?.body))).toEqual({ email: user.email, password: 'correct-horse-battery-staple', deviceId: 'device-1' });
  });
});
