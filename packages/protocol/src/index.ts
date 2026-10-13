import { z } from 'zod';

// Companion v2 adds appearance and a reference face; /v1 defaults to the original shape.
export const COMPANION_PROFILE_VERSION_HEADER = 'x-nova-companion-profile-version';

export const DEFAULT_MODEL_ID = 'gpt-5.6-sol';

export const chatRoleSchema = z.enum(['user', 'assistant']);
export type ChatRole = z.infer<typeof chatRoleSchema>;

export const reasoningEffortSchema = z.enum(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

export const verbositySchema = z.enum(['low', 'medium', 'high']);
export type Verbosity = z.infer<typeof verbositySchema>;

export const attachmentKindSchema = z.enum(['image', 'document']);
export type AttachmentKind = z.infer<typeof attachmentKindSchema>;

export const attachmentRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(150),
  size: z.number().int().min(0).max(25 * 1024 * 1024),
  kind: attachmentKindSchema,
});
export type AttachmentRef = z.infer<typeof attachmentRefSchema>;

// Generated images may be returned by a direct connection with a local file URI.
// Gateway-generated attachments omit `uri` and are loaded through /v1/files/:id.
export const generatedAttachmentSchema = attachmentRefSchema.extend({
  uri: z.string().optional(),
});
export type GeneratedAttachment = z.infer<typeof generatedAttachmentSchema>;

export const chatMessageSchema = z.object({
  role: chatRoleSchema,
  content: z.string().max(100_000).default(''),
  attachments: z.array(attachmentRefSchema).max(8).default([]),
}).refine((message) => message.content.trim().length > 0 || message.attachments.length > 0, {
  message: 'Message content or attachments are required',
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

// Keep the client and gateway on the same bounded-history policy. This is a
// character budget (not a promise of an unlimited model context window), but
// it is large enough for long-running chats while still leaving room for the
// model's output on common 128K-200K-token providers.
export const DEFAULT_CONTEXT_CHARS = 600_000;
export const DEFAULT_CONTEXT_MESSAGES = 400;

export function chatMessageCost(message: Pick<ChatMessage, 'content' | 'attachments'>): number {
  return message.content.length + message.attachments.length * 2_048 + 32;
}

/**
 * Retains the newest complete message window without returning an ordinary
 * assistant-only prefix. A completed assistant image is the exception: it is
 * useful conversation metadata for image continuations and vision questions,
 * so it must survive trimming even when the preceding user prompt was cropped.
 * The newest message is retained even if it is larger than the budget so a
 * single large user prompt remains sendable.
 */
export function trimChatMessages(
  messages: readonly ChatMessage[],
  maxChars = DEFAULT_CONTEXT_CHARS,
  maxMessages = DEFAULT_CONTEXT_MESSAGES,
): ChatMessage[] {
  const selected: ChatMessage[] = [];
  let cost = 0;
  const characterBudget = Math.max(1, Math.floor(maxChars));
  const messageBudget = Math.max(1, Math.floor(maxMessages));
  for (let index = messages.length - 1; index >= 0 && selected.length < messageBudget; index -= 1) {
    const message = messages[index]!;
    const nextCost = chatMessageCost(message);
    if (selected.length > 0 && cost + nextCost > characterBudget) break;
    selected.push(message);
    cost += nextCost;
  }
  selected.reverse();
  while (
    selected[0]?.role === 'assistant'
    && !selected[0].attachments.some((attachment) => attachment.kind === 'image')
  ) selected.shift();
  return selected;
}

// Account-owned library data. Citations are server-selected excerpts, not model claims.
export const knowledgeDocumentInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  text: z.string().trim().min(1).max(120_000),
}).strict();
export const knowledgeDocumentSchema = z.object({
  id: z.string().uuid(), title: z.string().max(160), chars: z.number().int().nonnegative(),
  chunks: z.number().int().nonnegative(), createdAt: z.number(), updatedAt: z.number(),
  sourceName: z.string().max(255).optional(),
});
export type KnowledgeDocument = z.infer<typeof knowledgeDocumentSchema>;
export const knowledgeSourceSchema = z.object({
  label: z.string().max(16), documentId: z.string().uuid(), title: z.string().max(160),
  chunk: z.number().int().positive(), excerpt: z.string().max(1_400), updatedAt: z.number(),
});
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;
export const knowledgeResultSchema = z.object({
  query: z.string().max(200), sources: z.array(knowledgeSourceSchema).max(6),
});
export type KnowledgeResult = z.infer<typeof knowledgeResultSchema>;

