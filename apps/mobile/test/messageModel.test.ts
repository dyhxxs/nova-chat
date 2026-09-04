import { describe, expect, it } from 'vitest';
import { assistantDurationLabel, assistantMessageDetails, assistantModelLabel } from '../src/lib/messageModel';
import type { AppMessage } from '../src/types';

function message(patch: Partial<AppMessage> = {}): AppMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    attachments: [],
    createdAt: 1,
    status: 'complete',
    ...patch,
  };
}

describe('assistant model label', () => {
  it('shows both requested and actual models after a fallback', () => {
    expect(assistantModelLabel(message({ requestedModel: 'model-a', model: 'model-b' })))
      .toBe('实际模型 model-b · 原选 model-a');
  });

  it('labels an in-flight turn with its frozen requested model', () => {
    expect(assistantModelLabel(message({ status: 'streaming', requestedModel: 'model-a' })))
      .toBe('正在使用 model-a');
  });

  it('keeps legacy messages without model metadata quiet', () => {
    expect(assistantModelLabel(message())).toBeUndefined();
  });

  it('builds expandable generation details from frozen request metadata', () => {
    const result = assistantMessageDetails(message({
      requestedModel: 'model-a',
      model: 'model-b',
      generationRequestId: '1234567890abcdef',
      generationStartedAt: 1_000,
      completedAt: 13_500,
      generationOptions: {
        reasoningEffort: 'medium',
        verbosity: 'high',
        maxOutputTokens: 8192,
        webSearch: true,
        codeInterpreter: false,
      },
      usage: { inputTokens: 1200, outputTokens: 345, totalTokens: 1545 },
    }), 99_000);

    expect(result).toEqual(expect.arrayContaining([
      { label: '请求模型', value: 'model-a' },
      { label: '实际模型', value: 'model-b' },
      { label: '模型切换', value: '网关使用了不同模型' },
      { label: '思考强度', value: '中等思考' },
      { label: '回答详略', value: '详细' },
      { label: '工具', value: '网页搜索' },
      { label: '总耗时', value: '13 秒' },
      { label: '任务 ID', value: '1234567890ab' },
    ]));
  });

  it('formats sub-minute and minute generation durations', () => {
    expect(assistantDurationLabel(message({ generationStartedAt: 1_000, completedAt: 1_650 }))).toBe('650 毫秒');
    expect(assistantDurationLabel(message({ generationStartedAt: 1_000, completedAt: 6_250 }))).toBe('5.3 秒');
    expect(assistantDurationLabel(message({ generationStartedAt: 1_000, completedAt: 66_000 }))).toBe('1 分 5 秒');
  });

});
