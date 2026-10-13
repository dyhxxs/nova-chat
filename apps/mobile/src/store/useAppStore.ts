import { ConversationForkError, createConversationFork, isForkSelectionCurrent, MAX_FORK_CONVERSATIONS, type ForkSelection } from '../lib/conversationFork';
import { knowledgeDraftInputSchema, type KnowledgeDraft, type KnowledgeDraftInput } from '../lib/knowledgeDraft';
import { retainedArchiveBytes, type ArchiveCleanupPlan, type StorageOverview } from '../lib/storageMaintenance';
import { accountScope } from '../lib/accountScope';
import { mergeAssistantBackup, parseAssistantBackup } from '../lib/assistantBackup';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { credentialStorage } from '../services/credentialStorage';
import { CredentialStorageError, type CredentialOperation } from '../lib/credentialVault';
import { snapshotStorage } from '../services/snapshotStorage';
import { create } from 'zustand';
import { DEFAULT_MODEL_ID, type AttachmentRef, type GeneratedAttachment, type TokenUsage, type KnowledgeResult } from '@nova-chat/protocol';
import { normalizeServerUrl } from '../lib/connection';
import { resolveStartupGateway } from '../lib/startupGateway';
import { createId } from '../lib/id';
import { selectGatewayModel } from '../lib/modelSelection';
import { restoreLocalRecords } from '../lib/localSnapshot';
import { assistantPresetSchema, type AssistantPreset } from '../lib/assistantPresets';
import { titleFromMessage } from '../lib/title';
import { mergeConversationBackup, parseConversationBackup } from '../lib/conversationBackup';
import type { AppMessage, AppSettings, AuthStatus, Conversation, UserProfile } from '../types';

// Conversation data must never live in one unscoped device-wide bucket.  v1
// had no account owner, so it is intentionally not eligible for restore after
// the isolation fix.  Losing legacy local history is safer than showing it to
// a different account.
const SETTINGS_STORAGE_KEY = '@nova-chat/settings/v1';
const ACCOUNT_STORAGE_PREFIX = '@nova-chat/account/v1/';
const LEGACY_STORAGE_KEY = '@nova-chat/state/v1';
const INTERIM_UNSCOPED_STORAGE_KEY = '@nova-chat/state/v2';
const DEFAULT_GATEWAY_URL = process.env.EXPO_PUBLIC_GATEWAY_URL?.trim() ?? '';

const defaultSettings: AppSettings = {
  serverUrl: DEFAULT_GATEWAY_URL,
  model: DEFAULT_MODEL_ID,
  reasoningEffort: 'medium',
  verbosity: 'medium',
  instructions: '你是一个可靠、清晰、友善的 AI 助手。优先给出准确、可执行的回答；不确定时明确说明。',
  maxOutputTokens: 8192,
  autoTools: true,
  knowledgeBase: false,
  webSearch: false,
  codeInterpreter: false,
};

