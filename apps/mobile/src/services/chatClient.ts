import Constants from 'expo-constants';
import type { GenerateRequest, ServerSocketMessage } from '@nova-chat/protocol';
import { normalizeServerUrl, toRestUrl, toWebSocketUrl } from '../lib/connection';
import { cancelGenerationJob, getGenerationJob } from './gatewayApiClient';

export type StreamHandlers = {
  onStarted?: () => void;
  onDelta: (delta: string) => void;
  /** Replaces the local assistant text when a background job snapshot cannot be appended safely. */
  onTextSnapshot?: (text: string) => void;
  onDone: (details: Extract<ServerSocketMessage, { type: 'done' }>) => void;
  onCancelled: () => void;
  onError: (error: { code: string; message: string; retryable: boolean }) => void;
};

export type GenerationController = { cancel: () => void };

type StartOptions = {
  serverUrl: string;
  accessToken: string;
  availableModels?: string[];
  request: GenerateRequest;
  handlers: StreamHandlers;
};

type JobError = { code: string; message: string; retryable: boolean };

function errorFromResponse(status: number, data: any): JobError {
  const error = data?.error;
  return {
    code: error?.code ?? `http_${status}`,
    message: error?.message ?? `服务器返回了 ${status}。`,
    retryable: error?.retryable ?? status >= 500,
  };
}

