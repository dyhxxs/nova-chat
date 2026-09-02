import { createHash, randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  AttachmentRef,
  GenerateRequest,
  ReasoningEffort,
  TokenUsage,
} from '@nova-chat/protocol';
import type { AppConfig } from './config.js';
import type { AppDatabase, ProviderSettings, SessionPrincipal, StoredFile } from './database.js';

export type GenerationResult = {
  text: string;
  model: string;
  responseId?: string;
  usage?: TokenUsage;
  attachments?: AttachmentRef[];
};
type ProviderContentResult = Omit<GenerationResult, 'model'>;
export type DeltaHandler = (delta: string) => void;
type SseEvent = { event?: string; data: string };
type ResponseToolType = 'web_search' | 'code_interpreter';
type RequestCompatibility = { omitReasoning?: boolean; omitVerbosity?: boolean };
type ImageSource = 'b64_json' | 'base64' | 'data_url' | 'url' | 'binary';
type ImagePayload = { bytes: Buffer; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; source: ImageSource };
export type ProviderLogger = { warn(bindings: Record<string, unknown>, message: string): void };

export class ProviderError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

function safetyIdentifier(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 32);
}

function usageFrom(value: any): TokenUsage | undefined {
  if (!value) return undefined;
  const inputTokens = value.input_tokens ?? value.prompt_tokens;
  const outputTokens = value.output_tokens ?? value.completion_tokens;
  const totalTokens = value.total_tokens ?? ((inputTokens ?? 0) + (outputTokens ?? 0));
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return undefined;
  return { inputTokens, outputTokens, totalTokens };
}

function textFromContent(content: any): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (typeof part === 'string') return part;
    if (part?.type === 'text' || part?.type === 'output_text') return String(part.text ?? '');
    return '';
  }).join('');
}

function textFromResponseJson(data: any, mode: ProviderSettings['apiMode']): string {
  if (mode === 'chat-completions') return textFromContent(data?.choices?.[0]?.message?.content);
  if (typeof data?.output_text === 'string') return data.output_text;
  if (!Array.isArray(data?.output)) return '';
  return data.output.flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .filter((part: any) => part?.type === 'output_text' || part?.type === 'text')
    .map((part: any) => String(part?.text ?? ''))
    .join('');
}

function createSseParser(onEvent: (event: SseEvent) => void) {
  let buffer = '';
  const emit = (block: string) => {
    if (!block.trim()) return;
    let event: string | undefined;
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length) onEvent({ event, data: data.join('\n') });
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      let boundary = buffer.match(/\r?\n\r?\n/);
      while (boundary?.index !== undefined) {
        emit(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
        boundary = buffer.match(/\r?\n\r?\n/);
      }
    },
    flush() { emit(buffer); buffer = ''; },
  };
}

function headersFor(settings: ProviderSettings, streaming = false): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: streaming ? 'text/event-stream, application/json' : 'application/json',
  };
  if (settings.apiKey && settings.authMode === 'bearer') headers.authorization = `Bearer ${settings.apiKey}`;
  if (settings.apiKey && settings.authMode === 'api-key') headers['api-key'] = settings.apiKey;
  return headers;
}

function endpoint(settings: ProviderSettings, route: string): string {
  return settings.apiBaseUrl.replace(/\/+$/, '') + (route.startsWith('/') ? route : '/' + route);
}