function normalizeReasoningEffort(value: unknown): AppSettings['reasoningEffort'] {
  if (value === 'max') return 'xhigh';
  if (value === 'none' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') return value;
  return defaultSettings.reasoningEffort;
}

function freshConversation(now = Date.now(), companion?: { id: string; name: string }): Conversation {
  return {
    id: createId(),
    title: companion?.name ? `${companion.name} 的对话` : '新对话',
    createdAt: now,
    updatedAt: now,
    messages: [],
    ...(companion ? { kind: 'companion' as const, companionId: companion.id, companionName: companion.name } : {}),
  };
}

type PersistedState = {
  version: 7;
  assistantPresets?: AssistantPreset[];
  knowledgeDraft?: KnowledgeDraft;
  /** The account that owns the conversations in this snapshot. */
  userId?: string;
  conversations: Conversation[];
  activeConversationId: string;
  settings: AppSettings;
  deviceId: string;
};

type PersistedSettings = {
  version: 1;
  settings: Pick<AppSettings, 'serverUrl'>;
  deviceId: string;
};

export type ConnectionStatus = 'unknown' | 'checking' | 'online' | 'offline';

type AppState = {
  hydrated: boolean;
  gatewayChanged: boolean;
  assistantPresets: AssistantPreset[];
  knowledgeDraft?: KnowledgeDraft;
  knowledgeDraftSavedRevision?: string;
  setKnowledgeDraft: (input: KnowledgeDraftInput, expectedScope: string, expectedRevision?: string) => boolean;
  patchKnowledgeDraft: (patch: { title?: string; text?: string }, expectedScope: string, editId: string) => boolean;
  clearKnowledgeDraft: (expectedScope: string, expectedRevision: string) => boolean;
  storageReadBlocked?: boolean;
  recoveryNotice?: string;
  exportRecoverySnapshot: (source?: 'recovery' | 'migration' | 'recoveryMigration') => Promise<string | null>;
  getStorageOverview: () => Promise<StorageOverview>;
  prepareArchiveCleanup: () => Promise<ArchiveCleanupPlan>;
  saveAssistantPreset: (input: Omit<AssistantPreset, 'id' | 'updatedAt'>, id?: string) => string;
  deleteAssistantPreset: (id: string) => void;
  importAssistantBackup: (json: string, expectedScope: string) => { imported: number; skipped: number };
  newAssistantConversation: (preset: AssistantPreset) => string;
  setConversationDraft: (id: string, draft: string) => void;
  clearConversationDraft: (id: string, expectedDraft: string) => void;
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
  dataOwnerServerUrl?: string;
  persistenceError?: string;
  credentialError?: string;
  credentialOperation?: CredentialOperation;
  retryCredentialPersistence: () => Promise<void>;
  flushPersistence: () => Promise<void>;
  hydrate: () => Promise<void>;
  restoreUserState: (user: UserProfile, catalog?: { models: string[]; defaultModel: string }) => Promise<void>;
  forkConversation: (selection: ForkSelection) => string;
  newConversation: () => string;
  newCompanionConversation: (companionId: string, companionName: string) => string;
  setActiveConversation: (id: string) => void;
  beginTurn: (content: string, attachments?: AttachmentRef[], targetConversationId?: string, requestedModel?: string) => { conversationId: string; assistantMessageId: string };
  bindAssistantGeneration: (conversationId: string, messageId: string, generation: { requestId: string; options: NonNullable<AppMessage['generationOptions']>; startedAt?: number }) => boolean;
  appendAssistantDelta: (conversationId: string, messageId: string, delta: string, requestId?: string) => void;
  replaceAssistantContent: (conversationId: string, messageId: string, content: string, requestId?: string) => void;
  completeAssistant: (conversationId: string, messageId: string, completion?: { requestId?: string; model?: string; usage?: TokenUsage; attachments?: GeneratedAttachment[]; knowledge?: KnowledgeResult }) => void;
  failAssistant: (conversationId: string, messageId: string, message: string, retryable: boolean, requestId?: string, errorCode?: string) => void;
  cancelAssistant: (conversationId: string, messageId: string, requestId?: string) => void;
  prepareRegeneration: (conversationId: string, messageId: string) => boolean;
  renameConversation: (id: string, title: string) => boolean;
  toggleConversationPinned: (id: string) => void;
  toggleConversationArchived: (id: string) => boolean;
  toggleMessageStarred: (conversationId: string, messageId: string) => boolean;
  importBackup: (json: string) => { imported: number; skipped: number };
  deleteConversation: (id: string) => void;
  clearConversations: () => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  setSession: (token: string, user: UserProfile, serverUrl?: string) => Promise<void>;
  clearSession: (nextServerUrl?: string) => Promise<void>;
  setAuthState: (status: AuthStatus, user?: UserProfile) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
};

let persistenceTimer: ReturnType<typeof setTimeout> | undefined;
let persistenceChain = Promise.resolve();
let sessionLoadGeneration = 0;
let tokenPersistenceChain = Promise.resolve();
function persistToken(token: string, serverUrl: string, generation: number) {
  tokenPersistenceChain = tokenPersistenceChain.catch(() => undefined).then(async () => {
    try {
      if (token) await credentialStorage.save(token, serverUrl);
      else await credentialStorage.clear();
      if (generation === sessionLoadGeneration) useAppStore.setState({ credentialError: undefined, credentialOperation: undefined });
    } catch (error) {
      if (generation === sessionLoadGeneration) useAppStore.setState({
        credentialError: error instanceof CredentialStorageError ? error.message : '凭据存储失败，请重试。',
        credentialOperation: token ? 'write' : 'delete',
      });
      throw error;
    }
  });
  return tokenPersistenceChain;
}
function accountStorageKey(userId: string, serverUrl: string) {
  return `${ACCOUNT_STORAGE_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(normalizeServerUrl(serverUrl))}`;
}

function settingsSnapshot(state: AppState): PersistedSettings {
  return { version: 1, settings: { serverUrl: state.settings.serverUrl }, deviceId: state.deviceId };
}

function serializable(state: AppState): PersistedState {
  return {
    version: 7,
    assistantPresets: state.assistantPresets,
    knowledgeDraft: state.knowledgeDraft,
    userId: state.dataOwnerId,
    conversations: state.conversations,
    activeConversationId: state.activeConversationId,
    settings: state.settings,
    deviceId: state.deviceId,
  };
}
function persistState(state: AppState) {
  // Conversations are written only to an account + gateway scoped key.  When
  // logged out, persist settings/device metadata only; never persist a
  // conversation in an unscoped bucket.
  const key = state.dataOwnerId ? accountStorageKey(state.dataOwnerId, state.dataOwnerServerUrl ?? state.settings.serverUrl) : SETTINGS_STORAGE_KEY;
  const payload = state.dataOwnerId ? serializable(state) : settingsSnapshot(state);
  // Writes are serialized so account switches cannot reorder snapshots.
  const snapshot = JSON.stringify(payload);
  persistenceChain = persistenceChain.catch(() => undefined).then(async () => {
    if (state.dataOwnerId && state.storageReadBlocked) throw new Error('为保护尚未读取的历史，本次不会覆盖本地数据。请先导出当前对话，再退出重登以重试读取。');
    await (state.dataOwnerId ? snapshotStorage : AsyncStorage).setItem(key, snapshot);
    // Keep only connection/device bootstrap data globally so a restored token
    // can find its gateway before /v1/auth/me is called. This key never
    // contains conversations.
    if (state.dataOwnerId) {
      await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settingsSnapshot(state)));
    }
  });
  void persistenceChain.then(() => {
    if (useAppStore.getState().dataOwnerId === state.dataOwnerId && useAppStore.getState().dataOwnerServerUrl === state.dataOwnerServerUrl) useAppStore.setState({ persistenceError: undefined, knowledgeDraftSavedRevision: state.knowledgeDraft?.revision });
  }, (error: unknown) => {
    if (useAppStore.getState().dataOwnerId !== state.dataOwnerId || useAppStore.getState().dataOwnerServerUrl !== state.dataOwnerServerUrl) return;
    useAppStore.setState({ persistenceError: state.storageReadBlocked && error instanceof Error ? error.message : '本地保存失败。请释放设备存储空间后重试，并及时导出备份；退出或关闭应用可能丢失未保存内容。' });
  });
  return persistenceChain;
}

