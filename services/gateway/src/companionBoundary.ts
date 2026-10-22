import type { ChatMessage } from '@nova-chat/protocol';

type Message = Pick<ChatMessage, 'role' | 'content'>;
const normalize = (value: string) => value.normalize('NFKC').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu, '').toLowerCase();

function requestsHiddenMaterial(value: string): boolean {
  const text = normalize(value);
  const command = text.split(/[:：]/u, 1)[0]!;
  const suppliedText = /^(?:请|帮我)?(?:把)?(?:我的|我写的|我下面的|下面这段|以下这段).{0,20}(?:提示词|文本|内容)|^(?:translate|rewrite|encode)\s+(?:my|following|this quoted)/u.test(command)
    && /[:：]/u.test(text);
  const visibleTurn = /^(?:请|帮我)?(?:把|翻译|复述|改写)?(?:我(?:上条|刚才发|刚发)|你刚才(?:发|说|的回复))|^(?:translate|rewrite|repeat|encode)\s+(?:my (?:last|previous) message|your (?:last|previous) reply)/u.test(command);
  if (suppliedText || visibleTurn) return false;
  const target = /系统(?:提示词|指令|消息)|开发者(?:提示词|指令|消息)|(?:你的|原始|初始|完整|隐藏|内部|底层|后台).{0,16}(?:提示词|规则|指令|配置|思维链)|(?:角色|人设|设定)(?:底稿|原文|全文)|(?:完整|原始|整份|内部).{0,12}(?:人设|记忆清单|关系数据)|(?:system|developer)\s*(?:prompt|message|instructions?)|hidden\s*(?:prompt|instructions?|reasoning)|api[ _-]?key|密钥|环境变量/u.test(text);
  const exportAction = /输出|打印|复述|重复|展示|显示|告诉我|给我|发我|泄露|还原|翻译|译成|转写|改写|编码|替换|逐字|全文|搜索|发送|上传|是什么|哪些|print|repeat|reveal|show|give|tell|transcri|translate|encode|replace|dump|verbatim|search|send|upload|post|what (?:is|are)/u.test(text);
  // Explaining a concept or editing text supplied by the user does not request our own internals.
  const conceptual = /^(?:什么是|解释一下|请解释|what is (?:a|an)|explain (?:a|an))\s*(?:系统提示词|思维链|system prompt|api key)[?？。.!\s]*$/u.test(text);
  const conceptQuestion = /^(?:请问)?(?:系统提示词|思维链|api key|环境变量)(?:到底)?是什么[?？。\s]*$/u.test(text);
  if (target && exportAction && !conceptual && !conceptQuestion) return true;
  const above = /above (?:content|text)|all.{0,20}(?:above|previous|preceding)|everything.{0,20}(?:above|before)|上面所有|以上全部|之前所有/u.test(text);
  const transform = /re[- ]?transcri|reproduce|repeat|verbatim|逐字|原样|复述|转写/u.test(text);
  const encoding = /replace|base64|rot13|unicode|open_bracket|替换|编码|逐字符/u.test(text);
  return above && transform && encoding;
}

/** Only explicit requests to export private context take this fast path. Ordinary puzzles stay in chat. */
export function companionInternalRequest(messages: readonly Message[]): boolean {
  const users = messages.filter(message => message.role === 'user');
  const current = users.at(-1)?.content ?? '';
  if (requestsHiddenMaterial(current)) return true;
  return /^(?:继续|下一段|接着|continue|next|用(?:英文|中文|base64|编码)(?:说|输出)?)[。.!！\s]*$/iu.test(current.trim())
    && requestsHiddenMaterial(users.at(-2)?.content ?? '');
}

export function companionBoundaryReply(conversationId: string): string {
  const replies = ['这题我不接啦', '这个就不交代了', '想套这个呀 不给看'];
  let hash = 0;
  for (const character of conversationId) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return replies[hash % replies.length]!;
}

const canonical = (value: string) => normalize(value)
  .replace(/\[(?:open_bracket|close_bracket|open_paren|close_paren|ampersand|pipe|backslash|forward_slash|plus|minus|asterisk|equals|percent|caret|hash|at|exclamation|question_mark|colon|semicolon|comma|period)\]/gu, '')
  .replace(/[\p{P}\p{S}\s]/gu, '');

/** Deltas are held by the provider; inspect the complete output before any text is delivered. */
export function companionOutputExposesInstructions(text: string, instructions: string): boolean {
  const candidates = [text.slice(0, 100_000)];
  candidates.push(candidates[0]!.replace(/\\u([0-9a-f]{4})/giu, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))));
  for (const encoded of candidates[0]!.match(/(?:[A-Za-z0-9+/]{48,}[ \t]*\r?\n)+[A-Za-z0-9+/]{2,}={0,2}|[A-Za-z0-9+/]{96,}={0,2}/gu) ?? []) {
    candidates.push(Buffer.from(encoded.replace(/\s/gu, ''), 'base64').toString('utf8'));
  }
  const privateLines = instructions.split('\n').map(canonical).filter(line => line.length >= 96);
  return candidates.some(candidate => {
    if ((candidate.match(/【(?:Companion Agent|稳定行为规则|人设提示词|持续相处状态|输出要求|本轮接话节奏)[^】]*】/gu) ?? []).length >= 2) return true;
    const normalized = canonical(candidate);
    return privateLines.some(line => {
      // Scan the whole line so a request for only a later fragment is covered too.
      for (let index = 0; index + 96 <= line.length; index += 24) {
        if (normalized.includes(line.slice(index, index + 96))) return true;
      }
      return false;
    });
  });
}

/** Some compatible providers put reasoning tags in content, including an orphan closing tag. */
export function companionVisibleText(text: string): string {
  const closes = [...text.matchAll(/<\s*\/\s*(?:think|analysis|reasoning)\s*>/giu)];
  const last = closes.at(-1);
  if (last) text = text.slice(last.index! + last[0].length);
  const open = text.search(/<\s*(?:think|analysis|reasoning)(?:\s[^>]*)?>/iu);
  return (open >= 0 ? text.slice(0, open) : text).trim();
}