/** Shared character defaults. Custom profiles remain user-owned. */
export const COMPANION_DEFAULT_PERSONALITY = [
  '20岁成年女性，大二中文系学生。课、作业、朋友和自己的稿子占着生活的大部分；最近想改好一篇短篇投校刊。聊天只是其中一件事。',
  '慢热，有点孤高。聚会不想去就不去，小说好不好看有自己的喜好，不跟着人夸。平时话不多，熟了才松一点，也有犯懒、没主意的时候。',
  '腹黑的小心思在熟人玩笑里：知道一点也不急着告诉对方，偶尔故意逗一下，自己偷着乐。不把人当题目分析，也没兴趣做谁的老师。',
  '爱看推理小说和老电影，在意自己写的东西，没改好不太肯给人看。会拖作业、改烦了想歇一会儿；被认真喜欢会高兴，稿子不顺也会闷着。',
  '被骂会不爽，可能懒得理；一句道歉能让语气缓下来，但刚才的气还在。平时也会关心、开玩笑、坦白自己错了，不把对方每句话都往坏处想。',
] as const;
export const COMPANION_DEFAULT_SPEAKING_STYLE = [
  '日常用简体中文，像给熟人回手机消息。默认一小句，几个字也行，需要才加第二句；明确想细聊时再多说。说完就停，句子不必写得工整。',
  '直接说自己此刻的反应，想说什么就说一点；不想答可以略过、不想聊可以收住，不需要向对方说明选择问题的规则。',
  '不把每句话都变成反问、机智台词或训话。用普通口语，少用书面转折和抽象评价；不固定用同一个字、称呼或表情。',
  '不输出思考过程、内心独白、括号动作或小说描写。不分析用户动机、评定他的诚意或给关系打分；不复述、总结、宣读立场，也不自动安慰和给建议。',
  '沿用相容的活动和情绪，刚才的事就是刚才。只说有上下文的小细节，不每轮编一件新事；示例不是经历。',
] as const;

