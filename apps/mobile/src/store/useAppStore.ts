import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { DEFAULT_MODEL_ID, type AttachmentRef, type GeneratedAttachment, type TokenUsage } from '@nova-chat/protocol';
import { normalizeServerUrl } from '../lib/connection';
import { createId } from '../lib/id';
import { titleFromMessage } from '../lib/title';
import type { AppMessage, AppSettings, AuthStatus, Conversation, UserProfile } from '../types';

// Conversation data must never live in one unscoped device-wide bucket.  v1
// had no account owner, so it is intentionally not eligible for restore after
// the isolation fix.  Losing legacy local history is safer than showing it to
// a different account.
const SETTINGS_STORAGE_KEY = '@nova-chat/settings/v1';
const ACCOUNT_STORAGE_PREFIX = '@nova-chat/account/v1/';
const LEGACY_STORAGE_KEY = '@nova-chat/state/v1';
const INTERIM_UNSCOPED_STORAGE_KEY = '@nova-chat/state/v2';
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
  version: 7;
  /** The account that owns the conversations in this snapshot. */
  userId?: string;
  conversations: Conversation[];
  activeConversationId: string;
  settings: AppSettings;
  deviceId: string;
};

type PersistedSettings = {
  version: 1;
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
  /** Owner of the currently loaded local conversation snapshot. */
  dataOwnerId?: string;
  hydrate: () => Promise<void>;
  restoreUserState: (user: UserProfile) => Promise<void>;
  newConversation: () => string;
  setActiveConversation: (id: string) => void;
  beginTurn: (content: string, attachments?: AttachmentRef[], targetConversationId?: string, requestedModel?: string) => { conversationId: string; assistantMessageId: string };
  bindAssistantGeneration: (conversationId: string, messageId: string, generation: { requestId: string; options: NonNullable<AppMessage['generationOptions']>; startedAt?: number }) => boolean;
  appendAssistantDelta: (conversationId: string, messageId: string, delta: string, requestId?: string) => void;
  replaceAssistantContent: (conversationId: string, messageId: string, content: string, requestId?: string) => void;
  completeAssistant: (conversationId: string, messageId: string, completion?: { requestId?: string; model?: string; usage?: TokenUsage; attachments?: GeneratedAttachment[] }) => void;
  failAssistant: (conversationId: string, messageId: string, message: string, retryable: boolean, requestId?: string) => void;
  cancelAssistant: (conversationId: string, messageId: string, requestId?: string) => void;
  prepareRegeneration: (conversationId: string, messageId: string) => boolean;
  renameConversation: (id: string, title: string) => boolean;
  deleteConversation: (id: string) => void;
  clearConversations: () => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  setSession: (token: string, user: UserProfile, serverUrl?: string) => Promise<void>;
  clearSession: () => Promise<void>;
  setAuthState: (status: AuthStatus, user?: UserProfile) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
};

let persistenceTimer: ReturnType<typeof setTimeout> | undefined;
let persistenceChain = Promise.resolve();
let sessionLoadGeneration = 0;
function accountStorageKey(userId: string, serverUrl: string) {
  return `${ACCOUNT_STORAGE_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(normalizeServerUrl(serverUrl))}`;
}

function settingsSnapshot(state: AppState): PersistedSettings {
  return { version: 1, settings: state.settings, deviceId: state.deviceId };
}

function serializable(state: AppState): PersistedState {
  return {
    version: 7,
    userId: state.dataOwnerId,
    conversations: state.conversations.slice(0, 100),
    activeConversationId: state.activeConversationId,
    settings: state.settings,
    deviceId: state.deviceId,
  };
}
function persistState(state: AppState) {
  // Conversations are written only to an account + gateway scoped key.  When
  // logged out, persist settings/device metadata only; never persist a
  // conversation in an unscoped bucket.
  const key = state.dataOwnerId ? accountStorageKey(state.dataOwnerId, state.settings.serverUrl) : SETTINGS_STORAGE_KEY;
  const payload = state.dataOwnerId ? serializable(state) : settingsSnapshot(state);
  // Writes are serialized so account switches cannot reorder snapshots.
  const snapshot = JSON.stringify(payload);
  persistenceChain = persistenceChain.catch(() => undefined).then(async () => {
    await AsyncStorage.setItem(key, snapshot);
    // Keep only connection/device bootstrap data globally so a restored token
    // can find its gateway before /v1/auth/me is called. This key never
    // contains conversations.
    if (state.dataOwnerId) {
      await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settingsSnapshot(state)));
    }
  });
  return persistenceChain;
}

function newLocalState(settings: AppSettings, deviceId = createId()) {
  const conversation = freshConversation();
  return {
    conversations: [conversation],
    activeConversationId: conversation.id,
    settings,
    deviceId,
  };
}

