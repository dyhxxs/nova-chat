import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-file-system', () => ({
  File: class TestFile {},
  UploadType: { MULTIPART: 0 },
}));

import { changeAccountPassword, listLoginSessions, revokeLoginSession, revokeOtherLoginSessions, cancelGenerationJob, fetchSetupStatus, getGenerationJob, login, logout, removeAvatar, testProvider, getProviderSettings, saveProviderSettings } from '../src/services/gatewayApiClient';

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
      expect(init?.headers).toEqual(expect.objectContaining({ 'x-nova-app-version': '1.1.31', 'x-nova-app-version-code': '33' }));
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


describe('gateway proxy failures', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([502, 503, 504, 530])('reports HTTP %s without blaming credentials', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Cloudflare unavailable</html>', { status })));
    await expect(fetchSetupStatus('https://gateway.test')).rejects.toMatchObject({
      code: `http_${status}`, status, retryable: true, message: expect.stringContaining('管理员'),
    });
  });

  it.each(['<html>Proxy sign-in page</html>', '', 'null', '[]'])('rejects invalid successful gateway data: %s', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    await expect(fetchSetupStatus('https://gateway.test')).rejects.toMatchObject({ code: 'invalid_gateway_response', retryable: true });
  });
});


describe('security API confirmations', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('validates session metadata and strips unexpected token fields', async () => {
    const session = { id: '00000000-0000-4000-8000-000000000001', deviceId: 'test-device', createdAt: 1, expiresAt: 2, current: true };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ sessions: [{ ...session, token: 'do-not-display' }] })));
    expect(await listLoginSessions('https://gateway.test', 'test-token')).toEqual([session]);
  });
  it('rejects malformed session lists and false-success mutation responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse({ ok: false, sessions: [null] })));
    await expect(listLoginSessions('https://gateway.test', 'test-token')).rejects.toMatchObject({ code: 'invalid_gateway_response' });
    await expect(revokeLoginSession('https://gateway.test', 'test-token', 'one')).rejects.toMatchObject({ code: 'invalid_gateway_response' });
    await expect(revokeOtherLoginSessions('https://gateway.test', 'test-token')).rejects.toMatchObject({ code: 'invalid_gateway_response' });
    await expect(changeAccountPassword('https://gateway.test', 'test-token', 'old-test-password', 'new-test-password')).rejects.toMatchObject({ code: 'invalid_gateway_response' });
  });
  it('encodes identifiers, avoids empty JSON bodies and sends passwords only in the request body', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: true, currentSessionRevoked: false })).mockResolvedValueOnce(jsonResponse({ ok: true, revoked: 2 })).mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await revokeLoginSession('https://gateway.test', 'test-token', 'path/segment');
    await revokeOtherLoginSessions('https://gateway.test', 'test-token');
    await changeAccountPassword('https://gateway.test', 'test-token', 'old-test-password', 'new-test-password');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://gateway.test/v1/auth/sessions/path%2Fsegment');
    expect(fetchMock.mock.calls[0]![1].body).toBeUndefined(); expect(fetchMock.mock.calls[1]![1].body).toBeUndefined();
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body)).toEqual({ currentPassword: 'old-test-password', newPassword: 'new-test-password' });
    expect(fetchMock.mock.calls[2]![0]).not.toContain('password=');
  });
});


describe('private administrator provider summaries', () => {
  afterEach(() => vi.unstubAllGlobals());
  const metadata = { apiBaseUrlSet: true, apiKeySet: true, apiMode: 'responses' as const, authMode: 'bearer' as const, defaultModel: 'model-a', allowedModels: ['model-a'] };
  it.each(['get', 'save'] as const)('strips secret and unknown fields from %s responses', async (action) => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ provider: { ...metadata, apiBaseUrl: 'https://private.example/v1', apiKey: 'secret-value', apiKeyPreview: '••••7359', extra: { password: 'do-not-propagate' } } }));
    vi.stubGlobal('fetch', fetch);
    const result = action === 'get' ? await getProviderSettings('https://gateway.test', 'token') : await saveProviderSettings('https://gateway.test', 'token', metadata);
    expect(result).toEqual(metadata);
    for (const value of ['private.example', 'secret-value', '7359', 'do-not-propagate']) expect(JSON.stringify(result)).not.toContain(value);
  });
  it('converts a legacy URL into only a configured flag, never a displayed URL', async () => {
    const { apiBaseUrlSet: _flag, ...legacy } = metadata;
    void _flag;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ provider: { ...legacy, apiBaseUrl: 'https://old-private.example/v1', apiKeyPreview: '••••1234' } })));
    expect(await getProviderSettings('https://gateway.test', 'token')).toEqual(metadata);
  });
  it('rejects malformed summaries without including remote data in the error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ provider: { ...metadata, apiMode: 'secret-provider-url-key' } })));
    await expect(getProviderSettings('https://gateway.test', 'token')).rejects.toMatchObject({ code: 'invalid_provider_response', message: '模型服务状态格式不正确，请更新网关。' });
  });
});
