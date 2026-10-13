import type { GeneratedAttachment, KnowledgeResult, ReasoningEffort, TokenUsage, Verbosity } from '@nova-chat/protocol';

export type MessageStatus = 'complete' | 'streaming' | 'error' | 'cancelled';
export type AuthStatus = 'unknown' | 'authenticated' | 'unauthenticated';

export type UserProfile = {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  disabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number;
  avatarFileId?: string;
};

export type PendingAttachment = {
  localId: string;
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
  kind: 'image' | 'document';
};

export type AttachmentUploadState = {
  status: 'queued' | 'uploading' | 'complete' | 'error';
  progress: number;
  error?: string;
};

export type AppAttachment = GeneratedAttachment;

export type AppMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments: AppAttachment[];
  createdAt: number;
  status: MessageStatus;
  errorMessage?: string;
  errorCode?: string;
  retryable?: boolean;
  usage?: TokenUsage;
  knowledge?: KnowledgeResult;
  /** Saved by the user for quick access from the Saved screen. */
  starred?: boolean;
  /** Model selected when this turn was sent. It remains fixed if settings change mid-generation. */
  requestedModel?: string;
  /** Model that actually produced the response, including gateway fallbacks or image routing. */
  model?: string;
  /** Durable gateway request used to reconnect after a stream or app interruption. */
  generationRequestId?: string;
  /** Frozen generation controls for this individual answer. */
  generationOptions?: {
    reasoningEffort: ReasoningEffort;
    verbosity: Verbosity;
    maxOutputTokens: number;
    autoTools?: boolean;
  knowledgeBase?: boolean;
    webSearch: boolean;
    codeInterpreter: boolean;
  };
  generationStartedAt?: number;
  completedAt?: number;
};

export type Conversation = {
  /** Normal conversations use Nova; companion conversations resolve a server-owned profile. */
  kind?: 'normal' | 'companion';
  companionId?: string;
  companionName?: string;
  /** Unsent text only; local attachment URIs are deliberately not persisted. */
  draft?: string;
  /** Frozen instruction snapshot; editing/deleting a preset cannot change this chat. */
  assistant?: { name: string; instructions: string };
  pinned?: boolean;
  archived?: boolean;
  /** Original identity for additive, duplicate-safe backup imports. */
  importSourceId?: string;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: AppMessage[];
};

export type AppSettings = {
  serverUrl: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  verbosity: Verbosity;
  instructions: string;
  maxOutputTokens: number;
  autoTools?: boolean;
  knowledgeBase?: boolean;
  webSearch: boolean;
  codeInterpreter: boolean;
};

export type RootStackParamList = {
  Login: undefined;
  Chat: undefined;
  History: undefined;
  Settings: undefined;
  Profile: undefined;
  Admin: undefined;
  About: undefined;
  Data: undefined;
  Security: undefined;
  Assistants: undefined;
  Companions: { editId?: string } | undefined;
  Knowledge: undefined;
  Diagnostics: undefined;
  Saved: undefined;
};