function normalizeSettings(persisted: Partial<AppSettings> | undefined, fallback: AppSettings): AppSettings {
  const merged = { ...defaultSettings, ...fallback, ...(persisted ?? {}) };
  return {
    ...merged,
    serverUrl: DEFAULT_GATEWAY_URL || fallback.serverUrl || merged.serverUrl || defaultSettings.serverUrl,
    reasoningEffort: normalizeReasoningEffort(merged.reasoningEffort),
  };
}

function restoreConversations(value: unknown) {
  const parsed = Array.isArray(value) ? value : [];
  const restored = parsed.filter((conversation): conversation is Conversation => Boolean(conversation && typeof conversation === 'object' && typeof (conversation as Conversation).id === 'string'))
    .map((conversation) => ({
      ...conversation,
      messages: (Array.isArray(conversation.messages) ? conversation.messages : []).map((message) => ({
        ...message,
        attachments: Array.isArray(message.attachments) ? message.attachments : [],
        ...(message.status === 'streaming' && !message.generationRequestId
          ? { status: 'error' as const, errorMessage: '上次生成被中断，可以点击重新生成。', retryable: true, completedAt: Date.now() }
          : {}),
      })),
    }));
  return restored.length ? restored : undefined;
}

async function readAccountState(userId: string, serverUrl: string, fallbackSettings: AppSettings, fallbackDeviceId: string) {
  const blank = newLocalState(normalizeSettings(undefined, fallbackSettings), fallbackDeviceId);
  try {
    const raw = await AsyncStorage.getItem(accountStorageKey(userId, serverUrl));
    if (!raw) return blank;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (parsed.version !== 7 || parsed.userId !== userId) return blank;
    const conversations = restoreConversations(parsed.conversations) ?? blank.conversations;
    const activeConversationId = conversations.some((item) => item.id === parsed.activeConversationId)
      ? parsed.activeConversationId as string
      : conversations[0]!.id;
    return {
      conversations,
      activeConversationId,
      settings: normalizeSettings(parsed.settings, fallbackSettings),
      deviceId: typeof parsed.deviceId === 'string' && parsed.deviceId.length >= 8 ? parsed.deviceId : fallbackDeviceId,
    };
  } catch {
    return blank;
  }
}

function readSettings(raw: string | null): { settings?: Partial<AppSettings>; deviceId?: string } {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedSettings> & Partial<PersistedState>;
    if (parsed.settings && typeof parsed.settings === 'object') {
      return { settings: parsed.settings, deviceId: parsed.deviceId };
    }
    // Legacy v1 stored settings at the top level.  Do not read its
    // conversations because there is no reliable account owner.
    return { settings: parsed as Partial<AppSettings>, deviceId: parsed.deviceId };
  } catch {
    return {};
  }
}

const initialLocalState = newLocalState(defaultSettings);

function schedulePersistence(state: AppState, immediate = false) {
  if (persistenceTimer) clearTimeout(persistenceTimer);
  const save = () => {
    persistenceTimer = undefined;
    void persistState(state).catch(() => undefined);
  };
  if (immediate) save();
  else persistenceTimer = setTimeout(save, 450);
}