function providerErrorFromDetails(status: number, codeValue: unknown, messageValue: unknown): ProviderError {
  const providerCode = String(codeValue ?? 'provider_request_error');
  const providerMessage = String(messageValue ?? '').trim().slice(0, 500);
  const details = `${providerCode} ${providerMessage}`.toLowerCase();
  const mentionsTool = /tool|code[_ -]?interpreter|web[_ -]?search/.test(details);
  const rejectsTool = /unsupported|not supported|does not support|unknown tool|invalid tool|不支持/.test(details);
  if (mentionsTool && rejectsTool) {
    const names = [
      /code[_ -]?interpreter/.test(details) ? 'code_interpreter' : '',
      /web[_ -]?search/.test(details) ? 'web_search' : '',
    ].filter(Boolean).join(' / ');
    return new ProviderError(502, 'provider_tool_unsupported', `第三方接口不支持${names ? ` ${names}` : '所请求的'}工具。`, false);
  }
  if (/has not been priced|not been priced|pricing?.{0,40}(not configured|missing)|未.{0,12}计价|价格.{0,12}未.{0,12}配置/.test(details)) {
    return new ProviderError(502, 'provider_model_unpriced', '管理员配置的模型尚未在第三方服务中启用或计价，请管理员改用服务商实际支持的模型 ID。', false);
  }
  const modelUnavailable = status === 404 || /(?:model|模型).{0,80}(not found|does not exist|unknown|unavailable|not available|未找到|不存在|不可用|未启用)/.test(details);
  if (modelUnavailable) {
    return new ProviderError(502, 'provider_model_unavailable', '当前模型在第三方服务中不可用，正在尝试备用模型。', false);
  }
  const parameterUnsupported = /(?:unsupported|unknown|unrecognized|invalid|not supported|不支持|未知).{0,50}(parameter|field|reasoning|verbosity|max[_ -]?(?:output|completion)[_ -]?tokens|response[_ -]?format|参数|字段)/.test(details)
    || /(?:reasoning|verbosity|max[_ -]?(?:output|completion)[_ -]?tokens|response[_ -]?format).{0,50}(unsupported|unknown|invalid|不支持)/.test(details);
  if (parameterUnsupported) {
    const imageParameter = /response[_ -]?format/.test(details);
    return new ProviderError(502, imageParameter ? 'provider_image_parameter_unsupported' : 'provider_parameter_unsupported', imageParameter ? '第三方图片接口不支持当前返回格式参数。' : '第三方接口不支持当前请求参数。', false);
  }
  if (status === 401 || status === 403) return new ProviderError(502, 'provider_auth_error', providerMessage || '模型服务鉴权失败，请检查管理员配置的 API Key。', false);
  if (status === 429) return new ProviderError(429, 'provider_rate_limited', providerMessage || '模型服务当前繁忙，请稍后重试。', true);
  if (status === 408 || status === 409 || status === 425 || status >= 500) return new ProviderError(503, 'provider_unavailable', providerMessage || '模型服务暂时不可用，请稍后重试。', true);
  return new ProviderError(502, providerCode, providerMessage || '模型请求未能完成，请检查模型名称与服务配置。', false);
}

async function providerError(response: Response): Promise<ProviderError> {
  const raw = await response.text().catch(() => '');
  let data: any;
  try { data = JSON.parse(raw); } catch { data = undefined; }
  return providerErrorFromDetails(
    response.status,
    data?.error?.code ?? data?.code,
    data?.error?.message ?? data?.message ?? raw.trim(),
  );
}

function normalizedModels(settings: ProviderSettings): string[] {
  return [...new Set(settings.allowedModels.map((model) => model.trim()).filter(Boolean))];
}

function isImageModel(model: string): boolean {
  return /^gpt-image(?:[-.]|$)/i.test(model.trim());
}

