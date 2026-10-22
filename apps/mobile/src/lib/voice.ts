import { z } from 'zod';
export const voiceMessageSchema = z.object({
  fileId: z.string().uuid().optional(), durationMs: z.number().finite().min(0).max(600_000),
  status: z.enum(['pending', 'ready', 'error']), requestId: z.string().uuid(),
  resumable: z.boolean().optional(),
  localRecording: z.object({ uri: z.string().min(1), mimeType: z.string().min(1) }).optional(),
  voiceId: z.string().max(120).optional(), error: z.string().max(300).optional(),
}).refine(voice => voice.status !== 'ready' || Boolean(voice.fileId));
export const voicePreferencesSchema = z.object({ replyMode: z.enum(['auto', 'voice', 'text']), voiceId: z.string().max(120) });
export type VoiceMessage = z.infer<typeof voiceMessageSchema>;
export type VoicePreferences = z.infer<typeof voicePreferencesSchema>;
export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = { replyMode: 'auto', voiceId: 'zh_female_vv_uranus_bigtts' };
/** Companion chats use text first; voice is opt-in for a natural chat rhythm. */
export const DEFAULT_COMPANION_VOICE_PREFERENCES: VoicePreferences = { replyMode: 'auto', voiceId: DEFAULT_VOICE_PREFERENCES.voiceId };
export function voicePreferencesForConversation(companion: boolean, preferences?: VoicePreferences): VoicePreferences {
  return preferences ?? (companion ? DEFAULT_COMPANION_VOICE_PREFERENCES : DEFAULT_VOICE_PREFERENCES);
}
export type RecordedVoice = { uri: string; durationMs: number; mimeType: string; requestId: string };

const VOICE_REQUEST_PATTERN = /(?:语音|声音|发(?:个|一条|一段)?(?:语音|声音)|语音(?:回复|聊天|交流|消息)|声音(?:回复|聊天|交流)|用语音|说给我听|让我听听|听听你的声音|听你(?:说|的声音)|开麦|朗读给我听|voice|audio|speak|sound)/i;
const VOICE_NEGATION_PATTERN = /(?:别|不要|不用|无需|不需要|不想|别再|不要再)\s*(?:发|用|听)?\s*(?:语音|声音|voice|audio|speak|sound)/i;
export function textRequestsVoice(text?: string): boolean {
  const value = text?.trim();
  return Boolean(value && !VOICE_NEGATION_PATTERN.test(value) && VOICE_REQUEST_PATTERN.test(value));
}
export function replyWantsVoice(preferences: VoicePreferences | undefined, userVoice?: VoiceMessage, userText?: string): boolean {
  return preferences?.replyMode === 'voice'
    || (preferences?.replyMode !== 'text' && (Boolean(userVoice) || textRequestsVoice(userText)));
}
