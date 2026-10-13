export const MAX_SPEECH_SOURCE_CHARS = 120_000;
export const MAX_SPEECH_TEXT_CHARS = 30_000;

/** Readable prose, not a Markdown renderer or a privacy/redaction filter. */
export function prepareSpeechText(content: string): { text: string; simplified: boolean } {
  if (content.length > MAX_SPEECH_SOURCE_CHARS) throw new Error('回复过长，暂不支持整段朗读，请复制需要的段落。');
  let fence: { character: string; length: number } | undefined;
  const lines: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (match && match[1]![0] === fence.character && match[1]!.length >= fence.length && !match[2]!.trim()) fence = undefined;
      continue;
    }
    if (match) { fence = { character: match[1]![0]!, length: match[1]!.length }; continue; }
    if (/^( {4}|\t)/.test(line) || /^\s*\[[^\u005B\]\n]+\]:\s*\S+/.test(line)) continue;
    lines.push(line);
  }
  const text = lines.join('\n')
    .replace(/!\[[^\u005B\]\n]*\]\([^()\n]*\)/g, '')
    .replace(/\[([^\u005B\]\n]+)\]\([^()\n]*\)/g, '$1')
    .replace(/\[([^\u005B\]\n]+)\]\[[^\u005B\]\n]*\]/g, '$1')
    .replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, '')
    .replace(/<[^<>\n]*>/g, '')
    .replace(/\[(?:资料\s*\d+|\d+)\]/g, '')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, '')
    .replace(/[`*_~|]/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n[ \t]*\n+/g, '\n')
    .trim();
  if (!text || !/[\p{L}\p{N}]/u.test(text)) throw new Error('这条回复没有可朗读的正文；代码块、图片和链接地址默认省略。');
  if (text.length > MAX_SPEECH_TEXT_CHARS) throw new Error('正文超过3万字符，暂不支持整段朗读，请复制需要的段落。');
  return { text, simplified: text !== content.trim() };
}

/** Keep every UTF-16 code point intact, preferring nearby sentence/word boundaries. */
export function splitSpeechText(text: string, maxLength = 200): string[] {
  if (!Number.isFinite(maxLength) || maxLength < 2) throw new Error('当前语音服务不支持有效的文本长度。');
  const limit = Math.min(200, Math.floor(maxLength));
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + limit, text.length);
    if (end < text.length) {
      for (let index = end - 1; index >= offset + Math.floor(limit / 2); index--) {
        if (/[。！？.!?；;\s]/u.test(text[index]!)) { end = index + 1; break; }
      }
      if (/[\uD800-\uDBFF]/.test(text[end - 1]!) && /[\uDC00-\uDFFF]/.test(text[end]!)) end--;
    }
    chunks.push(text.slice(offset, end));
    offset = end;
  }
  return chunks;
}
