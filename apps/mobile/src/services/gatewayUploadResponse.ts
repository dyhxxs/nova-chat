import type { AttachmentRef } from '@nova-chat/protocol';

export class GatewayUploadResponseError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GatewayUploadResponseError';
  }
}

function parseJsonObject(body: string): Record<string, unknown> | null {
  if (!body.trim()) return null;
  try {
    const value: unknown = JSON.parse(body);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function isAttachmentRef(value: unknown): value is AttachmentRef {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.mimeType === 'string'
    && typeof candidate.size === 'number'
    && Number.isFinite(candidate.size)
    && (candidate.kind === 'image' || candidate.kind === 'document');
}

export function parseGatewayUploadResponse(status: number, body: string): AttachmentRef {
  const data = parseJsonObject(body);
  if (status < 200 || status >= 300) {
    const rawError = data?.error;
    const error = rawError !== null && typeof rawError === 'object' && !Array.isArray(rawError)
      ? rawError as Record<string, unknown>
      : null;
    throw new GatewayUploadResponseError(
      typeof error?.code === 'string' ? error.code : `http_${status}`,
      typeof error?.message === 'string' ? error.message : `服务器返回了 ${status}。`,
      typeof error?.retryable === 'boolean' ? error.retryable : status >= 500,
      status,
    );
  }

  const attachment = data?.attachment;
  if (!isAttachmentRef(attachment)) {
    throw new GatewayUploadResponseError(
      'invalid_upload_response',
      '附件已经发送，但服务器返回的数据格式不正确，请更新电脑端网关后重试。',
      true,
      status,
    );
  }
  return attachment;
}
