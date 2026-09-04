import { z } from 'zod';

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

export const generationOptionsSchema = z.object({
  model: z.string().trim().min(1).max(100).default(DEFAULT_MODEL_ID),
  reasoningEffort: reasoningEffortSchema.default('medium'),
  verbosity: verbositySchema.default('medium'),
  instructions: z.string().max(20_000).default(''),
  maxOutputTokens: z.number().int().min(256).max(131_072).default(8_192),
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

export type ServerSocketMessage =
  | { type: 'ready' }
  | { type: 'started'; requestId: string }
  | { type: 'delta'; requestId: string; delta: string }
  | { type: 'done'; requestId: string; model?: string; responseId?: string; usage?: TokenUsage; attachments?: GeneratedAttachment[] }
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
};