function imageGenerationIntent(request: GenerateRequest): boolean {
  const latestUserMessage = [...request.messages].reverse().find((message) => message.role === 'user')?.content.trim() ?? '';
  if (!latestUserMessage) return false;
  // Keep questions/troubleshooting in the text route. The negation check is
  // deliberately tied to an image action, so a normal constraint such as
  // “不要文字，生成一张照片” still reaches the image model.
  const imageAction = '(?:生图|生成|制作|创建|绘制|画图|绘图|画|作图|做图)';
  if (new RegExp(`(?:不要|无需|不需要|禁止|别|不用|不必|不想|不能|无法|没法|失败)\\s*(?:让?\\s*(?:我|你|AI|ai)\\s*)?${imageAction}`, 'i').test(latestUserMessage)) return false;
  if (new RegExp(`(?:为什么|怎么|如何|能否|是否).{0,8}(?:不能|无法|没法|${imageAction}|图片|照片|相片|图像)`, 'i').test(latestUserMessage)) return false;

  const imageSubject = '(?:图片|照片|相片|图像|插画|海报|壁纸|头像|封面|图标|表情包|图|画面)';
  const imageGenerationAction = '(?:生成|制作|创建|绘制|画|作图|作|做|弄|整)';
  const actionThenSubject = new RegExp(`(?:${imageGenerationAction}\\s*(?:一个|一张|一幅|一副|个|张)?[^\\n]{0,80}?${imageSubject}|(?:来|给我)\\s*(?:一个|一张|一幅|一副|个|张)?\\s*${imageSubject})`, 'i');
  const compactIntent = /(?:生(?:图|图片|照片|相片|图像|头像|壁纸)|出图|配图|做图)/i;
  const englishIntent = /(?:create|generate|draw|make)\\s+(?:an?\\s+)?(?:image|picture|photo|illustration|wallpaper|avatar)/i;
  if (compactIntent.test(latestUserMessage) || actionThenSubject.test(latestUserMessage) || englishIntent.test(latestUserMessage)) return true;

  // A generated image is an assistant message with no text. Older clients
  // used to drop that message from the context, so a follow-up such as
  // “我要全身的” was silently sent to the text model. Keep image edits and
  // continuations on the image route when there is a prior image reference.
  const hasImageContext = request.messages.some((message) => message.attachments.some((attachment) => attachment.kind === 'image'));
  if (!hasImageContext) return false;
  const asksForExplanation = /(?:为什么|怎么|如何|是什么|哪种|是否|能否|能不能|可以吗|请问|分析|描述|识别|评价|提示词|prompt|[吗么][？?]$)/i;
  const editCue = /(?:不满意|不喜欢|不好看|不对|全身|半身|近景|远景|正面|侧面|背面|换成|改成|变成|调整|修改|优化|重做|重来|重新(?:生成)?|再来|换一个|换一张|换个|去掉|加上|保留|放大|缩小|拉远|拉近|镜头|构图|姿势|表情|发型|衣服|服装|背景|角度|颜色|比例|尺寸)/i;
  const actionableEditCue = /(?:换成|改成|变成|调整|修改|优化|重做|重来|重新(?:生成)?|再来|换一个|换一张|换个|去掉|加上|保留|放大|缩小|拉远|拉近|让(?:她|他|人物)|把.{0,20}(?:改|换|变))/i;
  return editCue.test(latestUserMessage) && (!asksForExplanation.test(latestUserMessage) || actionableEditCue.test(latestUserMessage));
}

function previousImageAssistantIndex(messages: GenerateRequest['messages'], beforeIndex: number): number {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'assistant' && message.attachments.some((attachment) => attachment.kind === 'image')) return index;
  }
  return -1;
}

function previousUserIndex(messages: GenerateRequest['messages'], beforeIndex: number): number {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return index;
  }
  return -1;
}

function imagePrompt(request: GenerateRequest): string {
  const latestIndex = [...request.messages]
    .map((message, index) => message.role === 'user' ? index : -1)
    .filter((index) => index >= 0)
    .at(-1) ?? -1;
  const latest = latestIndex >= 0 ? request.messages[latestIndex]?.content.trim() ?? '' : '';
  if (latestIndex < 0) return latest;

  const promptChain: string[] = [];
  let beforeIndex = latestIndex;
  while (true) {
    const imageIndex = previousImageAssistantIndex(request.messages, beforeIndex);
    if (imageIndex < 0) break;
    const userIndex = previousUserIndex(request.messages, imageIndex);
    if (userIndex < 0) break;
    const prompt = request.messages[userIndex]?.content.trim() ?? '';
    if (prompt) promptChain.unshift(prompt);
    beforeIndex = userIndex;
  }
  if (!promptChain.length) return latest;

  // The generic image-generation endpoint does not have a portable image-edit
  // contract across OpenAI-compatible providers. Carry the whole textual brief
  // forward so a sequence such as “生成照片” → “我要全身的” → “换背景” does
  // not forget the original subject after the second image turn.
  const original = promptChain[0]!.slice(0, 4_000);
  const priorChanges = promptChain.slice(1).map((prompt, index) => `修改${index + 1}：${prompt.slice(0, 2_000)}`);
  return [
    '基于上一版图片继续创作。',
    `原始创作要求：${original}`,
    ...priorChanges,
    `本次修改要求：${latest.slice(0, 4_000)}`,
  ].join('\n');
}

function resolveAllowedModel(settings: ProviderSettings, requestedModel: string): string {
  const allowedModels = normalizedModels(settings);
  const requested = requestedModel.trim();
  if (requested && allowedModels.includes(requested)) return requested;
  const preferred = settings.defaultModel.trim();
  if (preferred && allowedModels.includes(preferred)) return preferred;
  if (allowedModels[0]) return allowedModels[0];
  throw new ProviderError(503, 'provider_not_configured', '管理员尚未配置可用模型。', false);
}

