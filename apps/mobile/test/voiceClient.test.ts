import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  requestJson: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-file-system', () => {
  class File {
    readonly exists = true;
    constructor(readonly uri: string) {}
    upload = mocks.upload;
  }
  return { File, UploadType: { MULTIPART: 'multipart' } };
});
vi.mock('../src/services/gatewayApiClient', () => {
  class FakeGatewayApiError extends Error {
    constructor(readonly code: string, message: string, readonly retryable: boolean, readonly status: number) { super(message); }
  }
  return {
    GatewayApiError: FakeGatewayApiError,
    requestJson: mocks.requestJson,
    parseUploadJson: (_serverUrl: string, status: number, body: string) => {
      if (status < 200 || status >= 300) throw new Error('upload failed');
      return JSON.parse(body);
    },
  };
});

import { uploadVoice } from '../src/services/voiceClient';

const requestId = '11111111-1111-4111-8111-111111111111';
const fileId = '22222222-2222-4222-8222-222222222222';

describe('voice upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upload.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ text: '你好，今天怎么样？', voice: { status: 'ready', requestId, durationMs: 2400, fileId } }),
    });
  });

  it('uses the native multipart file uploader for Android recordings', async () => {
    const result = await uploadVoice('https://gateway.test', 'session-secret', {
      uri: 'file:///data/user/0/com.novachat.mobile/cache/recording.m4a',
      mimeType: 'audio/mp4',
      durationMs: 2400,
      requestId,
    });

    expect(result.text).toBe('你好，今天怎么样？');
    expect(mocks.requestJson).not.toHaveBeenCalled();
    expect(mocks.upload).toHaveBeenCalledWith('https://gateway.test/v1/voice/messages/' + requestId + '?durationMs=2400', expect.objectContaining({
      httpMethod: 'POST',
      uploadType: 'multipart',
      fieldName: 'file',
      mimeType: 'audio/mp4',
      headers: expect.objectContaining({ authorization: 'Bearer session-secret', 'x-nova-app-version': '1.1.31', 'x-nova-app-version-code': '33' }),
      sessionType: 'foreground',
    }));
  });
});