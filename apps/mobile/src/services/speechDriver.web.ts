import type { SpeechDriver } from '../lib/speechController';
// Use the browser API directly: Expo's Web speak wrapper can discard async errors.
let active: SpeechSynthesisUtterance | undefined;
export const speechDriver: SpeechDriver = {
  maxLength: 200,
  stop: async () => { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); active = undefined; },
  speak: (text, options) => {
    if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') throw new Error('Speech unavailable');
    const utterance = new SpeechSynthesisUtterance(text);
    active = utterance;
    utterance.rate = options.rate;
    if (options.language) utterance.lang = options.language;
    utterance.onstart = options.onStart;
    utterance.onend = () => { if (active === utterance) active = undefined; options.onDone(); };
    utterance.onerror = () => { if (active === utterance) active = undefined; options.onError(); };
    speechSynthesis.speak(utterance);
  },
};