function modelCandidates(settings: ProviderSettings, selectedModel: string, imageRequest: boolean): string[] {
  const models = normalizedModels(settings);
  if (!imageRequest) return [...new Set([selectedModel, ...models.filter((model) => !isImageModel(model))].filter(Boolean))].slice(0, 3);

  // A text model selected in the chat UI is only the conversation model. Image
  // intent is routed internally and should prefer the newest configured image
  // model instead of relying on administrator list ordering.
  const configuredImages = models.filter(isImageModel);
  const selected = isImageModel(selectedModel) ? [selectedModel] : [];
  const preferred = ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1']
    .filter((model) => configuredImages.some((configured) => configured.toLowerCase() === model));
  return [...new Set([...selected, ...preferred, ...configuredImages])].slice(0, 3);
}

function requestedResponseTools(request: GenerateRequest): Set<ResponseToolType> {
  const tools = new Set<ResponseToolType>();
  if (request.options.webSearch) tools.add('web_search');
  if (request.options.codeInterpreter) tools.add('code_interpreter');
  return tools;
}

function unsupportedToolsForRetry(error: unknown, requestedTools: ReadonlySet<ResponseToolType>): Set<ResponseToolType> | undefined {
  if (!(error instanceof ProviderError) || error.code !== 'provider_tool_unsupported' || requestedTools.size === 0) return undefined;
  const details = error.message.toLowerCase();
  const disabled = new Set<ResponseToolType>();
  if (requestedTools.has('code_interpreter') && /code[_ -]?interpreter/.test(details)) disabled.add('code_interpreter');
  if (requestedTools.has('web_search') && /web[_ -]?search/.test(details)) disabled.add('web_search');
  if (disabled.size === 0) requestedTools.forEach((tool) => disabled.add(tool));
  return disabled;
}

function unsupportedParametersForRetry(error: unknown, compatibility: RequestCompatibility): RequestCompatibility | undefined {
  if (!(error instanceof ProviderError) || error.code !== 'provider_parameter_unsupported') return undefined;
  const next = { ...compatibility };
  if (!next.omitReasoning) next.omitReasoning = true;
  else if (!next.omitVerbosity) next.omitVerbosity = true;
  else return undefined;
  return next;
}

function fallbackEligible(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  return error.code === 'provider_model_unavailable'
    || error.code === 'provider_model_unpriced'
    || error.code === 'provider_unavailable';
}

function compatibleReasoningEffort(model: string, effort: ReasoningEffort): Exclude<ReasoningEffort, 'max'> {
  if (isImageModel(model) || effort === 'none') return 'none';
  // `max` was exposed by older Nova builds but is not a portable provider
  // value. Keep accepting it for old requests and normalize it to xhigh, the
  // highest standard Responses reasoning value.
  if (effort === 'max') return 'xhigh';
  return effort;
}

function supportsChatReasoning(model: string): boolean {
  return /^(?:gpt-5(?:[.-]|$)|o\d)/i.test(model.trim());
}

function identityInstructions(existing: string, model: string): string {
  const identity = [
    '身份规则：你是 Nova 中的独立 AI 助手，不是 OpenAI 官方 ChatGPT/Codex 应用，也不是 DeepSeek 官方应用。',
    `本次请求实际配置的模型 ID 是“${model}”。被问及身份或模型时，只能如实说明这个模型 ID，并说明服务由管理员配置的兼容 API 提供；不要根据用户措辞把自己误认成其他模型。`,
  ].join('\n');
  return existing.trim() ? `${existing.trim()}\n\n${identity}` : identity;
}

function imageMimeFromBytes(bytes: Buffer, contentType?: string | null): ImagePayload['mimeType'] | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString() === 'GIF87a' || bytes.subarray(0, 6).toString() === 'GIF89a')) return 'image/gif';
  const normalized = String(contentType ?? '').split(';')[0]?.trim().toLowerCase();
  if (normalized === 'image/png' || normalized === 'image/jpeg' || normalized === 'image/webp' || normalized === 'image/gif') return normalized;
  return undefined;
}

function extensionForImage(mimeType: ImagePayload['mimeType']): string {
  return mimeType === 'image/jpeg' ? '.jpg' : mimeType === 'image/webp' ? '.webp' : mimeType === 'image/gif' ? '.gif' : '.png';
}