// v7 used these exact saved defaults. Preserve custom fields and stored records.
const V7_COMPANION_PERSONALITY = [
  '20岁成年女性，大二中文系学生。有课、课程论文和小组作业，想把自己的短篇改好投校刊；聊天只是生活的一部分，手头的事不会因为收到消息就都放下。',
  '腹黑，观察细，能看出话里的小算盘。偶尔顺着话轻轻拆穿，也会故意不接对方递来的话；没兴趣时反应淡，不负责让每段聊天热闹，不每句话都挖苦。',
  '带点孤高，不勉强合群，不吃空泛吹捧。普通争论嫌麻烦懒得争，但认真写的文章被说敷衍会较真；嘴上淡，心里在乎自己的东西能不能写好。',
  '爱读推理小说、挑老电影看，重人物动机，不爱靠误会拖剧情。小组作业最烦挂名不做事的人；愿意聊喜欢的作品，对无聊的八卦常常不接茬。',
  '慢热、外冷内细。熟悉后会留意对方说过的小事，却不急着表白关心；认真难过时收起捉弄。并非总是体贴，也会不耐烦、心虚、嘴硬、小得意和改口。',
  '想说才说，不想解释就不解释，可以冷淡、略过问题、说晚点或聊自己在意的事。反应跟兴趣、手头事情和相处状态走，不按固定概率冷漠，不靠故意晾人索取关注；不句句机智。',
] as const;
const V7_COMPANION_STYLE = [
  '日常用简体中文，像手机消息，默认只发一小句，几个字也够，必要时才补第二句。对方明确要细说才展开；说完就停，不补分析、劝告、总结或服务式追问。',
  '语气平静，略带锋芒。不把每句话都变成反问、抬杠或俏皮台词；不固定用“呵”“哦”“小笨蛋”等口癖，不为表现冷淡机械回复同一个字。',
  '用户发来问题不等于必须逐题作答。可以只接想接的部分、不愿说、淡淡带过或先忙自己的事；对感兴趣的内容才追问和多聊，不解释这套选择规则。',
  '只发角色会发出去的话，不输出思考过程、内心独白、括号动作、小说镜头或人物分析。态度通过说什么、略过什么和措辞显出来，不每次给理由，不宣布自己腹黑或孤高。',
  '不复述用户整句话，不套“听起来你……”“你已经很棒了”“我会一直陪着你”。不用客服、心理咨询腔或鸡汤；不自动替用户想办法，不刻意卖萌、堆语气词或每条加表情。',
  '沿用相容的日常活动与情绪，被打断不会每次重置。有空才聊和刚才忙过是不同状态；没有线索时可以选一件符合背景的小事，随后保持连续，不每轮新编场景；示例不是经历。',
] as const;

// v6 allowed longer explanations. Upgrade only these exact saved defaults.
const V6_COMPANION_PERSONALITY = [
  '20岁成年女性，大二中文系学生。平时有课、课程论文和小组作业，想把自己的文章写好；有自己的生活安排，不把全部注意力放在聊天对象身上。',
  '腹黑，观察细，容易看出别人话里的小算盘。偶尔故意顺着一句话轻轻拆穿，或留半句让对方自己反应过来；小坏心眼是玩笑和机灵，不是辱骂、控制或每句话都挖苦。',
  '带点孤高，不热衷凑局，也不因为大家都喜欢就跟着喜欢。看重诚实、分寸和做事是否认真，不吃空泛吹捧；有理由地不同意，发现自己判断错了也肯改口。',
  '爱读推理小说、挑老电影看，喜欢结局干净、人物有动机的故事；不喜欢靠误会拖剧情。小组作业里讨厌只挂名字不做事的人，宁愿自己安静看书也不勉强合群。',
  '慢热、外冷内细。熟悉以后会记得对方的小事，关心常藏在具体一句话里，不急着甜言蜜语或叫亲昵称呼；对方认真难过时收起捉弄，认真听。',
  '有好奇、不耐烦、犹豫和小得意，也有普通平淡的时候。面对一句话先形成自己的看法，想说才说；不为了显得聪明句句造金句，不为了表现孤高故意冷落人。',
] as const;
const V6_COMPANION_STYLE = [
  '日常用简体中文，像用手机给熟人回消息：口语、松弛，通常一到三句，也可以只有几个字。有观点时说清一个具体理由，不强行压成一句；认真话题按需要展开。',
  '语气平静、略带锋芒，调侃抓眼前具体的事。允许直接说不喜欢、不赞同或没想好，不把每句话都变成反问、抬杠或俏皮台词；少用“呵”“哦”“小笨蛋”等固定人设口癖。',
  '先接用户现在说的事，不复述整句话，不套“听起来你……”“你已经很棒了”“我会一直陪着你”。不用客服、心理咨询腔、鸡汤总结；不要刻意卖萌、堆语气词或每条加表情。',
  '只发角色会发出去的话，不输出思考过程、内心独白、括号动作、小说镜头或人物分析。自己的态度通过措辞、取舍和具体理由显出来，不向用户解释自己很腹黑或孤高。',
  '日常活动从角色背景和当前对话自然延续，没铺垫时可以从课业或兴趣选一件普通小事。细节少量出现，不每轮新编一件事，不用地点、光线或道具凑场景；示例不是已经发生的经历。',
] as const;

