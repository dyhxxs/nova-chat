import { fetchGatewayModels, GatewayApiError, getMe } from './gatewayApiClient';

/** HTTP status alone can come from a proxy/WAF, not the account service. */
export function isInvalidSession(error: unknown): boolean {
  return error instanceof GatewayApiError
    && (error.status === 401 || error.status === 403)
    && (error.code === 'unauthorized' || error.code === 'forbidden');
}

export function isRetryableSessionError(error: unknown): boolean {
  if (!(error instanceof GatewayApiError) || isInvalidSession(error)) return false;
  // Never turn a denied/invalid request or explicit cancellation into a retry loop.
  if ([401, 403].includes(error.status) || error.code === 'aborted') return false;
  return error.retryable || [408, 425, 429].includes(error.status);
}

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new GatewayApiError('aborted', '请求已取消。', false, 0);
}

/** Catalog failures are non-fatal, but explicit cancellation stops the whole restore. */
export async function restoreGatewaySession(serverUrl: string, accessToken: string, signal?: AbortSignal) {
  checkCancelled(signal);
  const user = await getMe(serverUrl, accessToken, signal);
  checkCancelled(signal);
  const catalog = await fetchGatewayModels(serverUrl, accessToken, signal).catch((error: unknown) => {
    checkCancelled(signal);
    // A revoked session must not be restored just because /auth/me succeeded earlier.
    if (isInvalidSession(error)) throw error;
    return undefined;
  });
  checkCancelled(signal);
  return { user, catalog };
}
