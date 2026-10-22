import type { AppConfig } from './config.js';

export const CHAT_VOICES = [
  { id: 'zh_female_vv_uranus_bigtts', name: 'Vivi · 灵动女声' },
  { id: 'zh_female_xiaohe_uranus_bigtts', name: '小何 · 自然女声' },
  { id: 'zh_female_linjianvhai_uranus_bigtts', name: '邻家女孩 · 温柔女声' },
  { id: 'zh_male_taocheng_uranus_bigtts', name: '小天 · 清爽男声' },
  { id: 'zh_male_liufei_uranus_bigtts', name: '刘飞 · 磁性男声' },
];
export type ChatVoice = { id: string; name: string; model: string; aliases?: string[] };

/** The administrator's clone replaces female presets, including saved conversation choices. */
export function chatVoices(config: AppConfig): ChatVoice[] {
  const femaleIds = CHAT_VOICES.filter(voice => voice.id.startsWith('zh_female_')).map(voice => voice.id);
  const presets = CHAT_VOICES.filter(voice => !config.voiceFemaleCloneId || !femaleIds.includes(voice.id))
    .map(voice => ({ ...voice, model: config.voiceTtsModel }));
  if (!config.voiceFemaleCloneId) return presets;
  return [{ id: config.voiceFemaleCloneId, name: config.voiceFemaleCloneName, model: 'speech-2.8', aliases: femaleIds }, ...presets];
}
export function resolveChatVoice(config: AppConfig, requestedId?: string): ChatVoice | undefined {
  const id = requestedId || config.voiceDefaultId;
  return chatVoices(config).find(voice => voice.id === id || voice.aliases?.includes(id));
}