function startGatewayGeneration(options: StartOptions): GenerationController {
  let socket: WebSocket | undefined;
  let finished = false;
  let cancelled = false;
  let ready = false;
  let startSent = false;
  let restStarted = false;
  let polling = false;
  let startedNotified = false;
  let deliveredText = '';
  let lastActivityAt = Date.now();
  const restController = new AbortController();
  let pollController: AbortController | undefined;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let watchdogTimer: ReturnType<typeof setInterval> | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let cancelCloseTimer: ReturnType<typeof setTimeout> | undefined;
  const pollingStartedAt = Date.now();
  const POLL_INTERVAL_MS = 1_200;
  const POLL_MAX_MS = 35 * 60_000;
  const POLL_NOT_FOUND_GRACE_MS = 20_000;

  const clearTimers = () => {
    if (connectTimer) clearTimeout(connectTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (watchdogTimer) clearInterval(watchdogTimer);
    if (pollTimer) clearTimeout(pollTimer);
    if (cancelCloseTimer) clearTimeout(cancelCloseTimer);
    connectTimer = undefined;
    heartbeatTimer = undefined;
    watchdogTimer = undefined;
    pollTimer = undefined;
    cancelCloseTimer = undefined;
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimers();
    restController.abort();
    pollController?.abort();
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'complete');
  };

  const fail = (error: JobError) => {
    if (finished) return;
    finish();
    options.handlers.onError(error);
  };

  const notifyStarted = () => {
    if (startedNotified) return;
    startedNotified = true;
    options.handlers.onStarted?.();
  };

  const deliverSnapshot = (text: string | undefined) => {
    if (typeof text !== 'string' || text === deliveredText) return;
    if (text.startsWith(deliveredText)) {
      const suffix = text.slice(deliveredText.length);
      deliveredText = text;
      if (suffix) {
        options.handlers.onDelta(suffix);
      }
      return;
    }
    deliveredText = text;
    options.handlers.onTextSnapshot?.(text);
  };

  const startHeartbeat = () => {
    lastActivityAt = Date.now();
    heartbeatTimer = setInterval(() => {
      if (finished || cancelled || socket?.readyState !== WebSocket.OPEN) return;
      try { socket.send(JSON.stringify({ type: 'ping' })); } catch { /* onclose reports the failure. */ }
    }, 20_000);
    watchdogTimer = setInterval(() => {
      if (finished || cancelled || polling) return;
      if (Date.now() - lastActivityAt > 70_000) {
        // The gateway keeps the job alive after a stream disconnect. Switch to
        // its durable job endpoint instead of losing a long response.
        startPolling();
      }
    }, 10_000);
  };

  const handleJob = (job: Awaited<ReturnType<typeof getGenerationJob>>) => {
    if (finished || cancelled) return true;
    if (job.status === 'queued' || job.status === 'running') {
      notifyStarted();
      deliverSnapshot(job.text);
      return false;
    }
    deliverSnapshot(job.text);
    if (job.status === 'completed') {
      finish();
      options.handlers.onDone({
        type: 'done',
        requestId: options.request.requestId,
        model: job.model,
        responseId: job.responseId,
        usage: job.usage,
        attachments: job.attachments,
      });
      return true;
    }
    if (job.status === 'cancelled') {
      finish();
      options.handlers.onCancelled();
      return true;
    }
    const error = job.error ?? { code: 'generation_failed', message: '生成任务失败。', retryable: true };
    fail(error);
    return true;
  };

  const pollOnce = async () => {
    if (finished || cancelled || !polling) return;
    if (Date.now() - pollingStartedAt > POLL_MAX_MS) {
      fail({ code: 'job_expired', message: '后台生成任务等待时间过长，请重新发送。', retryable: true });
      return;
    }
    pollController = new AbortController();
    try {
      const job = await getGenerationJob(options.serverUrl, options.accessToken, options.request.requestId, pollController.signal);
      if (handleJob(job)) return;
      if (!finished && !cancelled) pollTimer = setTimeout(() => { void pollOnce(); }, POLL_INTERVAL_MS);
    } catch (error) {
      if (finished || cancelled || (error instanceof Error && error.name === 'AbortError')) return;
      const apiError = error as { code?: string; message?: string; retryable?: boolean };
      // The gateway may have accepted start just before the stream closed. A
      // short 404 window is expected while that request is being registered.
      const elapsed = Date.now() - pollingStartedAt;
      if (apiError.code === 'job_not_found' && elapsed > POLL_NOT_FOUND_GRACE_MS) {
        fail({
          code: apiError.code,
          message: apiError.message ?? '生成任务不存在或已过期。',
          retryable: true,
        });
        return;
      }
      if (elapsed <= POLL_MAX_MS) {
        pollTimer = setTimeout(() => { void pollOnce(); }, apiError.code === 'job_not_found' ? 700 : POLL_INTERVAL_MS);
        return;
      }
      fail({
        code: apiError.code ?? 'job_poll_failed',
        message: apiError.message ?? '无法查询后台生成任务。',
        retryable: apiError.retryable ?? true,
      });
    } finally {
      pollController = undefined;
    }
  };

  function startPolling() {
    if (finished || cancelled || polling) return;
    polling = true;
    restStarted = false;
    clearTimers();
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'poll job');
    void pollOnce();
  }

  const restFallback = async () => {
    if (finished || cancelled || startSent || restStarted) return;
    restStarted = true;
    clearTimers();
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'REST fallback');
    notifyStarted();
    try {
      const response = await fetch(toRestUrl(options.serverUrl, '/v1/chat'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}),
        },
        body: JSON.stringify(options.request),
        signal: restController.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        fail(errorFromResponse(response.status, data));
        return;
      }
      if (cancelled || finished) return;
      deliverSnapshot(typeof data.text === 'string' ? data.text : '');
      finish();
      options.handlers.onDone({
        type: 'done',
        requestId: options.request.requestId,
        model: data.model,
        responseId: data.responseId,
        usage: data.usage,
        attachments: Array.isArray(data.attachments) ? data.attachments : undefined,
      });
    } catch (error) {
      if (cancelled || (error instanceof Error && error.name === 'AbortError')) return;
      // The POST may have reached the gateway even though the response was
      // lost. Query the durable job before showing a failure to the user.
      restStarted = false;
      startPolling();
    }
  };

  try {
    socket = new WebSocket(toWebSocketUrl(options.serverUrl));
    connectTimer = setTimeout(() => {
      if (!ready && !finished && !restStarted) void restFallback();
    }, 10_000);

    socket.onopen = () => {
      if (finished || restStarted || polling) { socket?.close(); return; }
      lastActivityAt = Date.now();
      socket?.send(JSON.stringify({
        type: 'hello',
        accessToken: options.accessToken,
        deviceId: options.request.deviceId,
        appVersion: Constants.expoConfig?.version ?? 'development',
      }));
    };

    socket.onmessage = (event) => {
      if (finished || restStarted || polling) return;
      lastActivityAt = Date.now();
      let message: ServerSocketMessage;
      try { message = JSON.parse(String(event.data)) as ServerSocketMessage; }
      catch { fail({ code: 'invalid_server_message', message: '服务器返回了无法识别的数据。', retryable: true }); return; }
      if (message.type === 'pong') return;
      if (message.type === 'ready') {
        ready = true;
        startSent = true;
        if (connectTimer) clearTimeout(connectTimer);
        connectTimer = undefined;
        startHeartbeat();
        socket?.send(JSON.stringify({ type: 'start', payload: options.request }));
        return;
      }
      if (message.type === 'started' && message.requestId === options.request.requestId) {
        notifyStarted();
        return;
      }
      if (message.type === 'delta' && message.requestId === options.request.requestId) {
        deliveredText += message.delta;
        options.handlers.onDelta(message.delta);
        return;
      }
      if (message.type === 'done' && message.requestId === options.request.requestId) {
        finish();
        options.handlers.onDone(message);
        return;
      }
      if (message.type === 'cancelled' && message.requestId === options.request.requestId) {
        finish();
        options.handlers.onCancelled();
        return;
      }
      if (message.type === 'error' && (!message.requestId || message.requestId === options.request.requestId)) fail(message);
    };

    socket.onerror = () => {
      if (finished || cancelled || restStarted || polling) return;
      if (!ready && !startSent) void restFallback();
      else startPolling();
    };

    socket.onclose = () => {
      if (finished || restStarted || polling) return;
      if (cancelled) { finish(); options.handlers.onCancelled(); return; }
      if (!ready && !startSent) { void restFallback(); return; }
      startPolling();
    };
  } catch {
    void restFallback();
  }

  return {
    cancel: () => {
      if (finished || cancelled) return;
      cancelled = true;
      restController.abort();
      pollController?.abort();
      clearTimers();
      if (socket?.readyState === WebSocket.OPEN && startSent) {
        try { socket.send(JSON.stringify({ type: 'cancel', requestId: options.request.requestId })); } catch { /* REST cancellation below. */ }
        cancelCloseTimer = setTimeout(() => { if (!finished) socket?.close(); }, 1_200);
      } else {
        socket?.close();
      }
      // REST cancellation is required when the app has already lost its
      // WebSocket, otherwise the gateway would correctly keep working.
      void cancelGenerationJob(options.serverUrl, options.accessToken, options.request.requestId).catch(() => undefined);
      if (!finished) {
        finish();
        options.handlers.onCancelled();
      }
    },
  };
}

export function startGeneration(options: StartOptions): GenerationController {
  return startGatewayGeneration(options);
}

export async function testConnection(serverUrl: string, signal?: AbortSignal): Promise<{ model?: string; apiMode?: string }> {
  const normalized = normalizeServerUrl(serverUrl);
  if (!normalized) throw new Error('请先填写服务器地址。');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    const response = await fetch(toRestUrl(normalized, '/health'), { signal: controller.signal });
    if (!response.ok) throw new Error(`服务器返回了 ${response.status}。`);
    const data = await response.json();
    if (!data?.ok) throw new Error('服务器健康检查未通过。');
    return { model: data.defaultModel, apiMode: data.apiMode };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}
