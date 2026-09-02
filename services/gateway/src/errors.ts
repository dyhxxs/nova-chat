import { ProviderError } from './provider.js';

export type PublicError = { code: string; message: string; retryable: boolean; statusCode: number };

export function toPublicError(error: unknown): PublicError {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { code: 'cancelled', message: '请求已取消。', retryable: false, statusCode: 499 };
  }
  if (error instanceof ProviderError) {
    return { code: error.code, message: error.message, retryable: error.retryable, statusCode: error.status };
  }
  if (error instanceof Error && /abort/i.test(error.message)) {
    return { code: 'cancelled', message: '请求已取消。', retryable: false, statusCode: 499 };
  }
  return { code: 'internal_error', message: '服务暂时出现问题，请稍后重试。', retryable: true, statusCode: 500 };
}
