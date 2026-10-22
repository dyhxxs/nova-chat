import type { CompanionMood } from '@nova-chat/protocol';

/** Private relationship state. Scores are never sent to the phone. */
export type CompanionRelationship = {
  familiarity: number;
  interactionDays: number;
  affection: number;
  trust: number;
  tension: number;
  mood?: CompanionMood;
  lastInteractionAt?: number;
  nextProactiveAt?: number;
};

export function initialCompanionRelationship(): CompanionRelationship {
  return { familiarity: 0, interactionDays: 0, affection: 0, trust: 0, tension: 0, mood: 'calm' };
}

function has(text: string, pattern: RegExp): boolean { return pattern.test(text); }

/**
 * Small, explainable changes beat a prompt asking a model to invent a new
 * personality every turn. The relationship moves slowly and tension fades.
 */
export function evolveCompanionRelationship(current: CompanionRelationship, userText: string, _assistantText: string, now = Date.now()): CompanionRelationship {
  const text = userText.trim();
  const continuedDay = current.lastInteractionAt !== undefined && Math.floor(current.lastInteractionAt / 86_400_000) === Math.floor(now / 86_400_000);
  const interactionDays = current.interactionDays + (continuedDay ? 0 : 1);
  const familiarDelta = userText.trim() ? 1 : 0;
  const respectfulReturn = !continuedDay && current.interactionDays > 0 && text.length >= 8 && current.tension < 3
    && !/滚|闭嘴|烦你|没用|别装|不想理你|讨厌|不(?:喜欢|信)/u.test(text);
  const trustDelta = respectfulReturn ? 1 : !/不(?:喜欢|信)|别(?:陪|爱)|讨厌/u.test(userText) && has(userText, /谢谢|感谢|懂了|你说得对|我愿意告诉你|对不起|抱歉|放心|信你|喜欢和你聊|喜欢你/u) ? 1 : 0;
  const affectionDelta = !/不(?:喜欢|想|爱)|别(?:陪|爱)|讨厌/u.test(userText) && has(userText, /想你|喜欢你|好感|心动|在乎你|陪着我|晚安|早安|你真好|爱你/u) ? 1 : 0;
  const repairDelta = has(userText, /对不起|抱歉|刚才我语气不好|别生气|和好/u) ? 1 : 0;
  const tensionDelta = has(userText, /滚|闭嘴|烦你|没用|别装|不想理你|讨厌你|你怎么这么/u) ? 2 : 0;
  const directWarmth = has(text, /哈哈|开心|好玩|有点期待|想和你|谢谢你|晚安|早安/u);
  const directLow = has(userText, /难过|委屈|崩溃|焦虑|压力|好累|烦死|不开心|孤独/u);
  const directAngry = tensionDelta > 0 || has(userText, /生气|气死|火大/u);
  const tension = Math.max(0, Math.min(100, current.tension + tensionDelta - (repairDelta * 2) - (current.tension > 0 ? 1 : 0)));
  const familiarity = Math.min(100, current.familiarity + familiarDelta);
  const trust = Math.max(0, Math.min(100, current.trust + trustDelta + repairDelta - Math.floor(tensionDelta / 2)));
  const affection = Math.max(0, Math.min(100, current.affection + affectionDelta - (tensionDelta > 0 ? 1 : 0)));
  const mood: CompanionMood = directAngry ? 'serious' : directLow ? 'sad' : directWarmth ? 'warm' : current.mood ?? 'calm';
  return {
    familiarity, interactionDays, trust, affection, tension, mood,
    lastInteractionAt: now,
    // A character may reach out after a quiet stretch, but never repeatedly.
    nextProactiveAt: now + (affection >= 4 || familiarity >= 8 ? 30 : 60) * 60_000,
  };
}

export function companionRelationshipStage(relationship: CompanionRelationship): 'new' | 'familiar' | 'close' {
  if (relationship.familiarity >= 24 && relationship.trust >= 10 && relationship.affection >= 8 && relationship.interactionDays >= 3 && relationship.tension < 3) return 'close';
  if (relationship.familiarity >= 8 && relationship.trust >= 3 && relationship.tension < 6) return 'familiar';
  return 'new';
}
