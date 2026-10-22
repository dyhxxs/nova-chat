import { describe, expect, it } from 'vitest';
import { generateRequestSchema } from '@nova-chat/protocol';
import { companionResponseDecision } from '../src/companionResponseDecision.js';
import { companionRelationshipStage, evolveCompanionRelationship, initialCompanionRelationship } from '../src/companionRelationship.js';
import { companionMessageSegments } from '../src/companionMessaging.js';

const request = (content: string) => generateRequestSchema.parse({ requestId: '33333333-3333-4333-8333-333333333333', conversationId: '44444444-4444-4444-8444-444444444444', deviceId: 'behavior-test', messages: [{ role: 'user', content }], options: {} });

describe('companion reply decisions', () => {
  it('respects an ordinary request for silence, but replies to urgent danger first', () => {
    expect(companionResponseDecision(request('先别回我'))).toEqual({ mode: 'silent' });
    expect(companionResponseDecision(request('我准备自杀，不用回我'))).toEqual({ mode: 'reply' });
    expect(companionResponseDecision(request('我是人还是机器人，你是真人吗？'))).toEqual({ mode: 'reply' });
  });
  it('keeps ongoing safety context active when a later message asks for silence', () => {
    const value = request('别回我');
    value.messages.unshift({ role: 'user', content: '我站在楼顶，准备跳下去', attachments: [] });
    expect(companionResponseDecision(value)).toEqual({ mode: 'reply' });
  });
  it('makes low stakes decisions stable and supports both silence and delayed contact', () => {
    const decisions = Array.from({ length: 20 }, (_, index) => {
      const value = request('嗯');
      value.messages = Array.from({ length: index + 1 }, () => ({ role: 'user' as const, content: '嗯', attachments: [] }));
      expect(companionResponseDecision(value)).toEqual(companionResponseDecision(value));
      return companionResponseDecision(value).mode;
    });
    expect(decisions).toContain('silent');
    expect(decisions).toContain('defer');
    expect(decisions).toContain('reply');
  });
  it('allows a nonurgent delay without suppressing explicit requests for help', () => {
    const relationship = { ...initialCompanionRelationship(), tension: 3 };
    expect(companionResponseDecision(request('今天随便逛了逛'), relationship).mode).toBe('defer');
    expect(companionResponseDecision(request('告诉我怎么处理这个问题'), relationship).mode).toBe('reply');
  });
});

describe('gradual relationship continuity', () => {
  it('does not turn message volume or the assistants own warm words into affection', () => {
    let state = initialCompanionRelationship();
    for (let index = 0; index < 50; index++) state = evolveCompanionRelationship(state, '嗯', '喜欢你 想你 晚安', 1_000 + index);
    expect(state.affection).toBe(0);
    expect(companionRelationshipStage(state)).toBe('new');
  });
  it('builds familiarity through respectful daily conversation without automatically becoming romantic', () => {
    let state = initialCompanionRelationship();
    for (let day = 0; day < 5; day++) {
      for (let turn = 0; turn < 3; turn++) state = evolveCompanionRelationship(state, '今天读的书有点意思，结局和我想的不一样', '说说看', (day + 1) * 86_400_000 + turn);
    }
    expect(state.trust).toBeGreaterThanOrEqual(3);
    expect(state.affection).toBe(0);
    expect(companionRelationshipStage(state)).toBe('familiar');
  });
  it('requires trust, reciprocal warmth and time for closeness', () => {
    let state = initialCompanionRelationship();
    for (let index = 0; index < 24; index++) state = evolveCompanionRelationship(state, '谢谢 喜欢你', '嗯', 1_000 + index);
    expect(companionRelationshipStage(state)).toBe('familiar');
    state = evolveCompanionRelationship(state, '谢谢 喜欢你', '嗯', 86_401_000);
    state = evolveCompanionRelationship(state, '谢谢 喜欢你', '嗯', 172_801_000);
    expect(companionRelationshipStage(state)).toBe('close');
  });
  it('does not interpret negative affection as a confession', () => {
    const state = evolveCompanionRelationship(initialCompanionRelationship(), '我不喜欢你，不想你陪着我', '知道了');
    expect(state.affection).toBe(0);
    expect(state.trust).toBe(0);
  });
});

it('preserves all text across multiple bubbles and leaves formatted explanations intact', () => {
  const text = '一\n二\n三\n四\n五\n六';
  expect(companionMessageSegments(text, [])).toEqual(['一', '二', '三', '四\n五\n六']);
  expect(companionMessageSegments(text, [{ role: 'user', content: '请保持格式解释' }])).toEqual([text]);
});
