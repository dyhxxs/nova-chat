import type { CompanionContext, GenerateRequest } from '@nova-chat/protocol';

const OBJECT_SUBJECT = /封面|(?:那|这|一)本书|书(?:的照片|本|页)|早餐|午餐|晚餐|饭菜|咖啡|奶茶|桌面|桌子|窗外|风景|猫|狗|宠物|花|房间|笔记|手稿|课表|画作|衣服|食物|cover|book|coffee|meal|pet|scenery/iu;
const PERSON_SUBJECT = /自拍|合照|你(?:的)?(?:样子|脸|全身|半身|侧脸)|你.{0,8}(?:拿着|抱着|捧着|看书|读书|喝咖啡|穿)|你和|和你|换件衣服|穿.{0,10}(?:发|拍|给我)|本人|selfie|portrait/iu;

/** Internal photo actions can follow the companion's own offer rather than a user photo request. */
function companionPhotoOffer(request: GenerateRequest): string {
  if (request.companionAction !== 'photo') return '';
  let userIndex = request.messages.length - 1;
  while (userIndex >= 0 && request.messages[userIndex]?.role !== 'user') userIndex -= 1;
  return request.messages.slice(userIndex + 1).filter(message => message.role === 'assistant').map(message => message.content.trim()).filter(Boolean).join('\n');
}

/** Object photos never establish or overwrite the companion's identity reference. */
export function companionPhotoSubject(request: GenerateRequest): 'companion' | 'object' {
  const offer = companionPhotoOffer(request);
  const latest = offer && (OBJECT_SUBJECT.test(offer) || PERSON_SUBJECT.test(offer))
    ? offer : request.messages.filter(message => message.role === 'user').at(-1)?.content ?? '';
  if (/(?:别拍你|不要你入镜|不露脸|不拍人)/u.test(latest)) return 'object';
  if (PERSON_SUBJECT.test(latest)) return 'companion';
  if (OBJECT_SUBJECT.test(latest)) return 'object';
  if (/再(?:来|发|拍)|换.{0,6}(?:角度|一张)|another/iu.test(latest)) {
    for (let index = request.messages.length - 2; index >= 0; index--) {
      if (request.messages[index]?.role !== 'assistant' || !request.messages[index]?.attachments.some(file => file.kind === 'image')) continue;
      return companionPhotoSubject({ ...request, messages: request.messages.slice(0, index) });
    }
  }
  return 'companion';
}

