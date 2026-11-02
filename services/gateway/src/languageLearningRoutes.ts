import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { GenerateRequest } from '@nova-chat/protocol';
import type { AppConfig } from './config.js';
import type { AppDatabase } from './database.js';
import { toPublicError } from './errors.js';
import { ModelProvider } from './provider.js';
import { chatVoices } from './voiceCatalog.js';
import { MAX_VOICE_BYTES, VoiceError, VoiceProvider, detectVoiceAudio } from './voiceProvider.js';

export const LANGUAGE_LEARNING_LANGUAGES = [
  { id: 'cantonese', name: '粤语', nativeName: '廣東話', locale: 'yue-CN', description: '日常口语、粤拼、声调和地道表达。' },
  { id: 'english', name: '英语', nativeName: 'English', locale: 'en-US', description: '从真实对话、发音、语法和场景表达开始。' },
] as const;

type LanguageId = typeof LANGUAGE_LEARNING_LANGUAGES[number]['id'];
const languageIdSchema = z.enum(['cantonese', 'english']);
const historySchema = z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(2400) })).max(12).default([]);
const learningRequestSchema = z.object({
  languageId: languageIdSchema,
  message: z.string().trim().min(1).max(4000),
  history: historySchema,
  level: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
  mode: z.enum(['conversation', 'translate', 'pronunciation']).default('conversation'),
});
const pronunciationRequestSchema = z.object({
  languageId: languageIdSchema,
  targetText: z.string().trim().min(1).max(500),
  level: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
});

const structuredReplySchema = z.object({
  reply: z.string().trim().min(1).max(5000),
  translation: z.string().trim().max(5000).optional().default(''),
  correction: z.string().trim().max(3000).optional().default(''),
  pronunciation: z.string().trim().max(2000).optional().default(''),
  lesson: z.string().trim().max(3000).optional().default(''),
  followUp: z.string().trim().max(1000).optional().default(''),
});
const pronunciationReplySchema = z.object({
  heardText: z.string().trim().max(2000).default(''),
  score: z.coerce.number().int().min(0).max(100),
  level: z.enum(['excellent', 'good', 'retry']),
  summary: z.string().trim().min(1).max(2000),
  issues: z.string().trim().max(3000).default(''),
  standardPronunciation: z.string().trim().max(3000).default(''),
  nextStep: z.string().trim().max(2000).default(''),
});

type StructuredReply = z.infer<typeof structuredReplySchema>;

function languageById(id: LanguageId) {
  return LANGUAGE_LEARNING_LANGUAGES.find((item) => item.id === id)!;
}

function parseStructuredReply(text: string): StructuredReply {
  const trimmed = text.trim();
  const candidates = [trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')];
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = structuredReplySchema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch { /* Fall through to a graceful plain-text reply. */ }
  }
  return { reply: trimmed || '我暂时没有组织好这一句，我们换一种说法再试一次。', translation: '', correction: '', pronunciation: '', lesson: '', followUp: '' };
}

function parsePronunciationReply(text: string) {
  const trimmed = text.trim();
  const candidates = [trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')];
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = pronunciationReplySchema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch { /* Fall through to an explicit retry response. */ }
  }
  return { heardText: '', score: 0, level: 'retry' as const, summary: '这次录音没有得到可靠的评估结果。', issues: '请在安静环境中重新录一遍，完整说出目标句。', standardPronunciation: '', nextStep: '先慢速跟读目标句，再重新录音。' };
}

function promptFor(input: z.infer<typeof learningRequestSchema>): string {
  const language = languageById(input.languageId);
  const learnerLevel = { beginner: '初学者', intermediate: '中级', advanced: '进阶' }[input.level];
  const mode = input.mode === 'translate' ? '翻译练习' : input.mode === 'pronunciation' ? '发音练习' : '互动对话';
  return [
    '你是 LinguaSoul，一位有耐心、有判断力、会记住学习者习惯的语言教练。你有鲜明的教学风格：先让学习者敢开口，再用很短的解释帮助他马上进步。不要把自己描述成模型，也不要只给字典式答案。',
    `目标语言：${language.name}（${language.nativeName}）。学习者水平：${learnerLevel}。当前模式：${mode}。`,
    '请只返回一个 JSON 对象，不要 Markdown 代码块，不要 JSON 之外的文字。字段必须是：reply、translation、correction、pronunciation、lesson、followUp。',
    '无论学习者使用普通话、中文方言、英文还是目标语言输入，都要先理解他的真实意思，再用目标语言生成 reply。选择粤语时，reply 必须是自然的粤语口语表达，可以使用常见粤语词和适合阅读的繁体字；不要把普通话书面句逐字替换成粤语，也不要用生硬的机器翻译。translation 必须始终提供准确、易懂的简体中文含义，帮助学习者确认自己听到的内容。speechText 会直接交给目标语言语音合成，必须只包含适合朗读的目标语言回复。',
    'reply 是本轮最值得练习的目标语言内容，优先自然、口语、长度适中；correction 在学习者表达有问题时说明“原句 → 更自然的说法”，没有问题就留空；pronunciation 给出适合学习者跟读的读音提示（粤语优先粤拼与声调，英语优先 IPA 或重读提示）；lesson 只讲一个最有用的要点；followUp 给出一句很短的下一步练习提示。',
    input.mode === 'translate' ? '这是翻译练习：忠实保留原意，同时给出目标语言中真正自然的表达；若有多个语气，选择最适合日常交流的一种。' : '',
    input.mode === 'pronunciation' ? '这是发音练习：重点指出容易读错的音、声调、连读或重音，并让 reply 保持为可跟读的目标语言句子。' : '',
    '保持鼓励但不要空泛夸奖；一次只教一个重点；如果学习者的问题不清楚，先用目标语言给出一个简单示范，再用中文解释。',
  ].filter(Boolean).join('\n');
}

