import type { AppMessage } from '../types';

export type MessageDetail = { label: string; value: string };

const reasoningLabels: Record<string, string> = {
  none: '直接回答',
  low: '轻度思考',
  medium: '中等思考',
  high: '深度思考',
  xhigh: '高强度思考',
  max: '高强度思考',
};

const verbosityLabels: Record<string, string> = {
  low: '简洁',
  medium: '适中',
  high: '详细',
};

function formatTokens(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.round(value)).toLocaleString('zh-CN');
}

export function assistantDurationLabel(message: AppMessage, now = Date.now()): string | undefined {
  if (!message.generationStartedAt) return undefined;
  const end = message.completedAt ?? now;
  const elapsedMs = Math.max(0, end - message.generationStartedAt);
  if (elapsedMs < 1_000) return `${elapsedMs} 毫秒`;
  const seconds = elapsedMs / 1_000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`;
}

export function assistantModelLabel(message: AppMessage): string | undefined {
  const requestedModel = message.requestedModel?.trim();
  const actualModel = message.model?.trim();
  if (actualModel && requestedModel && actualModel !== requestedModel) {
    return `实际模型 ${actualModel} · 原选 ${requestedModel}`;
  }
  if (actualModel) return `模型 ${actualModel}`;
  if (!requestedModel) return undefined;
  return message.status === 'streaming' ? `正在使用 ${requestedModel}` : `请求模型 ${requestedModel}`;
}

export function assistantMessageDetails(message: AppMessage, now = Date.now()): MessageDetail[] {
  if (message.role !== 'assistant') return [];
  const details: MessageDetail[] = [];
  const requestedModel = message.requestedModel?.trim();
  const actualModel = message.model?.trim();
  if (requestedModel) details.push({ label: '请求模型', value: requestedModel });
  if (actualModel) details.push({ label: '实际模型', value: actualModel });
  if (requestedModel && actualModel && requestedModel !== actualModel) {
    details.push({ label: '模型切换', value: '网关使用了不同模型' });
  }

  const options = message.generationOptions;
  if (options) {
    details.push({ label: '思考强度', value: reasoningLabels[options.reasoningEffort] ?? options.reasoningEffort });
    details.push({ label: '回答详略', value: verbosityLabels[options.verbosity] ?? options.verbosity });
    const tools = [options.webSearch ? '网页搜索' : '', options.codeInterpreter ? '代码工具' : ''].filter(Boolean);
    details.push({ label: '工具', value: tools.length ? tools.join('、') : '未启用' });
    details.push({ label: '输出上限', value: `${options.maxOutputTokens.toLocaleString('zh-CN')} tokens` });
  }

  const inputTokens = formatTokens(message.usage?.inputTokens);
  const outputTokens = formatTokens(message.usage?.outputTokens);
  const totalTokens = formatTokens(message.usage?.totalTokens);
  if (inputTokens) details.push({ label: '输入 tokens', value: inputTokens });
  if (outputTokens) details.push({ label: '输出 tokens', value: outputTokens });
  if (totalTokens) details.push({ label: '总 tokens', value: totalTokens });

  const duration = assistantDurationLabel(message, now);
  if (duration) details.push({ label: message.status === 'streaming' ? '已生成' : '总耗时', value: duration });
  if (message.generationRequestId) details.push({ label: '任务 ID', value: message.generationRequestId.slice(0, 12) });
  return details;
}