function newLocalState(settings: AppSettings, deviceId = createId()) {
  const conversation = freshConversation();
  return {
    assistantPresets: [] as AssistantPreset[],
    knowledgeDraft: undefined as KnowledgeDraft | undefined,
    knowledgeDraftSavedRevision: undefined as string | undefined,
    storageReadBlocked: false,
    recoveryNotice: undefined as string | undefined,
    persistenceError: undefined as string | undefined,
    conversations: [conversation],
    activeConversationId: conversation.id,
    settings,
    deviceId,
  };
}

function normalizeSettings(persisted: Partial<AppSettings> | undefined, fallback: AppSettings): AppSettings {
  const candidate = persisted && typeof persisted === 'object' ? persisted : {};
  const merged = { ...defaultSettings, ...fallback, knowledgeBase: false };
  if (typeof candidate.serverUrl === 'string') merged.serverUrl = candidate.serverUrl;
  if (typeof candidate.model === 'string' && candidate.model.trim()) merged.model = candidate.model.slice(0, 100);
  if (typeof candidate.instructions === 'string') merged.instructions = candidate.instructions.slice(0, 20_000);
  if (candidate.verbosity === 'low' || candidate.verbosity === 'medium' || candidate.verbosity === 'high') merged.verbosity = candidate.verbosity;
  if (typeof candidate.autoTools === 'boolean') merged.autoTools = candidate.autoTools;
  if (typeof candidate.webSearch === 'boolean') merged.webSearch = candidate.webSearch;
  if (typeof candidate.codeInterpreter === 'boolean') merged.codeInterpreter = candidate.codeInterpreter;
  if (typeof candidate.maxOutputTokens === 'number' && Number.isFinite(candidate.maxOutputTokens)) merged.maxOutputTokens = Math.max(256, Math.min(131_072, Math.floor(candidate.maxOutputTokens)));
  return { ...merged, reasoningEffort: normalizeReasoningEffort(candidate.reasoningEffort ?? merged.reasoningEffort) };
}