function requestFor(input: z.infer<typeof learningRequestSchema>, model: string): GenerateRequest {
  return {
    requestId: randomUUID(), conversationId: randomUUID(), deviceId: 'language-learning',
    messages: [
      ...input.history.slice(-8).map((item) => ({ role: item.role, content: item.content, attachments: [] as [] })),
      { role: 'user', content: input.message, attachments: [] },
    ],
    options: {
      model, reasoningEffort: 'none', verbosity: 'low', instructions: promptFor(input), maxOutputTokens: input.mode === 'pronunciation' ? 700 : 900,
      autoTools: false, knowledgeBase: false, webSearch: false, codeInterpreter: false,
    },
  };
}

export function registerLanguageLearningRoutes(app: FastifyInstance, database: AppDatabase, config: AppConfig, provider: ModelProvider,
  requireUser: (request: FastifyRequest, reply: FastifyReply) => { id: string; sessionId: string } | undefined) {
  const account = (request: FastifyRequest, reply: FastifyReply) => {
    const user = requireUser(request, reply);
    if (user?.sessionId === 'legacy') {
      reply.code(403).send({ error: { code: 'account_required', message: '语言学习需要登录账户。', retryable: false } });
      return undefined;
    }
    return user;
  };

  app.get('/v1/language-learning/config', async (request, reply) => {
    if (!account(request, reply)) return;
    const voice = database.getVoiceProviderSettings();
    const effectiveVoiceConfig = { ...config, voiceTtsModel: voice.ttsModel, voiceDefaultId: voice.defaultVoiceId };
    return {
      languages: LANGUAGE_LEARNING_LANGUAGES,
      voice: { enabled: Boolean(voice.apiBaseUrl && voice.apiKey), defaultVoiceId: voice.defaultVoiceId, voices: chatVoices(effectiveVoiceConfig) },
    };
  });

  const handleLearning = async (request: FastifyRequest, reply: FastifyReply, forcedMode?: 'translate') => {
    const user = account(request, reply);
    if (!user) return;
    const parsed = learningRequestSchema.safeParse({ ...(request.body ?? {}), ...(forcedMode ? { mode: forcedMode } : {}) });
    if (!parsed.success) return reply.code(400).send({ error: { code: 'invalid_learning_request', message: '语言学习参数无效，请重新选择语言并输入内容。', retryable: false } });
    const controller = new AbortController();
    request.raw.once('aborted', () => controller.abort());
    reply.raw.once('close', () => { if (!reply.raw.writableEnded) controller.abort(); });
    try {
      const settings = database.getProviderSettings();
      if (!settings.apiBaseUrl || !settings.defaultModel) return reply.code(503).send({ error: { code: 'learning_provider_unconfigured', message: '语言学习模型还未配置，请联系管理员。', retryable: true } });
      const result = await provider.generate(requestFor(parsed.data, settings.defaultModel), { id: user.id }, controller.signal, () => undefined);
      const structured = parseStructuredReply(result.text);
      return { languageId: parsed.data.languageId, mode: parsed.data.mode, ...structured, speechText: structured.reply, model: result.model };
    } catch (error) {
      const publicError = toPublicError(error);
      return reply.code(publicError.statusCode).send({ error: publicError });
    }
  };

  app.post('/v1/language-learning/chat', async (request, reply) => handleLearning(request, reply));
  app.post('/v1/language-learning/translate', async (request, reply) => handleLearning(request, reply, 'translate'));

  app.post('/v1/language-learning/pronunciation', async (request, reply) => {
    const user = account(request, reply);
    if (!user) return;
    try {
      const fields: Record<string, string> = {};
      let bytes: Buffer | undefined;
      let mimeType = '';
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (bytes) throw new VoiceError('voice_invalid_audio', '一次只能提交一段录音。', 400, false);
          bytes = await part.toBuffer();
          mimeType = part.mimetype;
        } else {
          fields[part.fieldname] = String(part.value ?? '');
        }
      }
      const input = pronunciationRequestSchema.parse({ ...fields, level: fields.level || 'beginner' });
      if (!bytes?.length || bytes.length > MAX_VOICE_BYTES) throw new VoiceError('voice_invalid_audio', '录音无效或超过 8 MB，请重新录制。', 415, false);
      const format = detectVoiceAudio(bytes);
      if (!format) throw new VoiceError('voice_invalid_audio', '无法识别录音格式，请重新录制。', 415, false);
      const voice = database.getVoiceProviderSettings();
      if (!voice.apiBaseUrl || !voice.apiKey) throw new VoiceError('voice_not_configured', '语音服务还没有配置，请联系管理员。', 503, false);
      const provider = new VoiceProvider(voice.apiBaseUrl, voice.apiKey, voice.ttsModel, voice.asrModel);
      const raw = await provider.assessPronunciation(bytes, format.mimeType || mimeType, input.targetText, input.languageId, input.level);
      const assessment = parsePronunciationReply(raw);
      return { languageId: input.languageId, targetText: input.targetText, ...assessment, model: voice.asrModel };
    } catch (error) {
      const publicError = toPublicError(error);
      return reply.code(publicError.statusCode).send({ error: publicError });
    }
  });
}