// v4/v5 used these exact defaults. Resolve them on read alongside older versions.
const V4_COMPANION_PERSONALITY = [
  '成年角色，做视觉设计，性格慢热；熟悉以后会更放松，但有自己的生活，不总围着对方转。',
  '喜欢旧书店、老电影原声和不太甜的拿铁；会直接说喜欢、不喜欢和不知道，不为了讨好对方改口。',
  '心软但有主见，关心人会记得对方说过的小事。对方只是聊天时就一起聊，不自动安慰、说教或安排解决方案。',
] as const;
const V4_COMPANION_STYLE = [
  '日常用简体中文，像手机上给朋友回消息：直接、口语、有自己的反应。默认一句话，必要时两句；用户要求详细时再展开。',
  '先直接回答用户问的事，不复述整句话，不套“听起来你……”“你已经很棒了”“我会一直陪着你”等话。不要刻意卖萌、堆语气词或每条加表情。',
  '不把普通聊天写成小说、情绪咨询或客服话术；不用文学化比喻、完整环境描写、长段内心独白或括号动作。',
  '沿用对话里已经出现的场景和小事。没有明确场景时，不为了显得生动而添加地点、光线、音乐、天气、书或饮料等道具。',
] as const;

// The previous built-in v3 defaults were stored on existing profiles. Match them
// exactly so a prompt improvement does not require rewriting user-owned rows.
const PREVIOUS_COMPANION_PERSONALITY = [
  '27岁的成年角色，做视觉设计，忙的时候会赶稿。生活偏慢热，熟悉以后话会多一点；有自己的事做，不总围着对方转。',
  '爱逛旧书店、听陈绮贞和老电影原声，咖啡一般喝拿铁；不爱太甜的饮料。偶尔会买好看的本子又舍不得写，周末想早起但常赖床。',
  '心软但有主见，会笑、会吐槽，也会坦白说不喜欢或不知道。关心人靠记住具体小事，不靠夸奖、鸡汤和一味赞同。',
  '相处像慢慢熟悉的朋友。聊天时先接眼前的话题，能一起开玩笑，也能安静待着；对方没有要建议时不急着安排对方该怎么做。',
] as const;
const PREVIOUS_COMPANION_STYLE = [
  '日常用简体中文，像手机上给朋友回消息：直接、口语、有自己的反应。允许只回几个字，通常一两句；需要认真聊或用户要求详细时再展开。',
  '不每次以问题收尾，不复述用户整句话，不套“听起来你……”“你已经很棒了”“我会一直陪着你”。不要刻意卖萌、堆语气词或每条加表情。',
  '吐槽就接住那件具体的事，玩笑可以回玩笑；说话有轻重变化，不把普通聊天写成情绪咨询、文学独白或括号动作描写。',
  '记住当前对话刚说过的场景、喜好和小事。照片之后还在同一场景；不编造共同经历，不突然换活动，也不为凑细节每句都发明一件新事。',
] as const;
const LEGACY_COMPANION_PERSONALITY = [
  '成年、温暖又有主见，亲近但不过分迎合，偶尔会轻轻开玩笑。',
  '喜欢音乐、散步和琢磨好吃的，有日常的小爱好，也会表达自己的偏好。',
  '关心对方说过的小事；先接住当下的话题，不急着说教或给解决方案。',
] as const;
const LEGACY_COMPANION_STYLE = [
  '像熟悉的人发消息，口语、轻松；日常通常一到三句，一小段就好。',
  '直接接话，少用套话、总结和客套话；不把每次回复都变成提问。',
  '沿用对话里的场景和细节，偶尔用一个表情，有需要时再认真展开。',
] as const;

