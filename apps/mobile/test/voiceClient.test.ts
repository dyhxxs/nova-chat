import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  requestJson: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-file-system', () => {
  class File {
    readonly exists = true;
    constructor(readonly uri: string) {}
    bytes = mocks.bytes;
  }
  return { File };
});
vi.mock('../src/services/gatewayApiClient', () => {
  class FakeGatewayApiError extends Error {
    constructor(readonly code: string, message: string, readonly retryable: boolean, readonly status: number) { super(message); }
  }
  return {
    GatewayApiError: FakeGatewayApiError,
    requestJson: mocks.requestJson,
  };
});

import { uploadVoice } from '../src/services/voiceClient';

const requestId = '11111111-1111-4111-8111-111111111111';
const fileId = '22222222-2222-4222-8222-222222222222';

describe('voice upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestJson.mockResolvedValue({
      text: '你好，今天怎么样？',
      voice: { status: 'ready', requestId, durationMs: 2400, fileId },
    });
  });

  it('uses a real Blob multipart payload for Android recordings', async () => {
    const result = await uploadVoice('https://gateway.test', 'session-secret', {
      uri: 'file:///data/user/0/com.novachat.mobile/cache/recording.m4a',
      mimeType: 'audio/mp4',
      durationMs: 2400,
      requestId,
    });

    expect(result.text).toBe('你好，今天怎么样？');
    expect(mocks.requestJson).toHaveBeenCalledWith('https://gateway.test', '/v1/voice/messages/' + requestId + '?durationMs=2400', expect.objectContaining({
      method: 'POST', body: expect.any(FormData), accessToken: 'session-secret', timeoutMs: 120_000,
    }));
    const call = mocks.requestJson.mock.calls[0];
    expect(call).toBeDefined();
    const body = call![2].body as FormData;
    expect(body.get('file')).toBeInstanceOf(Blob);
  });

  it('passes the selected learning language to the speech recognizer', async () => {
    await uploadVoice('https://gateway.test', 'session-secret', {
      uri: 'file:///data/user/0/com.novachat.mobile/cache/recording.m4a',
      mimeType: 'audio/mp4',
      durationMs: 2400,
      requestId,
    }, undefined, 'cantonese');

    expect(mocks.requestJson).toHaveBeenCalledWith('https://gateway.test', '/v1/voice/messages/' + requestId + '?durationMs=2400&languageId=cantonese', expect.anything());
  });
});