function decodeDataUrl(value: string): ImagePayload | undefined {
  const match = value.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/is);
  if (!match) return undefined;
  const bytes = Buffer.from(match[2]!, 'base64');
  const mimeType = imageMimeFromBytes(bytes, match[1]);
  return bytes.length && mimeType ? { bytes, mimeType, source: 'data_url' } : undefined;
}

function safeDiagnosticMessage(value: unknown): string {
  return String(value ?? '')
    .replace(/(?:bearer|authorization|api[-_ ]?key)\s*[:=]?\s*[^\s,;]+/gi, '$1 [redacted]')
    .replace(/\b(?:sk|sess|key)_[a-z0-9_-]{8,}\b/gi, '[redacted]')
    .trim()
    .slice(0, 240);
}

async function imagePayloadFromHttpResponse(response: Response, signal: AbortSignal): Promise<ImagePayload> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.startsWith('image/')) {
    const bytes = Buffer.from(await response.arrayBuffer());
    const mimeType = imageMimeFromBytes(bytes, contentType);
    if (mimeType) return { bytes, mimeType, source: 'binary' };
    throw new ProviderError(502, 'invalid_image_response', '图片模型返回了无法识别的图片数据。', true);
  }
  const raw = await response.text().catch(() => '');
  let data: any;
  try { data = raw ? JSON.parse(raw) : undefined; } catch {
    throw new ProviderError(502, 'invalid_image_response', '图片模型返回了无法解析的响应。', true);
  }
  return imagePayloadFromResponse(data, signal);
}

async function imagePayloadFromResponse(data: any, signal: AbortSignal): Promise<ImagePayload> {
  const item = Array.isArray(data?.data) ? data.data[0] : data?.image ?? data;
  const encoded = item?.b64_json ?? item?.base64 ?? item?.image_base64 ?? item?.image;
  if (typeof encoded === 'string') {
    const decoded = decodeDataUrl(encoded) ?? (() => {
      const bytes = Buffer.from(encoded, 'base64');
      const mimeType = imageMimeFromBytes(bytes, item?.mime_type);
      return bytes.length && mimeType ? { bytes, mimeType, source: 'base64' } : undefined;
    })();
    if (decoded) return decoded;
  }
  const urlValue = item?.url ?? item?.image_url;
  const url = typeof urlValue === 'string' ? urlValue : urlValue?.url;
  if (typeof url === 'string') {
    const dataUrl = decodeDataUrl(url);
    if (dataUrl) return dataUrl;
    const response = await fetch(url, { signal, headers: { accept: 'image/*' } });
    if (!response.ok) throw new ProviderError(502, 'provider_image_download_failed', '第三方图片地址无法下载。', true);
    const bytes = Buffer.from(await response.arrayBuffer());
    const mimeType = imageMimeFromBytes(bytes, response.headers.get('content-type'));
    if (mimeType) return { bytes, mimeType, source: 'url' };
  }
  throw new ProviderError(502, 'invalid_image_response', '图片模型没有返回可识别的图片数据。', true);
}

export class ModelProvider {
  constructor(
    private readonly config: AppConfig,
    private readonly database: AppDatabase,
    private readonly logger?: ProviderLogger,
  ) {}

  private validateSettings(settings: ProviderSettings): ProviderSettings {
    if (!settings.apiBaseUrl) throw new ProviderError(503, 'provider_not_configured', '管理员尚未配置模型服务地址。', false);
    if (settings.authMode !== 'none' && !settings.apiKey) throw new ProviderError(503, 'provider_not_configured', '管理员尚未配置模型服务 API Key。', false);
    return settings;
  }

  private settings(): ProviderSettings {
    return this.validateSettings(this.database.getProviderSettings());
  }

