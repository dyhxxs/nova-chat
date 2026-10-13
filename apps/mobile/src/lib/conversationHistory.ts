import type { Conversation } from '../types';

export type HistoryFilter = 'active' | 'pinned' | 'archived' | 'all';
const normalized = (text: string) => text.normalize('NFKC').toLocaleLowerCase();
function searchText(conversation: Conversation): string {
  return normalized([conversation.title, ...conversation.messages.flatMap((message) => [
    message.content, message.model ?? '', message.requestedModel ?? '', ...message.attachments.map((attachment) => attachment.name),
  ])].join('\n'));
}
/** Bounded, local-only cache. Callers must replace conversations immutably, as the store does. */
export function createConversationSelector(maxCacheCharacters = 2_000_000) {
  const cache = new Map<Conversation, string>();
  let characters = 0;
  const limit = Math.max(0, Math.floor(Number.isFinite(maxCacheCharacters) ? maxCacheCharacters : 0));
  return (conversations: readonly Conversation[], query = '', filter: HistoryFilter = 'active'): Conversation[] => {
    // Drop removed/replaced/account-switched objects instead of retaining their private content.
    const current = new Set(conversations);
    for (const [entry, text] of cache) if (!current.has(entry)) { cache.delete(entry); characters -= text.length; }
    const words = normalized(query).trim().split(/\s+/).filter(Boolean);
    return conversations.filter((conversation) => {
      if (filter === 'active' && conversation.archived) return false;
      if (filter === 'archived' && !conversation.archived) return false;
      if (filter === 'pinned' && (!conversation.pinned || conversation.archived)) return false;
      if (!words.length) return true;
      let haystack = cache.get(conversation);
      if (haystack === undefined) {
        haystack = searchText(conversation);
        // Do not evict every entry during a too-large query (which would thrash).
        // Oversized/unbudgeted entries are searched without being retained.
        if (haystack.length <= limit - characters) { cache.set(conversation, haystack); characters += haystack.length; }
      }
      return words.every((word) => haystack.includes(word));
    }).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  };
}
export const selectConversations = createConversationSelector();

/** Row previews never normalize the entire last message or reverse-copy its history. */
export function conversationPreview(conversation: Conversation): string {
  for (let index = conversation.messages.length - 1; index >= 0; index--) {
    const message = conversation.messages[index]!;
    const content = message.content.trim();
    if (content) return content.slice(0, 280).replace(/\s+/g, ' ').trim();
    if (message.attachments.length) {
      const images = message.attachments.filter((attachment) => attachment.kind === 'image').length;
      const documents = message.attachments.length - images;
      return [images ? images + ' 张图片' : '', documents ? documents + ' 个文件' : ''].filter(Boolean).join('、');
    }
  }
  return '还没有消息';
}
