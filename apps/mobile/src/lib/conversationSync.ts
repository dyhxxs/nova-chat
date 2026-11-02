import type { ConversationSyncItem } from '@nova-chat/protocol';
import type { Conversation } from '../types';

/**
 * Strips local-only references before a conversation leaves the device. Voice
 * recordings carry a local file URI and gateway attachments may carry an
 * optional local `uri`; neither is meaningful on another device, so they are
 * removed while the durable fields (ids, status, durations, gateway file refs)
 * are preserved.
 */
export function toSyncableConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      ...(message.voice ? { voice: { ...message.voice, localRecording: undefined } } : {}),
      attachments: message.attachments.map((attachment) => ({ ...attachment, uri: undefined })),
    })),
  };
}

export type ConversationSyncMerge = {
  /** The merged, newest-first conversation list. */
  conversations: Conversation[];
  /** Local conversations that are newer than the remote copy and must be pushed. */
  needsPush: Conversation[];
  /** Locally-deleted ids still active on the server; these need remote tombstones. */
  deleteIdsToPush: string[];
};

/**
 * Merges a full remote sync snapshot into the local list. Last-write-wins is
 * decided by each conversation's client `updatedAt`; ties keep the local copy.
 * Remote tombstones drop the local conversation; locally-deleted ids are never
 * resurrected and are reported back so the caller can push their tombstones.
 */
export function mergeRemoteConversations(
  local: Conversation[],
  locallyDeletedIds: string[],
  items: ConversationSyncItem[],
): ConversationSyncMerge {
  const remoteActive = new Map<string, Conversation>();
  const remoteDeleted = new Set<string>();
  for (const item of items) {
    if (item.deleted) {
      remoteDeleted.add(item.id);
      continue;
    }
    if (item.conversation && typeof item.conversation === 'object') {
      const conversation = item.conversation as Partial<Conversation>;
      if (typeof conversation.id === 'string' && conversation.id && typeof conversation.updatedAt === 'number') {
        remoteActive.set(conversation.id, conversation as Conversation);
      }
    }
  }

  const localById = new Map(local.map((conversation) => [conversation.id, conversation]));
  const locallyDeleted = new Set(locallyDeletedIds);
  const merged: Conversation[] = [];
  const needsPush: Conversation[] = [];

  for (const [id, localConversation] of localById) {
    if (remoteDeleted.has(id)) continue; // deleted on another device
    const remote = remoteActive.get(id);
    if (!remote) {
      merged.push(localConversation);
      needsPush.push(localConversation); // local-only: upload it
      continue;
    }
    if (remote.updatedAt > localConversation.updatedAt) {
      merged.push(remote);
    } else {
      merged.push(localConversation);
      if (localConversation.updatedAt > remote.updatedAt) needsPush.push(localConversation);
    }
  }
  for (const [id, remoteConversation] of remoteActive) {
    if (localById.has(id)) continue;
    if (locallyDeleted.has(id)) continue; // deleted locally before the remote write arrived
    merged.push(remoteConversation);
  }

  merged.sort((a, b) => b.updatedAt - a.updatedAt);
  const deleteIdsToPush = locallyDeletedIds.filter((id) => remoteActive.has(id));
  return { conversations: merged, needsPush, deleteIdsToPush };
}
