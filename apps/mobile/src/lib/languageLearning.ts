import AsyncStorage from '@react-native-async-storage/async-storage';
import type { VoiceMessage } from './voice';
import { createStudyState, normalizeStudyState, type StudyState } from './studyDeck';

export type LearningLanguageId = 'cantonese' | 'english';
export type LearningMode = 'conversation' | 'translate' | 'pronunciation' | 'study';
export type LearningLevel = 'beginner' | 'intermediate' | 'advanced';

export type LearningTurn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Keeps conversation and translation practice histories independent. */
  mode?: LearningMode;
  speechText?: string;
  translation?: string;
  correction?: string;
  pronunciation?: string;
  lesson?: string;
  followUp?: string;
  voice?: VoiceMessage;
  createdAt: number;
};

export type PronunciationAssessment = {
  targetText: string;
  heardText: string;
  score: number;
  level: 'excellent' | 'good' | 'retry';
  summary: string;
  issues: string;
  standardPronunciation: string;
  nextStep: string;
  createdAt: number;
};

export type LanguageLearningSession = {
  languageId: LearningLanguageId;
  level: LearningLevel;
  mode: LearningMode;
  autoSpeak: boolean;
  turns: LearningTurn[];
  practiceTarget?: LearningTurn;
  lastAssessment?: PronunciationAssessment;
  study: StudyState;
  updatedAt: number;
};

export type LanguageLearningState = {
  version: 1;
  sessions: Partial<Record<LearningLanguageId, LanguageLearningSession>>;
};

const STORAGE_PREFIX = '@nova-chat/language-learning/v1/';

export function languageLearningStorageKey(userId: string, serverUrl: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(serverUrl.trim().replace(/\/$/, ''))}`;
}

export function emptyLanguageLearningSession(languageId: LearningLanguageId): LanguageLearningSession {
  return { languageId, level: 'beginner', mode: 'conversation', autoSpeak: true, turns: [], study: createStudyState(languageId), updatedAt: Date.now() };
}

/** Return only the turns belonging to the selected practice mode. */
export function turnsForLearningMode(turns: LearningTurn[], mode: LearningMode): LearningTurn[] {
  return turns.filter((turn) => turn.mode === mode || (!turn.mode && mode === 'conversation'));
}

function validTurn(value: unknown): value is LearningTurn {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<LearningTurn>;
  return typeof item.id === 'string' && typeof item.text === 'string'
    && (item.role === 'user' || item.role === 'assistant')
    && typeof item.createdAt === 'number';
}

function normalizeSession(languageId: LearningLanguageId, value: unknown): LanguageLearningSession {
  const fallback = emptyLanguageLearningSession(languageId);
  if (!value || typeof value !== 'object') return fallback;
  const item = value as Partial<LanguageLearningSession>;
  return {
    ...fallback,
    languageId,
    level: item.level === 'intermediate' || item.level === 'advanced' ? item.level : 'beginner',
    mode: item.mode === 'translate' || item.mode === 'pronunciation' || item.mode === 'study' ? item.mode : 'conversation',
    autoSpeak: item.autoSpeak !== false,
    // Older records did not store a mode on each turn. They were created by
    // the original conversation flow, so keep them in that mode instead of
    // leaking them into a newly selected translation practice tab.
    turns: Array.isArray(item.turns) ? item.turns.filter(validTurn).map((turn) => ({ ...turn, mode: turn.mode === 'translate' || turn.mode === 'pronunciation' || turn.mode === 'conversation' ? turn.mode : 'conversation' })).slice(-100) : [],
    practiceTarget: validTurn(item.practiceTarget) ? item.practiceTarget : undefined,
    lastAssessment: item.lastAssessment && typeof item.lastAssessment === 'object'
      ? item.lastAssessment as PronunciationAssessment : undefined,
    study: normalizeStudyState(languageId, item.study),
    updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
  };
}

export async function loadLanguageLearningState(userId: string, serverUrl: string): Promise<LanguageLearningState> {
  try {
    const raw = await AsyncStorage.getItem(languageLearningStorageKey(userId, serverUrl));
    if (!raw) return { version: 1, sessions: {} };
    const parsed = JSON.parse(raw) as Partial<LanguageLearningState>;
    if (parsed.version !== 1 || !parsed.sessions || typeof parsed.sessions !== 'object') return { version: 1, sessions: {} };
    return {
      version: 1,
      sessions: {
        cantonese: normalizeSession('cantonese', parsed.sessions.cantonese),
        english: normalizeSession('english', parsed.sessions.english),
      },
    };
  } catch {
    return { version: 1, sessions: {} };
  }
}

export function saveLanguageLearningState(userId: string, serverUrl: string, state: LanguageLearningState): Promise<void> {
  return AsyncStorage.setItem(languageLearningStorageKey(userId, serverUrl), JSON.stringify({ version: 1, sessions: state.sessions }));
}
