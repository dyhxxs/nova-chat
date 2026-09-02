import { describe, expect, it } from 'vitest';
import { GatewayUploadResponseError, parseGatewayUploadResponse } from '../src/services/gatewayUploadResponse';

const attachment = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'photo.jpg',
  mimeType: 'image/jpeg',
  size: 1024,
  kind: 'image' as const,
};

describe('gateway upload response parsing', () => {
  it('returns a valid attachment from a successful upload', () => {
    expect(parseGatewayUploadResponse(201, JSON.stringify({ attachment }))).toEqual(attachment);
  });

  it('preserves a structured server error', () => {
    expect(() => parseGatewayUploadResponse(413, JSON.stringify({
      error: { code: 'file_too_large', message: '文件不能超过 25 MB。', retryable: false },
    }))).toThrowError(expect.objectContaining<Partial<GatewayUploadResponseError>>({
      code: 'file_too_large',
      message: '文件不能超过 25 MB。',
      retryable: false,
      status: 413,
    }));
  });

  it('creates a useful fallback for a non-JSON HTTP error', () => {
    expect(() => parseGatewayUploadResponse(502, '<html>Bad gateway</html>')).toThrowError(
      expect.objectContaining<Partial<GatewayUploadResponseError>>({
        code: 'http_502',
        message: '服务器返回了 502。',
        retryable: true,
        status: 502,
      }),
    );
  });

  it('rejects malformed successful responses', () => {
    expect(() => parseGatewayUploadResponse(201, '{}')).toThrowError(
      expect.objectContaining<Partial<GatewayUploadResponseError>>({
        code: 'invalid_upload_response',
        status: 201,
      }),
    );
  });
});
