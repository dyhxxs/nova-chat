import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gateway = vi.hoisted(() => ({
  getGenerationJob: vi.fn(),
  cancelGenerationJob: vi.fn(),
}));

vi.mock('expo-constants', () => ({ default: { expoConfig: { version: 'test' } } }));
vi.mock('../src/services/gatewayApiClient', () => ({
  getGenerationJob: gateway.getGenerationJob,
  cancelGenerationJob: gateway.cancelGenerationJob,
}));

import { resumeGeneration } from '../src/services/chatClient';

function handlers() {
  return {
    onStarted: vi.fn<() => void>(),
    onDelta: vi.fn<(delta: string) => void>(),
    onTextSnapshot: vi.fn<(text: string) => void>(),
    onDone: vi.fn(),
    onCancelled: vi.fn<() => void>(),
    onError: vi.fn(),
  };
}

function job(status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled', text: string) {
  return {
    requestId: 'request-1',
    conversationId: 'conversation-1',
    status,
    text,
    createdAt: 1,
    updatedAt: 2,
  };
}

describe('durable generation recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    gateway.getGenerationJob.mockReset();
    gateway.cancelGenerationJob.mockReset().mockResolvedValue({ ok: true, status: 'cancelled' });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('appends a running snapshot and completes from the next poll', async () => {
    gateway.getGenerationJob
      .mockResolvedValueOnce(job('running', '已有内容 + 新内容'))
      .mockResolvedValueOnce({
        ...job('completed', '已有内容 + 新内容'),
        model: 'model-b',
        usage: { totalTokens: 42 },
        attachments: [],
      });
    const events = handlers();

    resumeGeneration({
      serverUrl: 'http://gateway.test',
      accessToken: 'session-token',
      requestId: 'request-1',
      conversationId: 'conversation-1',
      initialText: '已有内容',
      handlers: events,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(events.onDelta).toHaveBeenCalledWith(' + 新内容');
    expect(events.onStarted).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_200);
    expect(events.onDone).toHaveBeenCalledWith(expect.objectContaining({
      type: 'done',
      requestId: 'request-1',
      model: 'model-b',
      usage: { totalTokens: 42 },
    }));
    expect(events.onError).not.toHaveBeenCalled();
  });

  it('replaces local text when the gateway snapshot is not an append-only prefix', async () => {
    gateway.getGenerationJob.mockResolvedValueOnce(job('running', '服务器完整快照'));
    const events = handlers();

    const controller = resumeGeneration({
      serverUrl: 'http://gateway.test',
      accessToken: 'session-token',
      requestId: 'request-1',
      conversationId: 'conversation-1',
      initialText: '本地旧内容',
      handlers: events,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(events.onTextSnapshot).toHaveBeenCalledWith('服务器完整快照');
    expect(events.onDelta).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('dispose only detaches polling and does not cancel the server job', async () => {
    gateway.getGenerationJob.mockResolvedValueOnce(job('running', '内容'));
    const events = handlers();
    const controller = resumeGeneration({
      serverUrl: 'http://gateway.test',
      accessToken: 'session-token',
      requestId: 'request-1',
      conversationId: 'conversation-1',
      handlers: events,
    });

    controller.dispose();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(gateway.cancelGenerationJob).not.toHaveBeenCalled();
    expect(events.onCancelled).not.toHaveBeenCalled();
  });

  it('cancel stops polling, cancels the server job and reports cancellation', async () => {
    gateway.getGenerationJob.mockResolvedValueOnce(job('running', '内容'));
    const events = handlers();
    const controller = resumeGeneration({
      serverUrl: 'http://gateway.test',
      accessToken: 'session-token',
      requestId: 'request-1',
      conversationId: 'conversation-1',
      handlers: events,
    });

    controller.cancel();
    await vi.advanceTimersByTimeAsync(0);

    expect(gateway.cancelGenerationJob).toHaveBeenCalledWith('http://gateway.test', 'session-token', 'request-1', 'conversation-1');
    expect(events.onCancelled).toHaveBeenCalledTimes(1);
  });

  it('rejects a durable job returned for another conversation before delivering events', async () => {
    gateway.getGenerationJob.mockResolvedValueOnce({ ...job('running', '不应写入当前会话'), conversationId: 'conversation-2' });
    const events = handlers();

    resumeGeneration({
      serverUrl: 'http://gateway.test',
      accessToken: 'session-token',
      requestId: 'request-1',
      conversationId: 'conversation-1',
      handlers: events,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(events.onStarted).not.toHaveBeenCalled();
    expect(events.onDelta).not.toHaveBeenCalled();
    expect(events.onDone).not.toHaveBeenCalled();
    expect(events.onError).toHaveBeenCalledWith({
      code: 'conversation_mismatch',
      message: '后台任务与当前会话不一致，已停止恢复，请重新生成。',
      retryable: false,
    });
  });

  it('turns an expired or missing job into a retryable recovery error', async () => {
    gateway.getGenerationJob.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'job_not_found', retryable: false }));
    const events = handlers();

    resumeGeneration({
      serverUrl: 'http://gateway.test',
      accessToken: 'session-token',
      requestId: 'request-1',
      conversationId: 'conversation-1',
      handlers: events,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(events.onError).toHaveBeenCalledWith(expect.objectContaining({
      code: 'job_not_found',
      retryable: true,
    }));
  });
});
