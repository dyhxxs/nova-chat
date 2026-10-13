import { accountScope } from './accountScope';
import { createId } from './id';
import type { AppMessage, Conversation } from '../types';

export type ForkMode = 'continue' | 'rewrite';
/** References and credentials are transient only; never persist or log this selection. */
export type ForkSelection = { scope: string; serverUrl: string; conversation: Conversation; messageId: string; mode: ForkMode };
export type ForkPreview = { messages: number; omitted: number; attachments: number; draft: string };
export class ConversationForkError extends Error {}
export const MAX_FORK_MESSAGES = 500;
export const MAX_FORK_CHARACTERS = 2_000_000;
export const MAX_FORK_CONVERSATIONS = 5_000;
type ForkState = {
  dataOwnerId?: string; dataOwnerServerUrl?: string; accessToken: string;
  authStatus: string; user?: { id: string }; settings: { serverUrl: string };
  activeConversationId: string; conversations: Conversation[];
};
export function isForkSelectionCurrent(selection: ForkSelection, state: ForkState): boolean {
  return state.authStatus === 'authenticated' && !!state.accessToken && !!state.dataOwnerId
    && state.user?.id === state.dataOwnerId && selection.scope === accountScope(state)
    && selection.serverUrl === state.settings.serverUrl
    && state.activeConversationId === selection.conversation.id
    && state.conversations.find(item => item.id === selection.conversation.id) === selection.conversation;
}
function cloneMessage(message: AppMessage): AppMessage {
  // Do not copy resumable request IDs, generation controls, usage, failures or unknown fields.
  return {
    id: message.id, role: message.role, content: message.content, createdAt: message.createdAt, status: 'complete',
    attachments: message.attachments.map(file => ({ id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, kind: file.kind, ...(file.uri ? { uri: file.uri } : {}) })),
    ...(message.model ? { model: message.model } : {}), ...(message.requestedModel ? { requestedModel: message.requestedModel } : {}),
    ...(message.knowledge ? { knowledge: { query: message.knowledge.query, sources: message.knowledge.sources.map(source => ({ label: source.label, documentId: source.documentId, title: source.title, chunk: source.chunk, excerpt: source.excerpt, updatedAt: source.updatedAt })) } } : {}),
  };
}
function prepare(conversation: Conversation, messageId: string, mode: ForkMode) {
  if (mode !== 'continue' && mode !== 'rewrite') throw new ConversationForkError('不支持的分支操作。');
  if (conversation.messages.some(message => message.status === 'streaming')) throw new ConversationForkError('当前对话仍在生成，请等待完成或停止后再创建分支。');
  const index = conversation.messages.findIndex(message => message.id === messageId);
  const target = conversation.messages[index];
  if (!target || target.status !== 'complete') throw new ConversationForkError('原消息已变化，请重新选择已完成的消息。');
  if (mode === 'continue' && (target.role !== 'assistant' || (!target.content.trim() && !target.attachments.length))) throw new ConversationForkError('请选择已完成的助手回复创建分支。');
  if (mode === 'rewrite' && (target.role !== 'user' || target.attachments.length || !target.content.trim())) throw new ConversationForkError('暂时仅支持改写不含附件的纯文字提问。');
  const draft = mode === 'rewrite' ? target.content : '';
  if (draft.length > 10_000) throw new ConversationForkError('原提问超过输入框的1万字符上限，请复制需要的部分到新对话。');
  const end = mode === 'rewrite' ? index : index + 1;
  if (end > MAX_FORK_MESSAGES) throw new ConversationForkError('分支最多保留前500条消息，请从较早的位置创建或另开新对话。');
  const assistant = conversation.assistant ? { name: conversation.assistant.name, instructions: conversation.assistant.instructions } : undefined;
  if ((assistant?.instructions.length ?? 0) > 20_000 || (assistant?.name.length ?? 0) > 60) throw new ConversationForkError('原助手指令过长，无法创建分支。');
  let characters = JSON.stringify({ draft, assistant }).length;
  let omitted = 0;
  let attachments = 0;
  const messages: AppMessage[] = [];
  for (let i = 0; i < end; i++) {
    const message = conversation.messages[i]!;
    if (message.status !== 'complete') { omitted++; continue; }
    // Bound the large fields before JSON allocation; then budget the exact serialized copy.
    if (message.content.length > MAX_FORK_CHARACTERS - characters || message.attachments.length > 100
      || message.attachments.some(file => (file.uri?.length ?? 0) > 16_384)
      || (message.knowledge?.sources.length ?? 0) > 6) throw new ConversationForkError('分支内容过大，请选择较早的消息或另开新对话。');
    const copy = cloneMessage(message);
    characters += JSON.stringify(copy).length;
    if (characters > MAX_FORK_CHARACTERS) throw new ConversationForkError('分支内容超过200万字符预算，请选择较早的消息或另开新对话。');
    messages.push(copy); attachments += copy.attachments.length;
  }
  return { messages, assistant, preview: { messages: messages.length, omitted, attachments, draft } satisfies ForkPreview };
}
export function previewConversationFork(conversation: Conversation, messageId: string, mode: ForkMode): ForkPreview {
  return prepare(conversation, messageId, mode).preview;
}
export function createConversationFork(conversation: Conversation, messageId: string, mode: ForkMode, id = createId, now = Date.now()): Conversation {
  const result = prepare(conversation, messageId, mode);
  let title = conversation.title.trim().slice(0, 175) || '新对话';
  if (/[\uD800-\uDBFF]$/.test(title)) title = title.slice(0, -1);
  return {
    id: id(), title: `${title} · ${mode === 'rewrite' ? '改写' : '分支'}`, createdAt: now, updatedAt: now,
    messages: result.messages.map(message => ({ ...message, id: id() })),
    ...(result.preview.draft ? { draft: result.preview.draft } : {}), ...(result.assistant ? { assistant: result.assistant } : {}),
  };
}