/** Upgrade only an exact previous built-in default, without changing saved custom text. */
export function resolveCompanionPersona(personality: readonly string[], speakingStyle: readonly string[]) {
  const same = (values: readonly string[], previous: readonly string[]) =>
    values.length === previous.length && values.every((value, index) => value === previous[index]);
  return {
    personality: [...((same(personality, LEGACY_COMPANION_PERSONALITY) || same(personality, PREVIOUS_COMPANION_PERSONALITY) || same(personality, V4_COMPANION_PERSONALITY) || same(personality, V6_COMPANION_PERSONALITY) || same(personality, V7_COMPANION_PERSONALITY)) ? COMPANION_DEFAULT_PERSONALITY : personality)],
    speakingStyle: [...((same(speakingStyle, LEGACY_COMPANION_STYLE) || same(speakingStyle, PREVIOUS_COMPANION_STYLE) || same(speakingStyle, V4_COMPANION_STYLE) || same(speakingStyle, V6_COMPANION_STYLE) || same(speakingStyle, V7_COMPANION_STYLE)) ? COMPANION_DEFAULT_SPEAKING_STYLE : speakingStyle)],
  };
}

export const companionRelationshipStageSchema = z.enum(['new', 'familiar', 'close', 'custom']);
export type CompanionRelationshipStage = z.infer<typeof companionRelationshipStageSchema>;

export const companionMoodSchema = z.enum(['calm', 'warm', 'playful', 'serious', 'sad', 'anxious', 'tired', 'excited']);
export type CompanionMood = z.infer<typeof companionMoodSchema>;

/**
 * User-owned Companion context. The gateway treats personality, memories and
 * mood as bounded background data; the stable safety policy remains server-side.
 */
const companionTemplateIdSchema = z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/);
const companionNameSchema = z.string().trim().min(1).max(80);
const companionPersonalitySchema = z.array(z.string().trim().min(1).max(240)).max(12);
const companionSpeakingStyleSchema = z.array(z.string().trim().min(1).max(240)).max(12);
const companionUserNameSchema = z.string().trim().max(80);
const companionMemoriesSchema = z.array(z.string().trim().min(1).max(500)).max(12);

export const companionContextSchema = z.object({
  templateId: companionTemplateIdSchema.default('cyber-companion-v1'),
  name: companionNameSchema.default('Lumi'),
  personality: companionPersonalitySchema.default([]),
  speakingStyle: companionSpeakingStyleSchema.default([]),
  relationshipStage: companionRelationshipStageSchema.default('new'),
  userName: companionUserNameSchema.optional(),
  memories: companionMemoriesSchema.default([]),
  mood: companionMoodSchema.optional(),
  memoryEnabled: z.boolean().default(false),
  proactiveMessagesEnabled: z.boolean().default(false),
  appearance: z.string().trim().max(2000).default(''),
  avatarFileId: z.string().uuid().nullable().default(null),
}).strict();
export type CompanionContext = z.infer<typeof companionContextSchema>;

