import { describe, expect, it } from 'vitest';
import { MAX_SPEECH_SOURCE_CHARS, MAX_SPEECH_TEXT_CHARS, prepareSpeechText, splitSpeechText } from '../src/lib/speechText';

describe('bounded prose preparation for explicit read-aloud', () => {
  it('keeps Chinese, English and numbers readable', () => {
    expect(prepareSpeechText('长沙今天适合散步。\nHello world! 42').text).toBe('长沙今天适合散步。\nHello world! 42');
  });
  it('omits fenced code, links, images and source labels', () => {
    const text = prepareSpeechText('# 说明\n正文 **重点** [资料1]\n```js\nsecret()\n```\n[官网](https://example.test/?token=hidden) ![图](https://example.test/image)\n结尾').text;
    expect(text).toContain('正文 重点'); expect(text).toContain('官网'); expect(text).toContain('结尾');
    for (const forbidden of ['secret', 'hidden', 'https', '资料1', '```', 'example']) expect(text).not.toContain(forbidden);
  });
  it('does not close a long fence with a shorter fence or a different marker', () => {
    expect(prepareSpeechText('前言\n````js\n```\nsecret\n~~~\nmore secret\n````\n结尾').text).toBe('前言\n结尾');
  });
  it('omits an unclosed fence through the end rather than reading code', () => {
    expect(prepareSpeechText('可读\n~~~\n不可读').text).toBe('可读');
  });
  it('omits indented code and reference destinations', () => {
    const text = prepareSpeechText('可读 [说明][ref]\n[ref]: https://example.test/private\n    secret\n\tsecret2').text;
    expect(text).toBe('可读 说明');
  });
  it.each(['', '  \n ', '![image](https://example.test/a)', '```\nonly code\n```', '---'])('rejects prose-free input %j', input => {
    expect(() => prepareSpeechText(input)).toThrow('没有可朗读');
  });
  it('handles long unmatched markdown delimiters without quadratic label scanning', () => {
    expect(() => prepareSpeechText('['.repeat(100000) + '正文')).toThrow('超过3万');
    expect(() => prepareSpeechText('![x]('.repeat(15000) + '正文')).toThrow('超过3万');
  });
  it('rejects source and prose limits instead of silently truncating', () => {
    expect(() => prepareSpeechText('字'.repeat(MAX_SPEECH_SOURCE_CHARS + 1))).toThrow('回复过长');
    expect(() => prepareSpeechText('字'.repeat(MAX_SPEECH_TEXT_CHARS + 1))).toThrow('超过3万');
    expect(prepareSpeechText('字'.repeat(MAX_SPEECH_TEXT_CHARS)).text.length).toBe(MAX_SPEECH_TEXT_CHARS);
  });
  it('keeps source content untouched and does not claim to redact secrets', () => {
    const content = '我的密码是示例文字。';
    expect(prepareSpeechText(content)).toEqual({ text: content, simplified: false });
  });
  it('bounds chunks by platform limit without dropping spaces or surrogate pairs', () => {
    const text = '😀中文 sentence. '.repeat(90);
    for (const limit of [2, 3, 17, 200, 4000]) {
      const chunks = splitSpeechText(text, limit);
      expect(chunks.join('')).toBe(text);
      expect(chunks.every(chunk => chunk.length <= Math.min(limit, 200) && chunk.length > 0 && chunk.isWellFormed())).toBe(true);
    }
  });
  it('prefers a sentence or word boundary in the latter half of a chunk', () => {
    expect(splitSpeechText('第一句话。第二句话。第三句话。', 8)[0]).toBe('第一句话。');
  });
  it.each([0, 1, -1, NaN, Infinity])('rejects invalid platform bound %s', limit => {
    expect(() => splitSpeechText('hello', limit)).toThrow();
  });
});
