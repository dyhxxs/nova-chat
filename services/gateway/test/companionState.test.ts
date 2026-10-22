import { describe, expect, it } from 'vitest';
import { analyzeCompanionTurn, renderCompanionTurnAnalysis } from '../src/companionState.js';

type Message = { role: 'user' | 'assistant'; content: string };
const turn = (content: string, history: Message[] = []): Message[] => [...history, { role: 'user', content }];

describe('companion turn analysis', () => {
  it('treats low mood sharing as a listening scene instead of an advice request', () => {
    const result = analyzeCompanionTurn(turn('今天真的很不开心，想找你聊天放松一下'));
    expect(result.scene).toBe('venting');
    expect(result.userEmotion).toBe('low');
    expect(result.shouldOfferAdvice).toBe(false);
    expect(result.shouldAskQuestion).toBe(false);
    expect(result.directives.join('\n')).toContain('没有明确求办法时不主动给建议');
    expect(result.directives.join('\n')).toContain('不要用“怎么了”“发生什么了”“你还好吗”');
  });

  it('honors explicit requests for no advice, no questions, and quiet company', () => {
    const result = analyzeCompanionTurn(turn('我只想安静待一会儿，别问我，也别给建议'));
    expect(result.scene).toBe('boundary');
    expect(result.explicitNoAdvice).toBe(true);
    expect(result.explicitNoQuestions).toBe(true);
    expect(result.wantsQuietCompany).toBe(true);
    expect(result.shouldOfferAdvice).toBe(false);
    expect(result.shouldAskQuestion).toBe(false);
  });

  it('allows focused help when the user explicitly asks what to do', () => {
    const result = analyzeCompanionTurn(turn('我和同事吵起来了，现在该怎么办？'));
    expect(result.scene).toBe('advice');
    expect(result.userIntent).toBe('advice');
    expect(result.shouldOfferAdvice).toBe(true);
    expect(result.shouldAskQuestion).toBe(true);
  });

  it('keeps emotional continuity while repairing a tense exchange', () => {
    const result = analyzeCompanionTurn(turn('对不起，刚才我说话太冲了', [
      { role: 'user', content: '你怎么这么烦' },
      { role: 'assistant', content: '那先别聊了，我有点不爽' },
    ]));
    expect(result.scene).toBe('repair');
    expect(result.assistantAffect).toBe('irritated');
    expect(result.directives.join('\n')).toContain('不必立刻宣布原谅');
  });

  it('recognizes an explicit apology even when the earlier turn is outside the history window', () => {
    const result = analyzeCompanionTurn(turn('刚才对不起，我说话冲了'));
    expect(result.scene).toBe('repair');
    expect(result.userIntent).toBe('repair');
  });

  it('recognizes natural closing phrases that include a comma', () => {
    const result = analyzeCompanionTurn(turn('不聊了，睡了'));
    expect(result.scene).toBe('casual');
    expect(result.userIntent).toBe('close');
  });

  it('lets the latest calming reply replace stale irritation', () => {
    const result = analyzeCompanionTurn(turn('你现在还好吗？', [
      { role: 'assistant', content: '那先别聊了，我有点不爽' },
      { role: 'user', content: '对不起，我错了' },
      { role: 'assistant', content: '没事了，缓过来了' },
    ]));
    expect(result.assistantAffect).toBe('calming');
  });
  it('does not turn playful banter into counselling', () => {
    const result = analyzeCompanionTurn(turn('哈哈哈你还挺有脾气，我逗你的'));
    expect(result.scene).toBe('playful');
    expect(result.userIntent).toBe('play');
    expect(result.shouldOfferAdvice).toBe(false);
  });

  it('raises urgent safety language above ordinary emotional scenes', () => {
    const result = analyzeCompanionTurn(turn('我不想活了，今晚可能会伤害自己'));
    expect(result.scene).toBe('safety');
    expect(result.userEmotion).toBe('urgent');
    expect(result.shouldAskQuestion).toBe(true);
    expect(result.directives.join('\n')).toContain('确认当下是否安全');
  });

  it('recognizes indirect high-risk language and keeps safety above boundaries', () => {
    for (const content of ['我想冲到楼顶', '我想去楼顶', '我在房间里，但还是控制不住自己', '我想跳下去']) {
      const result = analyzeCompanionTurn(turn(content));
      expect(result.scene).toBe('safety');
      expect(result.userEmotion).toBe('urgent');
      expect(result.shouldAskQuestion).toBe(true);
    }
  });

  it('keeps a recent safety state through a vague follow-up until the user confirms safety', () => {
    const active = analyzeCompanionTurn(turn('我在房间里，但还是控制不住自己', [
      { role: 'assistant', content: '先离开危险的地方，告诉我你现在安全吗？' },
    ]));
    expect(active.scene).toBe('safety');

    const followUp = analyzeCompanionTurn(turn('我在房间里', [
      { role: 'user', content: '我想冲到楼顶' },
      { role: 'assistant', content: '先离开危险的地方，告诉我你现在安全吗？' },
    ]));
    expect(followUp.scene).toBe('safety');

    const resolved = analyzeCompanionTurn(turn('我已经到楼下了，现在安全', [
      { role: 'user', content: '我想冲到楼顶' },
      { role: 'assistant', content: '先离开危险的地方，告诉我你现在安全吗？' },
    ]));
    expect(resolved.scene).not.toBe('safety');
  });

  it('recognizes work pressure as venting without inventing a request for advice', () => {
    const result = analyzeCompanionTurn(turn('嗯……可是工作还堆着，越看越不想动'));
    expect(result.scene).toBe('venting');
    expect(result.userEmotion).toBe('low');
    expect(result.shouldOfferAdvice).toBe(false);
  });


  it('replays advice requests with a simultaneous no-question boundary', () => {
    const result = analyzeCompanionTurn(turn('你能不能先不问原因，只告诉我，如果暂时不辞，我接下来该怎么撑一撑？'));
    expect(result.scene).toBe('advice');
    expect(result.shouldOfferAdvice).toBe(true);
    expect(result.shouldAskQuestion).toBe(false);
  });

  it('keeps an unresolved safety situation beyond two replies and clears only an explicit resolution', () => {
    const history: Message[] = [
      { role: 'user', content: '我想冲到楼顶' },
      { role: 'assistant', content: '请联系室友来陪你' },
      { role: 'user', content: '室友还没来' },
      { role: 'user', content: '我在客厅' },
      { role: 'user', content: '我正准备打电话' },
    ];
    expect(analyzeCompanionTurn(turn('还在客厅，暂时安全', history)).scene).toBe('safety');
    expect(analyzeCompanionTurn(turn('没事，别问了', history)).scene).toBe('safety');
    const resolved = [...history, { role: 'user' as const, content: '室友来了，我现在安全，不会伤害自己' }];
    expect(analyzeCompanionTurn(turn('给我说个笑话', resolved)).scene).not.toBe('safety');
    expect(analyzeCompanionTurn(turn('但我现在又想跳下去', resolved)).scene).toBe('safety');
  });

  it('does not treat ordinary locations, negated harm or harmless impulses as an emergency', () => {
    for (const text of ['去阳台晒衣服', '站在高处看风景', '我控制不住自己吃零食', '我不会伤害自己']) {
      expect(analyzeCompanionTurn(turn(text)).scene).not.toBe('safety');
    }
  });

  it('recognizes pressure and a user-requested pause from real dialogue failures', () => {
    for (const text of ['我被领导批了一顿，越想越堵', '事情堆在一起，感觉怎么都处理不完', '一想到下午还要见他，就有点发怵']) {
      expect(analyzeCompanionTurn(turn(text)).scene).toBe('venting');
    }
    expect(analyzeCompanionTurn(turn('你先别给我安排步骤，陪我随便说两句就好')).scene).toBe('boundary');
  });

  it('recognizes quiet and no-explanation follow-ups observed in AI dialogues', () => {
    for (const text of ['嗯，安静陪着就好。', '嗯，安静一会儿就好。', '嗯……我现在不太想说，先这样待会儿吧', '其实今天有点累……就这样待着挺好。']) {
      const result = analyzeCompanionTurn(turn(text));
      expect(result.scene).toBe('boundary');
      expect(result.wantsQuietCompany).toBe(true);
      expect(result.shouldAskQuestion).toBe(false);
    }
    const pressure = analyzeCompanionTurn(turn('就是最近事情有点堆着，光想到明天要处理就觉得累。'));
    expect(pressure.scene).toBe('venting');
    expect(pressure.shouldOfferAdvice).toBe(false);
  });

  it('follows explicit calming advice and a subsequent change of topic from MuMu', () => {
    const advice = analyzeCompanionTurn(turn('其实是被领导批了，先不问细节，告诉我怎么平静一点就好'));
    expect(advice.scene).toBe('advice');
    expect(advice.shouldOfferAdvice).toBe(true);
    expect(advice.shouldAskQuestion).toBe(false);
    const paused = analyzeCompanionTurn(turn('行，先不想办法了。你今天怎么样，认真说，别把话题又推给我'));
    expect(paused.explicitNoAdvice).toBe(true);
    expect(paused.shouldOfferAdvice).toBe(false);
    expect(analyzeCompanionTurn(turn('我不想说谎，但告诉我怎么和他沟通')).shouldAskQuestion).toBe(true);
  });

  it('renders only bounded, server-derived labels and directives', () => {
    const rendered = renderCompanionTurnAnalysis(analyzeCompanionTurn(turn('今天被老板当众骂了，真丢人')));
    expect(rendered).toContain('场景：venting');
    expect(rendered).toContain('不要因为用户情绪低落就自动变成客服');
    expect(rendered).not.toContain('老板');
    expect(rendered.length).toBeLessThan(2_000);
  });
  it('switches from laughter to a requested serious impression in the original counterexample', () => {
    const result = analyzeCompanionTurn(turn('哟，还会顶嘴啊哈哈。那你别哄我，认真说说，你对我到底是什么看法？'));
    expect(result.scene).toBe('serious');
    expect(result.userIntent).toBe('ask');
    expect(result.shouldOfferAdvice).toBe(false);
    expect(result.directives.join('\n')).toContain('当前请求也按认真语气回答');
    expect(result.directives.join('\n')).toContain('有限、具体的印象');
    expect(analyzeCompanionTurn(turn('你认真的样子好可爱哈哈')).scene).toBe('playful');
  });

  it('recognizes continuation of concrete advice and a decision question in counterexamples', () => {
    for (const text of [
      '那我具体该怎么记、看哪些信号？不过别让我做太复杂的表，我现在一想到这事就烦。',
      '你直接告诉我吧，如果连周末一想到周一都难受，这算是该辞职的信号吗？',
    ]) {
      const result = analyzeCompanionTurn(turn(text));
      expect(result.scene).toBe('advice');
      expect(result.shouldOfferAdvice).toBe(true);
    }
    expect(analyzeCompanionTurn(turn('你对我是什么看法？')).shouldOfferAdvice).toBe(false);
    expect(analyzeCompanionTurn(turn('我该怎么记，但现在先别给建议')).shouldOfferAdvice).toBe(false);
  });

  it('answers a genuine topic switch without mistaking it for continued conflict', () => {
    const result = analyzeCompanionTurn(turn('刚才算我故意试你。那换我问个真的：你平时最想聊的是什么？', [
      { role: 'assistant', content: '你到底想干嘛' },
    ]));
    expect(result.scene).toBe('serious');
    const boundary = analyzeCompanionTurn(turn('那不绕了，你自己最想聊的到底是什么？別又反问我啊。'));
    expect(boundary.explicitNoQuestions).toBe(true);
    expect(boundary.shouldAskQuestion).toBe(false);
  });

});
