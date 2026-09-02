import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { DEFAULT_MODEL_ID, type AttachmentRef, type GeneratedAttachment, type TokenUsage } from '@nova-chat/protocol';
import { createId } from '../lib/id';
import { titleFromMessage } from '../lib/title';
import type { AppMessage, AppSettings, AuthStatus, Conversation, UserProfile } from '../types';

const STORAGE_KEY = '@nova-chat/state/v1';
const TOKEN_KEY = 'nova-chat-session-token';
const DEFAULT_GATEWAY_URL = process.env.EXPO_PUBLIC_GATEWAY_URL?.trim() ?? '';

const defaultSettings: AppSettings = {
  serverUrl: DEFAULT_GATEWAY_URL,
  model: DEFAULT_MODEL_ID,
  reasoningEffort: 'medium',
  verbosity: 'medium',
  instructions: '你是一个可靠、清晰、友善的 AI 助手。优先给出准确、可执行的回答；不确定时明确说明。',
  maxOutputTokens: 8192,
  webSearch: false,
  codeInterpreter: false,
};

function normalizeReasoningEffort(value: unknown): AppSettings['reasoningEffort'] {
  if (value === 'max') return 'xhigh';
  if (value === 'none' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') return value;
  return defaultSettings.reasoningEffort;
}

function freshConversation(now = Date.now()): Conversation {
  return { id: createId(), title: '新对话', createdAt: now, updatedAt: now, messages: [] };
}

type PersistedState = {
  version: 5;
  conversations: Conversation[];
  activeConversationId: string;
  settings: AppSettings;
  deviceId: string;
};

export type ConnectionStatus = 'unknown' | 'checking' | 'online' | 'offline';

type AppState = {
  hydrated: boolean;
  conversations: Conversation[];
  activeConversationId: string;
  settings: AppSettings;
  accessToken: string;
  deviceId: string;
  connectionStatus: ConnectionStatus;
  authStatus: AuthStatus;
  user?: UserProfile;
  hydrate: () => Promise<void>;
  newConversation: () => string;
  setActiveConversation: (id: string) => void;
  beginTurn: (content: string, attachments?: AttachmentRef[], targetConversationId?: string) => { conversationId: string; assistantMessageId: string };
  appendAssistantDelta: (conversationId: string, messageId: string, delta: string) => void;
  replaceAssistantContent: (conversationId: string, messageId: string, content: string) => void;
  completeAssistant: (conversationId: string, messageId: string, usage?: TokenUsage, attachments?: GeneratedAttachment[]) => void;
  failAssistant: (conversationId: string, messageId: string, message: string, retryable: boolean) => void;
  cancelAssistant: (conversationId: string, messageId: string) => void;
  prepareRegeneration: (conversationId: string, messageId: string) => boolean;
  deleteConversation: (id: string) => void;
  clearConversations: () => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  setSession: (token: string, user: UserProfile) => Promise<void>;
  clearSession: () => Promise<void>;
  setAuthState: (status: AuthStatus, user?: UserProfile) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
};

let persistenceTimer: ReturnType<typeof setTimeout> | undefined;
function serializable(state: AppState): PersistedState {
  return {
    version: 5,
    conversations: state.conversations.slice(0, 100),
    activeConversationId: state.activeConversationId,
    settings: state.settings,
    deviceId: state.deviceId,
  };
}
function schedulePersistence(state: AppState, immediate = false) {
  if (persistenceTimer) clearTimeout(persistenceTimer);
  const save = () => { void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(serializable(state))).catch(() => undefined); };
  if (immediate) save();
  else persistenceTimer = setTimeout(save, 450);
}

const initialConversation = freshConversation();