export const useAppStore = create<AppState>((set, get) => ({
  hydrated: false,
  conversations: initialLocalState.conversations,
  activeConversationId: initialLocalState.activeConversationId,
  settings: defaultSettings,
  accessToken: '',
  deviceId: createId(),
  connectionStatus: 'unknown',
  authStatus: 'unknown',
  user: undefined,
  dataOwnerId: undefined,

  hydrate: async () => {
    try {
      const [settingsRaw, legacyRaw, interimRaw, token] = await Promise.all([
        AsyncStorage.getItem(SETTINGS_STORAGE_KEY),
        AsyncStorage.getItem(LEGACY_STORAGE_KEY),
        AsyncStorage.getItem(INTERIM_UNSCOPED_STORAGE_KEY),
        SecureStore.getItemAsync(TOKEN_KEY).catch(() => ''),
      ]);
      // Remove the legacy direct-provider key introduced by the old dual-mode client.
      try { await SecureStore.deleteItemAsync('nova-chat-direct-api-key'); } catch { /* Ignore unavailable secure storage. */ }
      // Restore only non-sensitive, non-conversation settings before the
      // token is validated. Account conversations are loaded later, after
      // /v1/auth/me confirms the exact user identity.
      const saved = readSettings(settingsRaw ?? legacyRaw ?? interimRaw);
      const settings = normalizeSettings(saved.settings, defaultSettings);
      const deviceId = typeof saved.deviceId === 'string' && saved.deviceId.length >= 8 ? saved.deviceId : createId();
      const blank = newLocalState(settings, deviceId);
      set({
        ...blank,
        accessToken: token ?? '',
        authStatus: token ? 'unknown' : 'unauthenticated',
        dataOwnerId: undefined,
        hydrated: true,
      });
      // Remove the old unscoped snapshot after attempting migration.  This is
      // best-effort and does not affect startup if SecureStore/AsyncStorage is
      // temporarily unavailable.
      try {
        await Promise.all([
          AsyncStorage.removeItem(LEGACY_STORAGE_KEY),
          AsyncStorage.removeItem(INTERIM_UNSCOPED_STORAGE_KEY),
        ]);
      } catch { /* Ignore storage implementations without removeItem. */ }
      if (!settingsRaw && (legacyRaw || interimRaw)) schedulePersistence(get(), true);
    } catch {
      const blank = newLocalState(defaultSettings);
      set({ ...blank, hydrated: true, authStatus: 'unauthenticated', dataOwnerId: undefined });
    }
  },

  restoreUserState: async (user) => {
    const generation = ++sessionLoadGeneration;
    const state = get();
    const restored = await readAccountState(user.id, state.settings.serverUrl, state.settings, state.deviceId);
    if (generation !== sessionLoadGeneration) return;
    set({
      ...restored,
      user,
      dataOwnerId: user.id,
      authStatus: 'authenticated',
    });
    await persistState(get()).catch(() => undefined);
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

  beginTurn: (content, attachments = [], targetConversationId, requestedModel) => {
    const now = Date.now();
    const assistantMessageId = createId();
    let conversationId = targetConversationId ?? get().activeConversationId;
    if (!get().conversations.some((item) => item.id === conversationId)) conversationId = get().newConversation();
    const cleaned = content.trim();
    const userMessage: AppMessage = { id: createId(), role: 'user', content: cleaned, attachments, createdAt: now, status: 'complete' };
    const assistantMessage: AppMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      attachments: [],
      createdAt: now + 1,
      status: 'streaming',
      requestedModel: requestedModel?.trim() || get().settings.model.trim() || DEFAULT_MODEL_ID,
    };
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

  bindAssistantGeneration: (conversationId, messageId, generation) => {
    const requestId = generation.requestId.trim();
    if (!requestId) return false;
    let bound = false;
    set((state) => ({ conversations: state.conversations.map((conversation) => conversation.id === conversationId ? {
      ...conversation,
      updatedAt: Date.now(),
      messages: conversation.messages.map((message) => {
        if (message.id !== messageId || message.role !== 'assistant' || message.status !== 'streaming') return message;
        bound = true;
        return {
          ...message,
          generationRequestId: requestId,
          generationOptions: generation.options,
          generationStartedAt: generation.startedAt ?? Date.now(),
          completedAt: undefined,
        };
      }),
    } : conversation) }));
    if (bound) schedulePersistence(get(), true);
    return bound;
  },

  appendAssistantDelta: (conversationId, messageId, delta, requestId) => {
    set((state) => ({ conversations: state.conversations.map((conversation) => conversation.id === conversationId ? {
      ...conversation,
      updatedAt: Date.now(),
      messages: conversation.messages.map((message) => message.id === messageId && message.status === 'streaming'
        && (!requestId || message.generationRequestId === requestId)
        ? { ...message, content: message.content + delta }
        : message),
    } : conversation) }));
    schedulePersistence(get());
  },

  replaceAssistantContent: (conversationId, messageId, content, requestId) => {
    set((state) => ({ conversations: state.conversations.map((conversation) => conversation.id === conversationId ? {
      ...conversation,
      updatedAt: Date.now(),
      messages: conversation.messages.map((message) => message.id === messageId && message.status === 'streaming'
        && (!requestId || message.generationRequestId === requestId)
        ? { ...message, content }
        : message),
    } : conversation) }));
    schedulePersistence(get());
  },

  completeAssistant: (conversationId, messageId, completion = {}) => {
    const model = completion.model?.trim() || undefined;
    set((state) => ({ conversations: state.conversations.map((conversation) => conversation.id === conversationId ? {
      ...conversation,
      updatedAt: Date.now(),
      messages: conversation.messages.map((message) => message.id === messageId && message.status === 'streaming'
        && (!completion.requestId || message.generationRequestId === completion.requestId)
        ? { ...message, status: 'complete', usage: completion.usage, attachments: completion.attachments ?? [], model, completedAt: Date.now() }
        : message),
    } : conversation) }));
    schedulePersistence(get(), true);
  },

  failAssistant: (conversationId, messageId, message, retryable, requestId) => {
    set((state) => ({ conversations: state.conversations.map((conversation) => conversation.id === conversationId ? {
      ...conversation,
      updatedAt: Date.now(),
      messages: conversation.messages.map((item) => item.id === messageId && item.status === 'streaming'
        && (!requestId || item.generationRequestId === requestId)
        ? { ...item, status: 'error', errorMessage: item.content ? `回复中断：${message}` : message, retryable, completedAt: Date.now() }
        : item),
    } : conversation) }));
    schedulePersistence(get(), true);
  },

  cancelAssistant: (conversationId, messageId, requestId) => {
    set((state) => ({ conversations: state.conversations.map((conversation) => conversation.id === conversationId ? {
      ...conversation,
      messages: conversation.messages.map((message) => message.id === messageId && message.status === 'streaming'
        && (!requestId || message.generationRequestId === requestId)
        ? { ...message, status: 'cancelled', errorMessage: undefined, completedAt: Date.now() }
        : message),
    } : conversation) }));
    schedulePersistence(get(), true);
  },

  prepareRegeneration: (conversationId, messageId) => {
    const conversation = get().conversations.find((item) => item.id === conversationId);
    const index = conversation?.messages.findIndex((item) => item.id === messageId) ?? -1;
    if (!conversation || index < 1 || conversation.messages[index]?.role !== 'assistant') return false;
    if (conversation.messages[index]?.status === 'streaming') return false;
    const requestedModel = get().settings.model.trim() || DEFAULT_MODEL_ID;
    set((state) => ({ conversations: state.conversations.map((item) => item.id === conversationId ? {
      ...item,
      updatedAt: Date.now(),
      messages: item.messages.slice(0, index + 1).map((message, messageIndex) => messageIndex === index ? {
        ...message,
        content: '',
        attachments: [],
        status: 'streaming' as const,
        errorMessage: undefined,
        retryable: undefined,
        usage: undefined,
        requestedModel,
        model: undefined,
        generationRequestId: undefined,
        generationOptions: undefined,
        generationStartedAt: undefined,
        completedAt: undefined,
      } : message),
    } : item) }));
    schedulePersistence(get(), true);
    return true;
  },

  renameConversation: (id, title) => {
    const cleaned = title.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!cleaned) return false;
    let renamed = false;
    set((state) => ({ conversations: state.conversations.map((conversation) => {
      if (conversation.id !== id) return conversation;
      renamed = true;
      return { ...conversation, title: cleaned, updatedAt: Date.now() };
    }).sort((a, b) => b.updatedAt - a.updatedAt) }));
    if (renamed) schedulePersistence(get(), true);
    return renamed;
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

  setSession: async (token, user, requestedServerUrl) => {
    const generation = ++sessionLoadGeneration;
    if (persistenceTimer) { clearTimeout(persistenceTimer); persistenceTimer = undefined; }
    const current = get();
    const serverUrl = requestedServerUrl ?? current.settings.serverUrl;
    const blank = newLocalState(
      { ...defaultSettings, serverUrl: DEFAULT_GATEWAY_URL || serverUrl },
      current.deviceId,
    );
    // Clear the visible state before loading the new account, then restore
    // only the snapshot whose owner matches the newly authenticated user.
    set({ ...blank, accessToken: token, user, authStatus: 'unknown', dataOwnerId: undefined });
    try { await SecureStore.setItemAsync(TOKEN_KEY, token); } catch { /* SecureStore is required on native builds. */ }
    const restored = await readAccountState(user.id, serverUrl, current.settings, current.deviceId);
    if (generation !== sessionLoadGeneration) return;
    set({ ...restored, accessToken: token, user, authStatus: 'authenticated', dataOwnerId: user.id });
    await persistState(get()).catch(() => undefined);
  },

  clearSession: async () => {
    ++sessionLoadGeneration;
    if (persistenceTimer) { clearTimeout(persistenceTimer); persistenceTimer = undefined; }
    const serverUrl = get().settings.serverUrl;
    const conversation = freshConversation();
    set({
      accessToken: '',
      user: undefined,
      authStatus: 'unauthenticated',
      connectionStatus: 'unknown',
      dataOwnerId: undefined,
      conversations: [conversation],
      activeConversationId: conversation.id,
      settings: { ...defaultSettings, serverUrl: DEFAULT_GATEWAY_URL || serverUrl },
    });
    try { await SecureStore.deleteItemAsync(TOKEN_KEY); } catch { /* Ignore unavailable secure storage in web previews. */ }
    await persistState(get()).catch(() => undefined);
  },

  setAuthState: (authStatus, user) => {
    if (authStatus === 'authenticated' && user && get().dataOwnerId !== user.id) {
      ++sessionLoadGeneration;
      if (persistenceTimer) { clearTimeout(persistenceTimer); persistenceTimer = undefined; }
      const serverUrl = get().settings.serverUrl;
      const conversation = freshConversation();
      set({
        conversations: [conversation],
        activeConversationId: conversation.id,
        settings: { ...defaultSettings, serverUrl: DEFAULT_GATEWAY_URL || serverUrl },
        dataOwnerId: user.id,
        authStatus,
        user,
      });
      schedulePersistence(get(), true);
      return;
    }
    set({ authStatus, user });
  },


  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
}));