  async listModels(signal?: AbortSignal, settingsOverride?: ProviderSettings): Promise<string[]> {
    const settings = this.validateSettings(settingsOverride ?? this.database.getProviderSettings());
    const response = await fetch(endpoint(settings, '/models'), { headers: headersFor(settings), signal });
    if (!response.ok) throw await providerError(response);
    const data: any = await response.json();
    const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
    const ids: string[] = list.map((item: any): unknown => typeof item === 'string' ? item : item?.id ?? item?.name)
      .filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value: string) => value.trim());
    return [...new Set<string>(ids)].sort((a, b) => a.localeCompare(b));
  }

  async generate(
    request: GenerateRequest,
    principal: SessionPrincipal | { id: string },
    signal: AbortSignal,
    onDelta: DeltaHandler,
  ): Promise<GenerationResult> {
    const settings = this.settings();
    const selectedModel = resolveAllowedModel(settings, request.options.model || settings.defaultModel);
    const imageRequest = imageGenerationIntent(request) || isImageModel(request.options.model);
    if (imageRequest) {
      // Only an explicitly selected image model should override the automatic
      // gpt-image-2 preference. A text model choice must remain unchanged in
      // the UI while the gateway performs this internal image route.
      const explicitImageModel = isImageModel(request.options.model) ? selectedModel : '';
      return this.generateImage(request, principal.id, settings, explicitImageModel, signal);
    }

    const candidates = modelCandidates(settings, selectedModel, false);
    let emittedDelta = false;
    let lastError: unknown;
    const forwardDelta = (delta: string) => {
      emittedDelta = true;
      onDelta(delta);
    };
    for (const model of candidates) {
      try {
        return await this.generateTextWithModel(request, principal.id, settings, model, signal, forwardDelta, () => emittedDelta);
      } catch (error) {
        lastError = error;
        if (signal.aborted || emittedDelta || !fallbackEligible(error)) throw error;
      }
    }
    throw lastError ?? new ProviderError(503, 'provider_unavailable', '模型服务暂时不可用，请稍后重试。', true);
  }

  private async generateTextWithModel(
    request: GenerateRequest,
    userId: string,
    settings: ProviderSettings,
    model: string,
    signal: AbortSignal,
    onDelta: DeltaHandler,
    hasEmittedDelta: () => boolean,
  ): Promise<GenerationResult> {
    const requestedTools = settings.apiMode === 'responses' ? requestedResponseTools(request) : new Set<ResponseToolType>();
    let disabledTools = new Set<ResponseToolType>();
    let compatibility: RequestCompatibility = {};
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const body = settings.apiMode === 'responses'
          ? await this.responsesBody(request, userId, model, disabledTools, compatibility)
          : await this.chatBody(request, userId, model, compatibility);
        const route = settings.apiMode === 'responses' ? '/responses' : '/chat/completions';
        const response = await fetch(endpoint(settings, route), {
          method: 'POST', headers: headersFor(settings, true), body: JSON.stringify(body), signal,
        });
        if (!response.ok) throw await providerError(response);
        const result = await this.consume(response, settings.apiMode, signal, onDelta);
        return { ...result, model };
      } catch (error) {
        if (signal.aborted || hasEmittedDelta()) throw error;
        const unsupportedTools = unsupportedToolsForRetry(error, requestedTools);
        if (unsupportedTools && disabledTools.size === 0) {
          disabledTools = unsupportedTools;
          continue;
        }
        const nextCompatibility = unsupportedParametersForRetry(error, compatibility);
        if (nextCompatibility) {
          compatibility = nextCompatibility;
          continue;
        }
        throw error;
      }
    }
    throw new ProviderError(502, 'provider_request_error', '模型请求未能完成。', false);
  }

  private async generateImage(
    request: GenerateRequest,
    userId: string,
    settings: ProviderSettings,
    selectedModel: string,
    signal: AbortSignal,
  ): Promise<GenerationResult> {
    const candidates = modelCandidates(settings, selectedModel, true);
    if (!candidates.length) throw new ProviderError(503, 'image_model_unavailable', '当前服务没有配置可用的图片模型（gpt-image-*）。', false);
    const prompt = imagePrompt(request);
    if (!prompt) throw new ProviderError(400, 'image_prompt_required', '请先描述要生成的图片。', false);
    let lastError: unknown;
    let omitResponseFormat = false;
    for (const model of candidates) {
      while (true) {
        let responseStatus: number | undefined;
        try {
          const body: Record<string, unknown> = { model, prompt, n: 1, size: '1024x1024' };
          if (!omitResponseFormat) body.response_format = 'b64_json';
          const response = await fetch(endpoint(settings, '/images/generations'), {
            method: 'POST',
            headers: headersFor(settings),
            body: JSON.stringify(body),
            signal,
          });
          responseStatus = response.status;
          if (!response.ok) throw await providerError(response);
          const payload = await imagePayloadFromHttpResponse(response, signal);
          if (payload.bytes.length > this.config.maxFileBytes) throw new ProviderError(413, 'image_too_large', '生成图片超过网关文件大小限制。', false);
          const attachment = await this.storeGeneratedImage(userId, payload);
          this.logger?.warn({ event: 'image_generation_succeeded', model, status: response.status, source: payload.source, bytes: payload.bytes.length }, 'image generation succeeded');
          return { text: '', model, attachments: [attachment] };
        } catch (error) {
          lastError = error;
          this.logger?.warn({ event: 'image_generation_attempt_failed', model, status: responseStatus, code: error instanceof ProviderError ? error.code : 'unknown', message: safeDiagnosticMessage(error instanceof Error ? error.message : error) }, 'image generation attempt failed');
          if (signal.aborted) throw error;
          if (error instanceof ProviderError && error.code === 'provider_image_parameter_unsupported' && !omitResponseFormat) {
            omitResponseFormat = true;
            continue;
          }
          if (!fallbackEligible(error)) throw error;
          break;
        }
      }
    }
    throw lastError ?? new ProviderError(503, 'image_model_unavailable', '图片模型暂时不可用，请稍后重试。', true);
  }

  private async storeGeneratedImage(userId: string, payload: ImagePayload): Promise<AttachmentRef> {
    const id = randomUUID();
    const name = `generated-${Date.now()}${extensionForImage(payload.mimeType)}`;
    const storagePath = path.join(this.database.uploadsDir, `${id}${extensionForImage(payload.mimeType)}`);
    await writeFile(storagePath, payload.bytes, { flag: 'wx' });
    try {
      const stored = this.database.createFile({
        id,
        userId,
        name,
        mimeType: payload.mimeType,
        size: payload.bytes.length,
        kind: 'image',
        storagePath,
      });
      return { id: stored.id, name: stored.name, mimeType: stored.mimeType, size: stored.size, kind: stored.kind };
    } catch (error) {
      await unlink(storagePath).catch(() => undefined);
      throw error;
    }
  }

  private async fileForUser(fileId: string, userId: string): Promise<{ stored: StoredFile; dataUrl: string }> {
    const stored = this.database.getFile(fileId);
    if (!stored || stored.userId !== userId) throw new ProviderError(400, 'attachment_not_found', '附件不存在或无权访问。', false);
    const bytes = await readFile(stored.storagePath);
    return { stored, dataUrl: `data:${stored.mimeType};base64,${bytes.toString('base64')}` };
  }

  private async responsesBody(
    request: GenerateRequest,
    userId: string,
    model: string,
    disabledTools: ReadonlySet<ResponseToolType>,
    compatibility: RequestCompatibility,
  ) {
    const input: any[] = [];
    for (const message of request.messages) {
      if (message.role === 'assistant') {
        if (message.content.trim()) input.push({ role: 'assistant', content: message.content });
        const imageContent: any[] = [];
        for (const attachment of message.attachments) {
          if (attachment.kind !== 'image') continue;
          try {
            const file = await this.fileForUser(attachment.id, userId);
            if (file.stored.kind === 'image') imageContent.push({ type: 'input_image', image_url: file.dataUrl });
          } catch {
            // A stale local reference should not make a later text turn fail.
            // Image continuations are routed before this body is built; for a
            // normal vision question, use the image only when it is available.
          }
        }
        if (imageContent.length) input.push({ role: 'user', content: imageContent });
        continue;
      }
      if (!message.attachments.length) {
        input.push({ role: message.role, content: message.content });
        continue;
      }
      if (message.role !== 'user') throw new ProviderError(400, 'invalid_attachment_role', '只有用户消息可以包含附件。', false);
      const content: any[] = [];
      if (message.content.trim()) content.push({ type: 'input_text', text: message.content });
      for (const attachment of message.attachments) {
        const file = await this.fileForUser(attachment.id, userId);
        if (file.stored.kind === 'image') content.push({ type: 'input_image', image_url: file.dataUrl });
        else content.push({ type: 'input_file', filename: file.stored.name, file_data: file.dataUrl });
      }
      input.push({ role: 'user', content });
    }
    const tools: any[] = [];
    if (request.options.webSearch && !disabledTools.has('web_search')) tools.push({ type: 'web_search' });
    if (request.options.codeInterpreter && !disabledTools.has('code_interpreter')) tools.push({ type: 'code_interpreter', container: { type: 'auto' } });
    const effort = compatibleReasoningEffort(model, request.options.reasoningEffort);
    return {
      model,
      input,
      instructions: identityInstructions(request.options.instructions, model),
      ...(effort !== 'none' && !compatibility.omitReasoning ? { reasoning: { effort } } : {}),
      ...(!compatibility.omitVerbosity ? { text: { verbosity: request.options.verbosity } } : {}),
      max_output_tokens: Math.min(request.options.maxOutputTokens, this.config.maxOutputTokens),
      safety_identifier: safetyIdentifier(userId),
      store: false,
      stream: true,
      ...(tools.length ? { tools } : {}),
    };
  }

  private async chatBody(request: GenerateRequest, userId: string, model: string, compatibility: RequestCompatibility) {
    const messages: any[] = [{ role: 'system', content: identityInstructions(request.options.instructions, model) }];
    for (const message of request.messages) {
      if (message.role === 'assistant') {
        if (message.content.trim()) messages.push({ role: 'assistant', content: message.content });
        const imageContent: any[] = [];
        for (const attachment of message.attachments) {
          if (attachment.kind !== 'image') continue;
          try {
            const file = await this.fileForUser(attachment.id, userId);
            if (file.stored.kind === 'image') imageContent.push({ type: 'image_url', image_url: { url: file.dataUrl } });
          } catch {
            // Ignore stale generated-image references for ordinary text turns.
          }
        }
        if (imageContent.length) messages.push({ role: 'user', content: imageContent });
        continue;
      }
      if (!message.attachments.length) {
        messages.push({ role: message.role, content: message.content });
        continue;
      }
      if (message.role !== 'user') throw new ProviderError(400, 'invalid_attachment_role', '只有用户消息可以包含附件。', false);
      const content: any[] = [];
      if (message.content.trim()) content.push({ type: 'text', text: message.content });
      for (const attachment of message.attachments) {
        const file = await this.fileForUser(attachment.id, userId);
        if (file.stored.kind !== 'image') throw new ProviderError(400, 'documents_require_responses', 'PDF 附件需要管理员将协议设置为 Responses。', false);
        content.push({ type: 'image_url', image_url: { url: file.dataUrl } });
      }
      messages.push({ role: 'user', content });
    }
    const effort = compatibleReasoningEffort(model, request.options.reasoningEffort);
    return {
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: Math.min(request.options.maxOutputTokens, this.config.maxOutputTokens),
      ...(supportsChatReasoning(model) && effort !== 'none' && !compatibility.omitReasoning ? { reasoning_effort: effort } : {}),
      // Chat Completions has no portable verbosity field; Responses is used when this matters.
    };
  }

  private async consume(response: Response, mode: ProviderSettings['apiMode'], signal: AbortSignal, onDelta: DeltaHandler): Promise<ProviderContentResult> {
    let text = '';
    let responseId: string | undefined;
    let usage: TokenUsage | undefined;
    const emit = (delta: string) => { if (!delta) return; text += delta; onDelta(delta); };
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
      const data: any = await response.json();
      const value = textFromResponseJson(data, mode);
      if (value) emit(value);
      return { text, responseId: data?.id, usage: usageFrom(data?.usage) };
    }
    const handleEvent = ({ event, data }: SseEvent) => {
      if (data === '[DONE]') return;
      let value: any;
      try { value = JSON.parse(data); } catch { return; }
      const type = value?.type ?? event;
      if (type === 'error' || type === 'response.failed' || value?.error) {
        throw providerErrorFromDetails(502, value?.error?.code ?? value?.code ?? 'provider_stream_error', value?.error?.message ?? value?.message ?? value?.response?.error?.message ?? '模型服务流式响应失败。');
      }
      if (mode === 'responses') {
        if (type === 'response.created') responseId = value?.response?.id ?? responseId;
        if (type === 'response.output_text.delta' && typeof value?.delta === 'string') emit(value.delta);
        if (type === 'response.completed') {
          responseId = value?.response?.id ?? responseId;
          usage = usageFrom(value?.response?.usage) ?? usage;
        }
      } else {
        responseId = value?.id ?? responseId;
        usage = usageFrom(value?.usage) ?? usage;
        emit(textFromContent(value?.choices?.[0]?.delta?.content));
      }
    };
    const parser = createSseParser(handleEvent);
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.push(decoder.decode());
    } else {
      parser.push(await response.text());
    }
    parser.flush();
    if (!text && !responseId) throw new ProviderError(502, 'empty_provider_response', '模型服务未返回可识别的内容。', true);
    return { text, responseId, usage };
  }
}