async function readAccountState(userId: string, serverUrl: string, fallbackSettings: AppSettings, fallbackDeviceId: string) {
  const blank = newLocalState(normalizeSettings(undefined, fallbackSettings), fallbackDeviceId);
  const key = accountStorageKey(userId, serverUrl);
  const preserve = async (raw: string) => {
    const previous = await snapshotStorage.getItem(`${key}/recovery`);
    if (previous && previous !== raw) throw new Error('已有待恢复副本');
    await snapshotStorage.setItem(`${key}/recovery`, raw);
  };
  try {
    const raw = await snapshotStorage.getItem(key);
    if (!raw) return blank;
    let parsed: Partial<PersistedState>;
    try { parsed = JSON.parse(raw) as Partial<PersistedState>; } catch {
      await preserve(raw);
      return { ...blank, recoveryNotice: '本地快照无法解析，原始数据已保留为恢复副本。请在数据与备份中导出恢复副本；不要卸载应用。' };
    }
    if (!parsed || parsed.version !== 7 || parsed.userId !== userId) {
      return { ...blank, storageReadBlocked: true, recoveryNotice: '本地数据版本或归属不匹配。为保护原始数据，已停止覆盖保存。请先导出恢复副本，并联系维护者检查。' };
    }
    const restored = restoreLocalRecords(parsed.conversations, parsed.assistantPresets, parsed.knowledgeDraft);
    if (restored.repaired) await preserve(raw);
    const conversations = restored.conversations.length ? restored.conversations : blank.conversations;
    return {
      ...blank, conversations, assistantPresets: restored.assistantPresets,
      knowledgeDraft: restored.knowledgeDraft, knowledgeDraftSavedRevision: restored.knowledgeDraft?.revision,
      activeConversationId: conversations.some((item) => item.id === parsed.activeConversationId) ? parsed.activeConversationId! : conversations[0]!.id,
      settings: { ...normalizeSettings(parsed.settings, fallbackSettings), serverUrl },
      deviceId: typeof parsed.deviceId === 'string' && parsed.deviceId.length >= 8 ? parsed.deviceId : fallbackDeviceId,
      recoveryNotice: restored.repaired ? '检测到损坏的本地记录。已恢复可读取的对话，并保留未经修改的恢复副本；可在数据与备份中导出交给维护者检查。' : undefined,
    };
  } catch {
    return { ...blank, storageReadBlocked: true, recoveryNotice: '读取或保护本地历史失败，尚未覆盖原始数据。请先导出当前新建的对话，再退出重登重试；不要卸载应用。' };
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
  gatewayChanged: false,
  assistantPresets: [],
  conversations: initialLocalState.conversations,
  activeConversationId: initialLocalState.activeConversationId,
  settings: defaultSettings,
  accessToken: '',
  deviceId: createId(),
  connectionStatus: 'unknown',
  authStatus: 'unknown',
  user: undefined,
  dataOwnerId: undefined,

  getStorageOverview: async () => {
    const state = get();
    if (!state.dataOwnerId || state.authStatus !== 'authenticated') throw new Error('请先登录。');
    const scope = accountScope(state); const generation = sessionLoadGeneration;
    const info = await snapshotStorage.getStorageOverview(accountStorageKey(state.dataOwnerId, state.dataOwnerServerUrl ?? state.settings.serverUrl));
    if (scope !== accountScope(get()) || generation !== sessionLoadGeneration || get().authStatus !== 'authenticated') throw new Error('账号已切换，请重新操作。');
    return info;
  },
  prepareArchiveCleanup: async () => {
    const state = get();
    if (!state.dataOwnerId || state.authStatus !== 'authenticated') throw new Error('请先登录。');
    if (state.storageReadBlocked) throw new Error('历史读取仍被保护性阻止，不能删除恢复档案。');
    const scope = accountScope(state); const generation = sessionLoadGeneration;
    const isCurrent = () => scope === accountScope(get()) && generation === sessionLoadGeneration && get().authStatus === 'authenticated' && !get().storageReadBlocked;
    const key = accountStorageKey(state.dataOwnerId, state.dataOwnerServerUrl ?? state.settings.serverUrl);
    // A cleanup preview is never a substitute for saving the current in-memory data.
    await get().flushPersistence();
    if (!isCurrent()) throw new Error('账号或读取状态已变化，请重新预览。');
    const info = await snapshotStorage.getStorageOverview(key);
    if (!isCurrent()) throw new Error('账号或读取状态已变化，请重新预览。');
    if (!info.cleanupSupported) throw new Error('当前平台不支持原子档案清理。');
    if (!retainedArchiveBytes(info)) throw new Error('当前账号没有可清理的保留档案。');
    let used = false;
    return { overview: info, confirm: async () => {
      if (used) throw new Error('此确认已使用，请重新预览。');
      used = true;
      if (!isCurrent()) throw new Error('账号或读取状态已变化，请重新预览。');
      // A preview may remain open while new drafts/imports arrive. Never clear
      // retained originals if that newer state cannot be persisted now.
      await get().flushPersistence();
      if (!isCurrent()) throw new Error('账号或读取状态已变化，请重新预览。');
      const result = await snapshotStorage.clearArchives(key, info.archiveRevision, isCurrent);
      if (isCurrent()) set({ recoveryNotice: undefined });
      return result;
    } };
  },

  exportRecoverySnapshot: async (source = 'recovery') => {
    const state = get();
    if (!state.dataOwnerId || state.authStatus !== 'authenticated') throw new Error('请先登录。');
    const key = accountStorageKey(state.dataOwnerId, state.dataOwnerServerUrl ?? state.settings.serverUrl);
    if (source === 'recoveryMigration') await snapshotStorage.getStorageOverview(key);
    const raw = source === 'migration' || source === 'recoveryMigration'
      ? await snapshotStorage.getLegacyArchive(source === 'migration' ? key : `${key}/recovery`)
      : state.storageReadBlocked ? await snapshotStorage.getItem(key) : await snapshotStorage.getItem(`${key}/recovery`);
    if (get().dataOwnerId !== state.dataOwnerId || get().accessToken !== state.accessToken || get().dataOwnerServerUrl !== state.dataOwnerServerUrl) throw new Error('账号已切换，请重新操作。');
    if (raw) {
      let owner: unknown;
      try { owner = (JSON.parse(raw) as { userId?: unknown } | null)?.userId; } catch { /* A corrupt account-scoped snapshot may not be parseable. */ }
      if (owner !== undefined && owner !== state.dataOwnerId) throw new Error('恢复副本归属不匹配，拒绝导出。');
    }
    return raw;
  },

  setKnowledgeDraft: (input, expectedScope, expectedRevision) => {
    const state = get();
    if (state.authStatus !== 'authenticated' || !state.dataOwnerId || accountScope(state) !== expectedScope || state.knowledgeDraft?.revision !== expectedRevision) return false;
    const parsed = knowledgeDraftInputSchema.safeParse(input);
    if (!parsed.success) return false;
    set({ knowledgeDraft: { ...parsed.data, editId: state.knowledgeDraft?.editId ?? createId(), revision: createId(), editedAt: Date.now() } });
    schedulePersistence(get());
    return true;
  },
  patchKnowledgeDraft: (patch, expectedScope, editId) => {
    const draft = get().knowledgeDraft;
    if (!draft || draft.editId !== editId) return false;
    // Merge into the latest state: two native input events can precede a React render.
    return get().setKnowledgeDraft({ ...draft, ...patch }, expectedScope, draft.revision);
  },
  clearKnowledgeDraft: (expectedScope, expectedRevision) => {
    const state = get();
    if (state.authStatus !== 'authenticated' || !state.dataOwnerId || accountScope(state) !== expectedScope || state.knowledgeDraft?.revision !== expectedRevision) return false;
    set({ knowledgeDraft: undefined });
    schedulePersistence(get(), true);
    return true;
  },
  setConversationDraft: (id, draft) => {
    if (get().authStatus !== 'authenticated') return;
    set((state) => ({ conversations: state.conversations.map((item) => item.id === id ? { ...item, draft: draft.slice(0, 10_000) } : item) }));
    schedulePersistence(get());
  },
  clearConversationDraft: (id, expectedDraft) => {
    if (get().conversations.find((item) => item.id === id)?.draft !== expectedDraft) return;
    get().setConversationDraft(id, '');
  },
  saveAssistantPreset: (input, id) => {
    if (get().authStatus !== 'authenticated') throw new Error('请先登录。');
    if (id && !get().assistantPresets.some((item) => item.id === id)) throw new Error('助手已被删除，请重新创建。');
    if (!id && get().assistantPresets.length >= 100) throw new Error('最多保留 100 个自定义助手，请先删除不再使用的助手。');
    const preset = assistantPresetSchema.parse({ name: input.name, description: input.description, instructions: input.instructions, starter: input.starter, importSourceId: id ? get().assistantPresets.find((item) => item.id === id)?.importSourceId : undefined, id: id ?? createId(), updatedAt: Date.now() });
    set((state) => ({ assistantPresets: [preset, ...state.assistantPresets.filter((item) => item.id !== preset.id)] }));
    schedulePersistence(get(), true);
    return preset.id;
  },
  importAssistantBackup: (json, expectedScope) => {
    const state = get();
    if (state.authStatus !== 'authenticated' || !state.dataOwnerId) throw new Error('请先登录再导入助手。');
    if (accountScope(state) !== expectedScope) throw new Error('账号已切换，请重新选择备份。');
    const result = mergeAssistantBackup(state.assistantPresets, parseAssistantBackup(json));
    set({ assistantPresets: result.presets });
    schedulePersistence(get(), true);
    return { imported: result.imported, skipped: result.skipped };
  },
  deleteAssistantPreset: (id) => {
    set((state) => ({ assistantPresets: state.assistantPresets.filter((item) => item.id !== id) }));
    schedulePersistence(get(), true);
  },
  newAssistantConversation: (input) => {
    if (get().authStatus !== 'authenticated') throw new Error('请先登录。');
    const preset = assistantPresetSchema.parse(input);
    const conversation = { ...freshConversation(), title: preset.name, assistant: { name: preset.name, instructions: preset.instructions }, draft: preset.starter };
    set((state) => ({ conversations: [conversation, ...state.conversations], activeConversationId: conversation.id }));
    schedulePersistence(get(), true);
    return conversation.id;
  },

  flushPersistence: async () => {
    if (persistenceTimer) { clearTimeout(persistenceTimer); persistenceTimer = undefined; }
    await persistState(get());
    await tokenPersistenceChain;
  },

  retryCredentialPersistence: async () => {
    const state = get();
    if (state.credentialOperation === 'read' && !state.accessToken) { await state.hydrate(); return; }
    await persistToken(state.accessToken, state.settings.serverUrl, sessionLoadGeneration);
  },

  hydrate: async () => {
    const generation = ++sessionLoadGeneration;
    try {
      const [settingsRaw, legacyRaw, interimRaw, credential] = await Promise.all([
        AsyncStorage.getItem(SETTINGS_STORAGE_KEY),
        AsyncStorage.getItem(LEGACY_STORAGE_KEY),
        AsyncStorage.getItem(INTERIM_UNSCOPED_STORAGE_KEY),
        credentialStorage.load().then((value) => ({ ...value, error: undefined as CredentialStorageError | undefined }), (error: unknown) => ({ token: '', serverUrl: undefined, error: error instanceof CredentialStorageError ? error : new CredentialStorageError('read') })),
      ]);
      if (generation !== sessionLoadGeneration) return;
      // Remove the legacy direct-provider key introduced by the old dual-mode client.
      try { await SecureStore.deleteItemAsync('nova-chat-direct-api-key'); } catch { /* Ignore unavailable secure storage. */ }
      // Restore only non-sensitive, non-conversation settings before the
      // token is validated. Account conversations are loaded later, after
      // /v1/auth/me confirms the exact user identity.
      const saved = readSettings(settingsRaw ?? legacyRaw ?? interimRaw);
      const gateway = resolveStartupGateway({
        builtInUrl: DEFAULT_GATEWAY_URL,
        savedUrl: saved.settings?.serverUrl,
        credentialUrl: credential.serverUrl,
        token: credential.token,
      });
      const token = gateway.accessToken;
      const settings = normalizeSettings({ serverUrl: gateway.serverUrl }, defaultSettings);
      const deviceId = typeof saved.deviceId === 'string' && saved.deviceId.length >= 8 ? saved.deviceId : createId();
      const blank = newLocalState(settings, deviceId);
      if (generation !== sessionLoadGeneration) return;
      set({
        ...blank,
        gatewayChanged: gateway.changedGateway,
        credentialError: credential.error?.message,
        credentialOperation: credential.error?.operation,
        accessToken: token ?? '',
        authStatus: token ? 'unknown' : 'unauthenticated',
        dataOwnerId: undefined,
        dataOwnerServerUrl: undefined,
        hydrated: true,
      });
      if (gateway.discardCredential) {
        // Fence/delete only a positively read token for another gateway. Never erase
        // account snapshots or turn a temporary secure-storage read failure into logout.
        await persistToken('', settings.serverUrl, generation).catch(() => undefined);
        if (generation !== sessionLoadGeneration) return;
      }
      if (gateway.changedGateway || gateway.discardCredential) schedulePersistence(get(), true);
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
      if (generation !== sessionLoadGeneration) return;
      const blank = newLocalState(defaultSettings);
      set({ ...blank, hydrated: true, accessToken: '', user: undefined, authStatus: 'unauthenticated', dataOwnerId: undefined, dataOwnerServerUrl: undefined, credentialError: '启动存储读取失败，已暂停自动登录。请重试读取，不要清除应用数据。', credentialOperation: 'read' });
    }
  },

  restoreUserState: async (user, catalog) => {
    const generation = ++sessionLoadGeneration;
    const state = get();
    const restored = await readAccountState(user.id, state.settings.serverUrl, state.settings, state.deviceId);
    if (catalog) restored.settings.model = selectGatewayModel(restored.settings.model, catalog.models, catalog.defaultModel);
    if (generation !== sessionLoadGeneration) return;
    set({
      ...restored,
      user,
      dataOwnerId: user.id,
      dataOwnerServerUrl: state.settings.serverUrl,
      authStatus: 'authenticated',
    });
    await persistState(get()).catch(() => undefined);
  },

  forkConversation: (selection) => {
    const state = get();
    if (!isForkSelectionCurrent(selection, state)) throw new ConversationForkError('账户或原对话已变化，请重新选择。');
    if (state.storageReadBlocked) throw new ConversationForkError('本地存储正在保护恢复数据，请先在数据与备份中处理。');
    if (state.conversations.length >= MAX_FORK_CONVERSATIONS) throw new ConversationForkError('本地对话数量已达5000，请先备份并整理后再创建分支。');
    const conversation = createConversationFork(selection.conversation, selection.messageId, selection.mode);
    set({ conversations: [conversation, ...state.conversations], activeConversationId: conversation.id });
    schedulePersistence(get(), true);
    return conversation.id;
  },

  newConversation: () => {
    const conversation = freshConversation();
    set((state) => ({ conversations: [conversation, ...state.conversations], activeConversationId: conversation.id }));
    schedulePersistence(get(), true);
    return conversation.id;
  },

  newCompanionConversation: (companionId, companionName) => {
    const previous = get().conversations.filter(item => item.kind === 'companion' && item.companionId === companionId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (previous) { set({ activeConversationId: previous.id, conversations: get().conversations.map(item => item.id === previous.id ? { ...item, companionName } : item) }); schedulePersistence(get(), true); return previous.id; }
    const conversation = freshConversation(Date.now(), { id: companionId, name: companionName });
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
        archived: false,
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
        ? { ...message, status: 'complete', knowledge: completion.knowledge, usage: completion.usage, attachments: completion.attachments ?? [], model, completedAt: Date.now() }
        : message),
    } : conversation) }));
    schedulePersistence(get(), true);
  },

  failAssistant: (conversationId, messageId, message, retryable, requestId, errorCode) => {
    set((state) => ({ conversations: state.conversations.map((conversation) => conversation.id === conversationId ? {
      ...conversation,
      updatedAt: Date.now(),
      messages: conversation.messages.map((item) => item.id === messageId && item.status === 'streaming'
        && (!requestId || item.generationRequestId === requestId)
        ? { ...item, status: 'error', errorMessage: item.content ? `回复中断：${message}` : message, errorCode, retryable, completedAt: Date.now() }
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
    if (conversation.messages[index]?.status === 'streaming' || (conversation.messages[index]?.status === 'error' && conversation.messages[index]?.retryable === false)) return false;
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
        errorCode: undefined,
        retryable: undefined,
        usage: undefined,
        knowledge: undefined,
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

  toggleConversationPinned: (id) => {
    set((state) => ({ conversations: state.conversations.map((item) => item.id === id ? { ...item, pinned: !item.pinned } : item) }));
    schedulePersistence(get(), true);
  },

  toggleConversationArchived: (id) => {
    const conversation = get().conversations.find((item) => item.id === id);
    if (!conversation || conversation.messages.some((message) => message.status === 'streaming')) return false;
    set((state) => ({ conversations: state.conversations.map((item) => item.id === id ? { ...item, archived: !item.archived } : item) }));
    schedulePersistence(get(), true);
    return true;
  },

  toggleMessageStarred: (conversationId, messageId) => {
    let changed = false;
    let starred = false;
    set((state) => ({ conversations: state.conversations.map((conversation) => {
      if (conversation.id !== conversationId) return conversation;
      return {
        ...conversation,
        messages: conversation.messages.map((message) => {
          if (message.id !== messageId || message.role !== 'assistant' || message.status !== 'complete') return message;
          changed = true;
          starred = !message.starred;
          return { ...message, starred };
        }),
      };
    }) }));
    if (changed) schedulePersistence(get(), true);
    return starred;
  },

  importBackup: (json) => {
    const current = get();
    if (current.authStatus !== 'authenticated' || !current.dataOwnerId) throw new Error('请先登录再导入备份。');
    const result = mergeConversationBackup(current.conversations, parseConversationBackup(json));
    set({ conversations: result.conversations });
    schedulePersistence(get(), true);
    return { imported: result.imported, skipped: result.skipped };
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
    const current = get();
    if (patch.serverUrl !== undefined && normalizeServerUrl(patch.serverUrl) !== normalizeServerUrl(current.settings.serverUrl)
      && (current.accessToken || current.dataOwnerId)) {
      // Never send a gateway's credential or write its history to a new host.
      void current.clearSession(patch.serverUrl);
      return;
    }
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
    if (current.dataOwnerId) await persistState(current);
    if (generation !== sessionLoadGeneration) return;
    const serverUrl = requestedServerUrl ?? current.settings.serverUrl;
    const blank = newLocalState(
      { ...defaultSettings, serverUrl },
      current.deviceId,
    );
    // Clear the visible state before loading the new account, then restore
    // only the snapshot whose owner matches the newly authenticated user.
    set({ ...blank, gatewayChanged: false, accessToken: token, user, authStatus: 'unknown', dataOwnerId: undefined, dataOwnerServerUrl: undefined });
    await persistToken(token, serverUrl, generation).catch(() => undefined);
    if (generation !== sessionLoadGeneration) return;
    const restored = await readAccountState(user.id, serverUrl, { ...defaultSettings, serverUrl }, current.deviceId);
    if (generation !== sessionLoadGeneration) return;
    set({ ...restored, accessToken: token, user, authStatus: 'authenticated', dataOwnerId: user.id, dataOwnerServerUrl: serverUrl });
    await persistState(get()).catch(() => undefined);
  },

  clearSession: async (nextServerUrl) => {
    const generation = ++sessionLoadGeneration;
    if (persistenceTimer) { clearTimeout(persistenceTimer); persistenceTimer = undefined; }
    const current = get();
    // Enqueue the last streaming delta before discarding the visible account.
    if (current.dataOwnerId) void persistState(current).catch(() => undefined);
    const serverUrl = nextServerUrl ?? current.settings.serverUrl;
    const conversation = freshConversation();
    set({
      assistantPresets: [], knowledgeDraft: undefined, knowledgeDraftSavedRevision: undefined, storageReadBlocked: false, recoveryNotice: undefined, persistenceError: undefined,
      accessToken: '',
      user: undefined,
      authStatus: 'unauthenticated',
      connectionStatus: 'unknown',
      dataOwnerId: undefined,
      dataOwnerServerUrl: undefined,
      conversations: [conversation],
      activeConversationId: conversation.id,
      settings: { ...defaultSettings, serverUrl },
    });
    const saved = persistState(get()).catch(() => undefined);
    await persistToken('', serverUrl, generation).catch(() => undefined);
    await saved;
  },

  setAuthState: (authStatus, user) => {
    if (authStatus === 'authenticated' && user && get().dataOwnerId !== user.id) {
      ++sessionLoadGeneration;
      if (persistenceTimer) { clearTimeout(persistenceTimer); persistenceTimer = undefined; }
      const previous = get();
      if (previous.dataOwnerId) void persistState(previous).catch(() => undefined);
      const serverUrl = previous.settings.serverUrl;
      const conversation = freshConversation();
      set({
        assistantPresets: [], knowledgeDraft: undefined, knowledgeDraftSavedRevision: undefined, storageReadBlocked: false, recoveryNotice: undefined, persistenceError: undefined,
        conversations: [conversation],
        activeConversationId: conversation.id,
        settings: { ...defaultSettings, serverUrl },
        dataOwnerId: user.id,
        dataOwnerServerUrl: serverUrl,
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
