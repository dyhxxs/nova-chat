import { knowledgeDraftSchema } from './knowledgeDraft';
import { z } from 'zod';
import { generatedAttachmentSchema, generationOptionsSchema, knowledgeResultSchema } from '@nova-chat/protocol';
import type { Conversation } from '../types';
import { assistantPresetSchema } from './assistantPresets';

const date = z.number().finite().nonnegative();
const messageSchema = z.object({
  id: z.string().min(1), role: z.enum(['user', 'assistant']), content: z.string(),
  attachments: z.array(generatedAttachmentSchema).default([]),
  createdAt: date, status: z.enum(['complete', 'streaming', 'error', 'cancelled']),
  errorMessage: z.string().optional(), errorCode: z.string().max(120).optional(), retryable: z.boolean().optional(),
  knowledge: knowledgeResultSchema.optional(),
  usage: z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional(), totalTokens: z.number().optional() }).optional(),
  requestedModel: z.string().optional(), model: z.string().optional(), generationRequestId: z.string().optional(),
  generationOptions: generationOptionsSchema.omit({ model: true, instructions: true }).optional(),
  generationStartedAt: date.optional(), completedAt: date.optional(), starred: z.boolean().optional(),
});
const conversationSchema = z.object({
  id: z.string().min(1), title: z.string(), createdAt: date, updatedAt: date,
  pinned: z.boolean().optional(), archived: z.boolean().optional(), importSourceId: z.string().optional(),
  draft: z.string().max(10_000).optional(),
  kind: z.enum(['normal', 'companion']).optional(),
  companionId: z.string().uuid().optional(), companionName: z.string().max(80).optional(),
  assistant: z.object({ name: z.string().min(1).max(60), instructions: z.string().max(20_000) }).optional(),
  messages: z.array(z.unknown()),
});

/** Salvage valid records independently. Caller MUST preserve raw bytes before saving repairs. */
export function restoreLocalRecords(value: unknown, presets: unknown, draft?: unknown) {
  let repaired = !Array.isArray(value) || (presets !== undefined && !Array.isArray(presets));
  const conversations: Conversation[] = [];
  const seen = new Set<string>();
  for (const candidate of Array.isArray(value) ? value : []) {
    const parsed = conversationSchema.safeParse(candidate);
    if (!parsed.success || seen.has(parsed.data.id)) { repaired = true; continue; }
    seen.add(parsed.data.id);
    const messages: Conversation['messages'] = [];
    const messageIds = new Set<string>();
    for (const raw of parsed.data.messages) {
      const parsedMessage = messageSchema.safeParse(raw);
      if (!parsedMessage.success || messageIds.has(parsedMessage.data.id)) { repaired = true; continue; }
      const message = parsedMessage.data;
      messageIds.add(message.id);
      if (message.status === 'streaming' && !message.generationRequestId) {
        message.status = 'error'; message.errorMessage = '上次生成被中断，可以点击重新生成。';
        message.retryable = true; message.completedAt = Date.now();
      }
      messages.push(message);
    }
    conversations.push({ ...parsed.data, messages });
  }
  const assistantPresets = [];
  const presetIds = new Set<string>();
  for (const raw of Array.isArray(presets) ? presets : []) {
    const parsed = assistantPresetSchema.safeParse(raw);
    if (!parsed.success || presetIds.has(parsed.data.id)) { repaired = true; continue; }
    presetIds.add(parsed.data.id); assistantPresets.push(parsed.data);
  }
  const parsedDraft = draft === undefined ? undefined : knowledgeDraftSchema.safeParse(draft);
  if (parsedDraft && !parsedDraft.success) repaired = true;
  return { conversations, assistantPresets, knowledgeDraft: parsedDraft?.success ? parsedDraft.data : undefined, repaired };
}