export const useAppStore = create<AppState>((set, get) => ({
  hydrated: false,
  conversations: [initialConversation],
  activeConversationId: initialConversation.id,
  settings: defaultSettings,
  accessToken: '',
  deviceId: createId(),
  connectionStatus: 'unknown',
  authStatus: 'unknown',
  user: undefined,

  hydrate: async () => {
    try {
      const [raw, token] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        SecureStore.getItemAsync(TOKEN_KEY).catch(() => ''),
      ]);
      // Remove the legacy direct-provider key introduced by the old dual-mode client.
      try { await SecureStore.deleteItemAsync('nova-chat-direct-api-key'); } catch { /* Ignore unavailable secure storage. */ }
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedState>;
        const restored = Array.isArray(parsed.conversations) ? parsed.conversations.map((conversation) => ({
          ...conversation,
          messages: (Array.isArray(conversation.messages) ? conversation.messages : []).map((message) => ({
            ...message,
            attachments: Array.isArray(message.attachments) ? message.attachments : [],
            ...(message.status === 'streaming'
              ? { status: 'error' as const, errorMessage: '上次生成被中断，可以点击重新生成。', retryable: true }
              : {}),
          })),
        })) : [];
        const conversations = restored.length ? restored : [freshConversation()];
        const activeConversationId = conversations.some((item) => item.id === parsed.activeConversationId)
          ? parsed.activeConversationId as string
          : conversations[0]!.id;
        set({
          conversations,
          activeConversationId,
          settings: {
            ...defaultSettings,
            ...(parsed.settings ?? {}),
            reasoningEffort: normalizeReasoningEffort(parsed.settings?.reasoningEffort ?? defaultSettings.reasoningEffort),
            // Legacy persisted direct mode is intentionally ignored: all requests use Gateway.
            serverUrl: DEFAULT_GATEWAY_URL || (typeof parsed.settings?.serverUrl === 'string' ? parsed.settings.serverUrl : defaultSettings.serverUrl),
          },
          deviceId: typeof parsed.deviceId === 'string' && parsed.deviceId.length >= 8 ? parsed.deviceId : createId(),
          accessToken: token ?? '',
          authStatus: token ? 'unknown' : 'unauthenticated',
          hydrated: true,
        });
      } else {
        set({ accessToken: token ?? '', authStatus: token ? 'unknown' : 'unauthenticated', hydrated: true });
        schedulePersistence(get(), true);
      }
    } catch {
      set({ hydrated: true, authStatus: 'unauthenticated' });
    }
  },

  newConversation: () => {
    const conversation = freshConversation();
    set((state) => ({ conversations: [conversation, ...state.conversations], activeConversationId: conversation.id }));
    schedulePersistence(get(), true);
    return conversation.id;
  },

  setActiveConversation: (id) => {
    if (!get().conversations.some((item) => item.id === id)) return;
    set({ activeConversationId: id });
    schedulePersistence(get());
  },

  beginTurn: (content, attachments = []) => {
    const now = Date.now();
    const assistantMessageId = createId();
    let conversationId = get().activeConversationId;
    if (!get().conversations.some((item) => item.id === conversationId)) conversationId = get().newConversation();
    const cleaned = content.trim();
    const userMessage: AppMessage = { id: createId(), role: 'user', content: cleaned, attachments, createdAt: now, status: 'complete' };
    const assistantMessage: AppMessage = { id: assistantMessageId, role: 'assistant', content: '', attachments: [], createdAt: now + 1, status: 'streaming' };
    set((state) => ({
      conversations: state.conversations.map((conversation) => conversation.id === conversationId ? {
        ...conversation,
        title: conversation.messages.length === 0 ? titleFromMessage(cleaned || attachments[0]?.name || '附件对话') : conversation.title,
        updatedAt: now,
        messages: [...conversation.messages, userMessage, assistantMessage],
      } : conversation).sort((a, b) => b.updatedAt - a.updatedAt),
    }));
    schedulePersistence(get(), true);
    return { conversationId, assistantMessageId };
  },

  appendAssistantDelta: (conversationId, messageId, delta) => {
    set((state) => ({ conversations: state.conversations.map((conversation) => conversation.id === conversationId ? {
      ...conversation,
      updatedAt: Date.now(),
      messages: conversation.messages.map((message) => message.id === messageId && message.status === 'streaming'
        ? { ...message, content: message.content + delta }
        : message),
    } : conversation) }));
    schedulePersistence(get());
  },

  replaceAssistantContent: (conversationId, messageId, content) => {
    set((state) => ({ conversations: state.conversations.map((conversation) => conversation.id === conversationId ? {
      ...conversation,
      updatedAt: Date.now(),
      messages: conversation.messages.map((message) => message.id === messageId && message.status === 'streaming'
        ? { ...message, content }
        : message),
    } : conversation) }));
    schedulePersistence(get());
  },

  completeAssistant: (conversationId, messageId, usage, attachments = []) => {
    set((state) => ({ conversations: state.conversations.map((conversation) => conversation.id === conversationId ? {
      ...conversation,
      updatedAt: Date.now(),
      messages: conversation.messages.map((message) => message.id === messageId && message.status === 'streaming'
        ? { ...message, status: 'complete', usage, attachments }
        : message),
    } : conversation) }));
    schedulePersistence(get(), true);
  },

  failAssistant: (conversationId, messageId, message, retryable) => {
    set((state) => ({ conversations: state.conversations.map((conversation) => conversation.id === conversationId ? {
      ...conversation,
      updatedAt: Date.now(),
      messages: conversation.messages.map((item) => item.id === messageId && item.status === 'streaming'
        ? { ...item, status: 'error', errorMessage: item.content ? `回复中断：${message}` : message, retryable }
        : item),
    } : conversation) }));
    schedulePersistence(get(), true);
  },

  cancelAssistant: (conversationId, messageId) => {
    set((state) => ({ conversations: state.conversations.map((conversation) => conversation.id === conversationId ? {
      ...conversation,
      messages: conversation.messages.map((message) => message.id === messageId && message.status === 'streaming'
        ? { ...message, status: 'cancelled', errorMessage: undefined }
        : message),
    } : conversation) }));
    schedulePersistence(get(), true);
  },

  prepareRegeneration: (conversationId, messageId) => {
    const conversation = get().conversations.find((item) => item.id === conversationId);
    const index = conversation?.messages.findIndex((item) => item.id === messageId) ?? -1;
    if (!conversation || index < 1 || conversation.messages[index]?.role !== 'assistant') return false;
    set((state) => ({ conversations: state.conversations.map((item) => item.id === conversationId ? {
      ...item,
      updatedAt: Date.now(),
      messages: item.messages.slice(0, index + 1).map((message, messageIndex) => messageIndex === index ? {
        ...message, content: '', attachments: [], status: 'streaming' as const, errorMessage: undefined, retryable: undefined, usage: undefined,
      } : message),
    } : item) }));
    schedulePersistence(get(), true);
    return true;
  },

  deleteConversation: (id) => {
    let conversations = get().conversations.filter((item) => item.id !== id);
    if (!conversations.length) conversations = [freshConversation()];
    const activeConversationId = get().activeConversationId === id ? conversations[0]!.id : get().activeConversationId;
    set({ conversations, activeConversationId });
    schedulePersistence(get(), true);
  },

  clearConversations: () => {
    const conversation = freshConversation();
    set({ conversations: [conversation], activeConversationId: conversation.id });
    schedulePersistence(get(), true);
  },

  updateSettings: (patch) => {
    const normalizedPatch: Partial<AppSettings> = patch.reasoningEffort === 'max'
      ? { ...patch, reasoningEffort: 'xhigh' }
      : patch;
    set((state) => ({ settings: { ...state.settings, ...normalizedPatch } }));
    schedulePersistence(get(), true);
  },

  setSession: async (token, user) => {
    set({ accessToken: token, user, authStatus: 'authenticated' });
    try { await SecureStore.setItemAsync(TOKEN_KEY, token); } catch { /* SecureStore is required on native builds. */ }
  },

  clearSession: async () => {
    set({ accessToken: '', user: undefined, authStatus: 'unauthenticated', connectionStatus: 'unknown' });
    try { await SecureStore.deleteItemAsync(TOKEN_KEY); } catch { /* Ignore unavailable secure storage in web previews. */ }
  },

  setAuthState: (authStatus, user) => set({ authStatus, user }),


  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
}));
