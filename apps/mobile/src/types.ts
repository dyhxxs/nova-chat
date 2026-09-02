import type { GeneratedAttachment, ReasoningEffort, TokenUsage, Verbosity } from '@nova-chat/protocol';

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
  retryable?: boolean;
  usage?: TokenUsage;
};

export type Conversation = {
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
};