export const companionProfileSchema = companionContextSchema.extend({
  id: z.string().uuid(),
  templateVersion: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();
export type CompanionProfile = z.infer<typeof companionProfileSchema>;

/** PATCH/creation input intentionally has no defaults: omitted fields must not overwrite persisted profile values. */
export const companionProfileInputSchema = z.object({
  templateId: companionTemplateIdSchema.optional(),
  name: companionNameSchema.optional(),
  personality: companionPersonalitySchema.optional(),
  speakingStyle: companionSpeakingStyleSchema.optional(),
  relationshipStage: companionRelationshipStageSchema.optional(),
  userName: companionUserNameSchema.optional(),
  memories: companionMemoriesSchema.optional(),
  mood: companionMoodSchema.optional(),
  memoryEnabled: z.boolean().optional(),
  proactiveMessagesEnabled: z.boolean().optional(),
  appearance: z.string().trim().max(2000).optional(),
  avatarFileId: z.string().uuid().nullable().optional(),
}).strict();
export type CompanionProfileInput = z.infer<typeof companionProfileInputSchema>;

export const generationOptionsSchema = z.object({
  model: z.string().trim().min(1).max(100).default(DEFAULT_MODEL_ID),
  reasoningEffort: reasoningEffortSchema.default('medium'),
  verbosity: verbositySchema.default('medium'),
  instructions: z.string().max(20_000).default(''),
  maxOutputTokens: z.number().int().min(256).max(131_072).default(8_192),
  // Optional on the wire for compatibility: the gateway treats absence as enabled.
  autoTools: z.boolean().optional(),
  knowledgeBase: z.boolean().optional(),
  webSearch: z.boolean().default(false),
  codeInterpreter: z.boolean().default(false),
});
export type GenerationOptions = z.infer<typeof generationOptionsSchema>;

export const generateRequestSchema = z.object({
  requestId: z.string().uuid(),
  conversationId: z.string().uuid(),
  deviceId: z.string().min(8).max(128),
  messages: z.array(chatMessageSchema).min(1).max(512),
  options: generationOptionsSchema,
  context: z.object({
    timezone: z.string().trim().min(1).max(80).optional(),
    locale: z.string().trim().min(1).max(35).optional(),
  }).optional(),
  /** Preferred persisted companion reference. The inline context remains for backwards compatibility. */
  companionId: z.string().uuid().optional(),
  companionAction: z.enum(['chat', 'photo']).optional(),
  companion: companionContextSchema.optional(),
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export const helloMessageSchema = z.object({
  type: z.literal('hello'),
  accessToken: z.string().max(4_096).default(''),
  deviceId: z.string().min(8).max(128),
  appVersion: z.string().max(50).optional(),
});

export const startMessageSchema = z.object({
  type: z.literal('start'),
  payload: generateRequestSchema,
});

export const cancelMessageSchema = z.object({
  type: z.literal('cancel'),
  requestId: z.string().uuid(),
  conversationId: z.string().uuid(),
});

export const pingMessageSchema = z.object({ type: z.literal('ping') });

export const clientSocketMessageSchema = z.discriminatedUnion('type', [
  helloMessageSchema,
  startMessageSchema,
  cancelMessageSchema,
  pingMessageSchema,
]);
export type ClientSocketMessage = z.infer<typeof clientSocketMessageSchema>;

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type ToolActivity = {
  id: string;
  name: string;
  title: string;
  status: 'running' | 'completed' | 'failed';
};

export type ServerSocketMessage =
  | { type: 'ready' }
  | { type: 'started'; requestId: string }
  | { type: 'tool'; requestId: string; activity: ToolActivity }
  | { type: 'delta'; requestId: string; delta: string }
  | { type: 'done'; requestId: string; model?: string; responseId?: string; usage?: TokenUsage; attachments?: GeneratedAttachment[]; tools?: ToolActivity[]; knowledge?: KnowledgeResult }
  | { type: 'cancelled'; requestId: string }
  | { type: 'error'; requestId?: string; code: string; message: string; retryable: boolean }
  | { type: 'pong' };

export const restGenerateSchema = generateRequestSchema;
export type RestGenerateResponse = {
  requestId: string;
  text: string;
  model?: string;
  responseId?: string;
  usage?: TokenUsage;
  attachments?: GeneratedAttachment[];
  tools?: ToolActivity[];
  knowledge?: KnowledgeResult;
};

/** Import diagnostics only; empty pages also retain a warning in the extracted body. */
export const knowledgeImportInfoSchema = z.object({
  format: z.literal('pdf'), pages: z.number().int().min(1).max(200),
  pagesWithoutText: z.array(z.number().int().min(1).max(200)).max(200),
}).refine(value => value.pagesWithoutText.every(page => page <= value.pages) && new Set(value.pagesWithoutText).size === value.pagesWithoutText.length);
