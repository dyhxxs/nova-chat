import type { GenerateRequest } from '@nova-chat/protocol';

/** Follow-up photo actions keep the reference face, even when no photo noun is repeated. */
export function companionPhotoIntent(request: GenerateRequest): boolean {
  if (request.companionAction === 'photo') return true;
  const latest = [...request.messages].reverse().find(message => message.role === 'user')?.content.trim() ?? '';
  if (!latest) return false;
  if (/(?:不要|别|不用|不必|不需要|不想)\s*(?:给我|给你|再|你)?\s*(?:发|拍|生成|给).{0,12}(?:照片|自拍|图片)|(?:don't|do not).{0,12}(?:send|take|generate).{0,12}(?:photo|selfie)/i.test(latest)) return false;
  if (/(?:为什么|怎么|如何).{0,12}(?:报错|失败|生成|拍照)|(?:是什么意思|什么意思|怎么做|教程|提示词|prompt)|(?:能不能|可以|是否|[吗么])[？?]?$/.test(latest) && !/(?:发|拍|给|想看).{0,18}(?:照片|自拍)/.test(latest)) return false;
  const explicit = /(?:发|来|拍|给|生成|制作|看看|看一下|想看).{0,18}(?:照片|自拍|你的样子|你的脸|你长什么样)|(?:照片|自拍).{0,12}(?:发|看看|给我)|send.{0,15}(?:photo|selfie)|what do you look like/i;
  if (explicit.test(latest)) return true;
  const priorPhoto = request.messages.some(message => message.role === 'assistant' && message.attachments.some(attachment => attachment.kind === 'image'));
  if (!priorPhoto && !request.companion?.avatarFileId) return false;
  return /(?:比(?:个|一?颗)?心|比(?:个)?耶|再(?:来|发|拍|给我).{0,8}(?:一张|一个|张|个)|换(?:个|一个|一张|张|件|套)?.{0,6}(?:姿势|动作|表情|衣服|衣|服装|背景|场景)|换(?:件|套|个|一件|一套)衣服|穿.{0,12}(?:给我|发|拍)|笑一个|笑一下|抬头|挥手|招手|上一张.{0,8}(?:改|换|重)|再来一张|another.{0,10}(?:photo|selfie)|heart.{0,8}(?:pose|gesture))/i.test(latest)
    || /^(?:我要|来(?:个|一张)|给我(?:看看|看|一张)?|我想看|想看|要)?\s*(?:你的)?(?:全身|半身|侧脸|侧面|正面)(?:的|照|图|照片)?(?:吧|呀|啊|嘛|～|~|[!！。])?$/.test(latest);
}

export function companionPhotoCaption(request: GenerateRequest): string {
  const latest = [...request.messages].reverse().find(message => message.role === 'user')?.content ?? '';
  if (/比(?:个|一?颗)?心|heart.{0,8}(?:pose|gesture)/i.test(latest)) return '给你比个心 ♡';
  if (/比(?:个)?耶/.test(latest)) return '耶，给你～';
  return '这张给你～';
}

/** Photo context uses fulfilled scenes; failed/orphan user requests are not scene memory. */
export function companionPhotoScene(request: GenerateRequest): string {
  let latestIndex = request.messages.length - 1;
  while (latestIndex >= 0 && request.messages[latestIndex]?.role !== 'user') latestIndex -= 1;
  const latest = request.messages[latestIndex]?.content.trim() ?? '';
  const history = request.messages.slice(0, latestIndex);
  let sharedIndex = history.length - 1;
  while (sharedIndex >= 0 && !(history[sharedIndex]?.role === 'assistant' && history[sharedIndex]?.attachments.some(attachment => attachment.kind === 'image'))) sharedIndex -= 1;
  const sharedRequest = sharedIndex < 0 ? undefined : history.slice(0, sharedIndex).reverse().find(message => message.role === 'user')?.content.trim();
  const activity = [...history].reverse().find(message => message.role === 'assistant' && !message.attachments.some(attachment => attachment.kind === 'image') && message.content.trim())?.content.trim();
  return [
    sharedRequest ? `Most recent successfully shared photo scene: ${sharedRequest.slice(-2000)}` : '',
    activity ? `Companion's recent activity: ${activity.slice(-2000)}` : '',
    `Current photo request: ${latest.slice(-4000)}`,
  ].filter(Boolean).join('\n');
}