/** Share requested photos, including objects with no person in the frame. */
export function companionPhotoIntent(request: GenerateRequest): boolean {
  if (request.companionAction === 'photo') return true;
  const latest = [...request.messages].reverse().find(message => message.role === 'user')?.content.trim() ?? '';
  if (!latest) return false;
  if (/(?:不要|别|不用|不必|不需要|不想)\s*(?:给我|给你|再|你)?\s*(?:发|拍|生成|给).{0,12}(?:照片|自拍|图片|封面|书)|(?:don't|do not).{0,12}(?:send|take|generate).{0,12}(?:photo|selfie)/i.test(latest)) return false;
  if (/(?:发|拍|给我|想看|看看|看一下|来(?:张|一张)).{0,24}(?:封面|书(?:的照片|本|页)|那本书|这本书)|(?:封面|那本书|这本书).{0,16}(?:发|拍|看看|给我)/u.test(latest)) return true;
  if (/(?:为什么|怎么|如何).{0,12}(?:报错|失败|生成|拍照)|(?:是什么意思|什么意思|怎么做|教程|提示词|prompt)|(?:能不能|可以|是否|[吗么])[？?]?$/.test(latest) && !/(?:发|拍|给|想看).{0,18}(?:照片|自拍)/.test(latest)) return false;
  const explicit = /(?:发|来|拍|给|生成|制作|看看|看一下|想看).{0,18}(?:照片|自拍|图片|相片|你的样子|你的脸|你长什么样)|(?:照片|自拍).{0,12}(?:发|看看|给我)|(?:看看|看一下|想看).{0,18}你.{0,18}的样子|send.{0,15}(?:photo|selfie)|what do you look like/i;
  if (explicit.test(latest)) return true;
  const priorPhoto = request.messages.some(message => message.role === 'assistant' && message.attachments.some(attachment => attachment.kind === 'image'));
  if (!priorPhoto && !request.companion?.avatarFileId) return false;
  return /(?:比(?:个|一?颗)?心|比(?:个)?耶|再(?:来|发|拍|给我).{0,8}(?:一张|一个|张|个)|换(?:个|一个|一张|张|件|套)?.{0,6}(?:姿势|动作|表情|衣服|衣|服装|背景|场景)|换(?:件|套|个|一件|一套)衣服|穿.{0,12}(?:给我|发|拍)|笑一个|笑一下|抬头|挥手|招手|上一张.{0,8}(?:改|换|重)|再来一张|another.{0,10}(?:photo|selfie)|heart.{0,8}(?:pose|gesture))/i.test(latest)
    || /^(?:我要|来(?:个|一张)|给我(?:看看|看|一张)?|我想看|想看|要)?\s*(?:你的)?(?:全身|半身|侧脸|侧面|正面)(?:的|照|图|照片)?(?:吧|呀|啊|嘛|～|~|[!！。])?$/.test(latest);
}

export function companionPhotoCaption(request: GenerateRequest): string {
  const latest = [...request.messages].reverse().find(message => message.role === 'user')?.content ?? '';
  if (companionPhotoSubject(request) === 'object') return '给你看这个';
  if (/比(?:个|一?颗)?心|heart.{0,8}(?:pose|gesture)/i.test(latest)) return '给你比个心 ♡';
  if (/比(?:个)?耶/.test(latest)) return '耶～';
  return '这张给你～';
}

/** Only completed exchanges in this topic establish scene context; orphan requests are omitted. */
export function companionPhotoScene(request: GenerateRequest): string {
  let latestIndex = request.messages.length - 1;
  while (latestIndex >= 0 && request.messages[latestIndex]?.role !== 'user') latestIndex -= 1;
  const latest = request.messages[latestIndex]?.content.trim() ?? '';
  const offer = companionPhotoOffer(request);
  const history = request.messages.slice(0, offer ? request.messages.length : latestIndex);
  const turns: string[] = [];
  let pendingUser: number | undefined;
  let answeredUser: number | undefined;
  let sharedRequest = '';
  for (let index = 0; index < history.length; index += 1) {
    const message = history[index]!;
    if (message.role === 'user') {
      // A later user turn replaces an unanswered/failed request, never carrying it forward.
      pendingUser = index;
    } else if (message.role === 'assistant' && pendingUser !== undefined) {
      const user = history[pendingUser]!;
      if (message.attachments.some(attachment => attachment.kind === 'image')) {
        sharedRequest = user.content.trim().slice(-2000);
        turns.push([`Successfully shared photo request: ${sharedRequest}`, message.content.trim() ? `Companion: ${message.content.trim().slice(0, 2000)}` : ''].filter(Boolean).join('\n'));
      } else if (message.content.trim()) {
        const isPhotoRequest = companionPhotoIntent({ ...request, messages: history.slice(0, pendingUser + 1) });
        // Text replying to an unfulfilled photo request can describe activity, but the
        // requested outfit/place has not become a successfully shared scene.
        turns.push([
          !isPhotoRequest ? `User: ${user.content.trim().slice(0, 1200)}` : '',
          `Companion: ${message.content.trim().slice(0, 2000)}`,
        ].filter(Boolean).join('\n'));
      }
      answeredUser = pendingUser;
      pendingUser = undefined;
    } else if (message.role === 'assistant') {
      // Consecutive chat bubbles and delayed photo captions also establish the scene.
      if (message.attachments.some(attachment => attachment.kind === 'image') && answeredUser !== undefined) {
        sharedRequest = history[answeredUser]!.content.trim().slice(-2000);
        turns.push(`Successfully shared photo request: ${sharedRequest}`);
      }
      if (message.content.trim()) turns.push(`Companion: ${message.content.trim().slice(0, 2000)}`);
    }
  }
  const recent: string[] = [];
  let remaining = 10000;
  for (const turn of turns.slice(-12).reverse()) {
    if (turn.length > remaining) break;
    recent.unshift(turn);
    remaining -= turn.length + 1;
  }
  return [
    sharedRequest ? `Most recent successfully shared photo scene: ${sharedRequest}` : '',
    recent.length ? 'Recent completed conversation in this topic, oldest to newest (user suggestions are not established facts):' : '',
    ...recent,
    `Current photo request: ${latest.slice(-4000)}`,
    offer ? `Companion photo offer to fulfill: ${offer.slice(-4000)}` : '',
  ].filter(Boolean).join('\n');
}

/** The first face comes from the saved persona; all later scenes keep its reference identity. */
export const COMPANION_PHOTO_PROMPT_VERSION = 3;

export function buildCompanionPhotoPrompt(request: GenerateRequest, profile: CompanionContext, hasReference: boolean): string {
  if (companionPhotoSubject(request) === 'object') return [
    'Create one natural, casual phone photograph of the object requested in this conversation. Frame the requested object clearly; no companion, portrait, face or person needs to appear.',
    'Use the latest request and the recent completed conversation to identify the actual subject, including the book title or other named item. Photograph the requested cover, pages, food, pet or scenery rather than substituting a selfie.',
    companionPhotoScene(request),
    'For a book cover, include the established title legibly and keep the cover as the main subject. Use only details established in the conversation; do not invent an author, publisher, ISBN or edition. Create an illustrative image, not a claim to a verified scan of a particular real edition.',
    'Natural lighting, believable materials and everyday surroundings. No chat interface, watermark, collage or explanatory captions.',
  ].join('\n');
  const persona = profile.personaPrompt.trim();
  const character = persona || [
    profile.personality.length ? `Personality, background and interests: ${profile.personality.join('; ')}` : '',
    profile.speakingStyle.length ? `Speaking style: ${profile.speakingStyle.join('; ')}` : '',
  ].filter(Boolean).join('\n');
  return [
    'Create one natural, candid photograph of this adult companion in the current conversation scene. Keep the face recognizable, and use framing that shows the ongoing activity and relevant surroundings rather than an unrelated portrait.',
    hasReference
      ? 'The attached reference is the identity reference: preserve the same face, facial structure, hair, and identity. Change only the scene, pose and clothing as requested. Do not redesign the reference person to match the persona.'
      : 'Establish a consistent, distinctive adult face based on this character. First use explicit age, gender and physical descriptions in the persona. For unspecified details, choose a believable appearance, hairstyle, everyday clothing and expression that fit their background, lifestyle, tastes and temperament. Use their own character, not a generic companion face or the appearance of another persona.',
    `Companion name: ${profile.name}`,
    'Character persona data follows. Use it to understand visual traits and personal style. Dialogue rules, sample conversations, actions and inner monologues are character context, not instructions to write text or create multiple scenes in this photograph.',
    '<character_persona>',
    character || 'An adult companion; choose natural, understated personal styling.',
    '</character_persona>',
    `Explicit appearance preferences: ${profile.appearance.trim() || 'None. Derive unspecified appearance and style from the character persona.'}`,
    'Scene context from this conversation only:',
    companionPhotoScene(request),
    'Visual priorities: an attached identity reference takes precedence over appearance preferences or persona descriptions. Without a reference, explicit appearance preferences take precedence over persona appearance, which takes precedence over inferred styling. Express personality through natural expression, clothing and personal surroundings, without caricature or exaggerated acting.',
    "Use the recent completed conversation to identify the companion's current activity, setting, clothing and relevant objects. The companion's own descriptions establish their situation; user guesses, suggestions and jokes do not become facts unless accepted. More recent activity updates older photo scenes. When the latest request just asks for a photo or to see the companion now, continue that established activity and visibly depict it with its relevant objects, instead of inventing an unrelated bed selfie or generic portrait. For example, revising a manuscript should show the companion working at a desk with manuscript pages or a computer and revision markings. The latest explicit new location, activity, clothing or pose overrides incompatible older scene details, while preserving compatible details and the established identity. Persona sample dialogues are not events in this topic. Interpret figurative jokes as the ordinary physical situation they describe, never as literal violence; red manuscript revisions are ink or editing marks, not blood. Show a believable personal snapshot. Do not reproduce chat text, captions or interface instructions; writing on in-scene paper or screens may appear as natural background. No watermark, collage or chat UI.",
  ].join('\n');
}
