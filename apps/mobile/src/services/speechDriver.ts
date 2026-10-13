import * as Speech from 'expo-speech';
import type { SpeechDriver } from '../lib/speechController';
// Also serialize stop across ChatScreen unmount/remount, not just within one controller.
let stopQueue: Promise<void> = Promise.resolve();
let preparation: Promise<void> | undefined;
let voices: Speech.Voice[] = [];
function prepare() {
  // Do not grow Expo's delayedGetVoices queue while a system TTS engine is hung.
  if (!preparation) {
    const task = Speech.getAvailableVoicesAsync().then(result => {
      if (!result.length) throw new Error('No system speech voices');
      voices = result;
    });
    preparation = task;
    void task.then(() => { if (preparation === task) preparation = undefined; }, () => { if (preparation === task) preparation = undefined; });
  }
  return preparation;
}
export const speechDriver: SpeechDriver = {
  maxLength: Speech.maxSpeechInputLength,
  prepare,
  stop: () => {
    stopQueue = stopQueue.catch(() => undefined).then(() => Speech.stop());
    return stopQueue;
  },
  speak: (text, options) => {
    if (!voices.length) throw new Error('Speech must be prepared before accepting text');
    const language = options.language?.toLowerCase();
    const voice = language ? voices.find(item => item.language.replace(/_/g, '-').toLowerCase() === language)
      ?? voices.find(item => item.language.split(/[-_]/)[0]?.toLowerCase() === language.split('-')[0]) : undefined;
    if (language && !voice) throw new Error('Requested speech language is not installed');
    // Selecting a known voice also avoids Android Locale("zh-CN") falling back
    // to an unrelated device language in the current Expo Speech implementation.
    Speech.speak(text, { ...options, ...(voice ? { voice: voice.identifier } : {}) });
  },
};
