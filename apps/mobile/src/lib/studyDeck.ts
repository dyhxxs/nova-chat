import type { LearningLanguageId } from './languageLearning';

/** Versioned, client-safe content item. A future server catalog can use the same shape. */
export type StudyCard = {
  id: string;
  kind: 'vocabulary' | 'pronunciation';
  prompt: string;
  answer: string;
  meaning: string;
  phonetic: string;
  example: string;
  exampleMeaning: string;
  options: string[];
};

export type StudyProgress = {
  cardId: string;
  dueAt: number;
  intervalDays: number;
  repetitions: number;
  ease: number;
  lapses: number;
  lastScore?: number;
  lastReviewedAt?: number;
};

export type StudyState = {
  contentVersion: string;
  cards: StudyProgress[];
  reviewedToday: number;
  correctToday: number;
  lastStudyDay?: string;
  streak: number;
};

// The pack is deliberately data-only. It can be replaced by a server catalog
// without changing the review engine or the screen. These are common CET-4
// study words, with examples short enough for a phone screen and TTS.
type EnglishRow = readonly [string, string, string, string, string];
const CET4_ROWS: EnglishRow[] = [
  ['abandon', '放弃；遗弃', '/əˈbændən/', 'The team refused to abandon the plan.', '团队拒绝放弃这个计划。'],
  ['accurate', '准确的', '/ˈækjərət/', 'Please give me an accurate address.', '请给我一个准确的地址。'],
  ['adapt', '适应；改编', '/əˈdæpt/', 'Children adapt quickly to a new school.', '孩子很快就能适应新学校。'],
  ['ambition', '抱负；野心', '/æmˈbɪʃən/', 'Her ambition is to become a doctor.', '她的抱负是成为一名医生。'],
  ['analyze', '分析', '/ˈænəlaɪz/', 'Let us analyze the problem together.', '我们一起分析这个问题。'],
  ['approach', '方法；接近', '/əˈproʊtʃ/', 'We need a different approach.', '我们需要换一种方法。'],
  ['benefit', '益处；受益', '/ˈbenɪfɪt/', 'Exercise can benefit your health.', '运动有益于健康。'],
  ['challenge', '挑战；质疑', '/ˈtʃælɪndʒ/', 'Learning a language is a challenge.', '学习一门语言是一项挑战。'],
  ['circumstance', '情况；环境', '/ˈsɜːrkəmstæns/', 'Under these circumstances, we should wait.', '在这种情况下，我们应该等待。'],
  ['communicate', '交流；沟通', '/kəˈmjuːnɪkeɪt/', 'Try to communicate clearly.', '尽量清楚地沟通。'],
  ['concentrate', '集中；专心', '/ˈkɑːnsəntreɪt/', 'I cannot concentrate in a noisy room.', '在嘈杂的房间里我无法集中注意力。'],
  ['confirm', '确认；证实', '/kənˈfɜːrm/', 'Please confirm your booking.', '请确认你的预订。'],
  ['consequence', '后果', '/ˈkɑːnsəkwens/', 'Every choice has a consequence.', '每个选择都有后果。'],
  ['consume', '消耗；消费', '/kənˈsuːm/', 'This machine consumes less energy.', '这台机器消耗更少的能源。'],
  ['convenient', '方便的', '/kənˈviːniənt/', 'Online banking is very convenient.', '网上银行非常方便。'],
  ['curious', '好奇的', '/ˈkjʊriəs/', 'I am curious about your idea.', '我很好奇你的想法。'],
  ['debate', '辩论；争论', '/dɪˈbeɪt/', 'The students held a debate.', '学生们进行了一场辩论。'],
  ['decline', '下降；拒绝', '/dɪˈklaɪn/', 'Sales began to decline last year.', '销售额去年开始下降。'],
  ['demonstrate', '证明；展示', '/ˈdemənstreɪt/', 'Can you demonstrate how it works?', '你能演示它如何工作吗？'],
  ['efficient', '高效的', '/ɪˈfɪʃənt/', 'This is a simple and efficient method.', '这是一个简单高效的方法。'],
  ['emerge', '出现；浮现', '/ɪˈmɜːrdʒ/', 'A clear pattern began to emerge.', '一个清晰的规律开始出现。'],
  ['essential', '必要的；本质的', '/ɪˈsenʃəl/', 'Sleep is essential for learning.', '睡眠对学习很重要。'],
  ['establish', '建立；确立', '/ɪˈstæblɪʃ/', 'They established a new company.', '他们成立了一家新公司。'],
  ['evaluate', '评估', '/ɪˈvæljueɪt/', 'We need to evaluate the results.', '我们需要评估结果。'],
  ['evidence', '证据', '/ˈevɪdəns/', 'There is no evidence of fraud.', '没有欺诈的证据。'],
  ['flexible', '灵活的', '/ˈfleksəbəl/', 'My schedule is flexible today.', '我今天的时间安排很灵活。'],
  ['generate', '产生；生成', '/ˈdʒenəreɪt/', 'The project may generate new jobs.', '这个项目可能创造新的工作。'],
  ['impact', '影响；冲击', '/ˈɪmpækt/', 'The news had a big impact on me.', '这条消息对我影响很大。'],
  ['indicate', '表明；指出', '/ˈɪndɪkeɪt/', 'The sign indicates the right direction.', '这个标志指示正确方向。'],
  ['maintain', '维持；保养', '/meɪnˈteɪn/', 'It is hard to maintain focus all day.', '整天保持专注很难。'],
  ['motivate', '激励；促使', '/ˈmoʊtɪveɪt/', 'Small goals motivate me to continue.', '小目标激励我继续前进。'],
  ['obtain', '获得', '/əbˈteɪn/', 'You need permission to obtain the file.', '你需要许可才能获取文件。'],
  ['participate', '参加', '/pɑːrˈtɪsɪpeɪt/', 'Everyone can participate in the discussion.', '每个人都可以参加讨论。'],
  ['potential', '潜力；潜在的', '/pəˈtenʃəl/', 'She has great potential.', '她很有潜力。'],
  ['precise', '精确的', '/prɪˈsaɪs/', 'Give me a precise time.', '告诉我准确的时间。'],
  ['priority', '优先事项', '/praɪˈɔːrəti/', 'Safety is our first priority.', '安全是我们的第一优先事项。'],
  ['require', '需要；要求', '/rɪˈkwaɪər/', 'This job requires patience.', '这份工作需要耐心。'],
  ['respond', '回应；响应', '/rɪˈspɑːnd/', 'Please respond before Friday.', '请在周五前回复。'],
  ['significant', '重要的；显著的', '/sɪɡˈnɪfɪkənt/', 'The change made a significant difference.', '这项变化带来了明显的差异。'],
  ['strategy', '策略', '/ˈstrætədʒi/', 'We need a better learning strategy.', '我们需要更好的学习策略。'],
  ['sufficient', '足够的', '/səˈfɪʃənt/', 'Do we have sufficient time?', '我们有足够的时间吗？'],
  ['temporary', '暂时的', '/ˈtempəreri/', 'This is only a temporary solution.', '这只是暂时的解决办法。'],
  ['typical', '典型的；通常的', '/ˈtɪpɪkəl/', 'That is a typical beginner mistake.', '那是初学者常见的错误。'],
  ['vary', '变化；不同', '/ˈveri/', 'Prices vary from shop to shop.', '价格因店而异。'],
  ['accurate', '准确的', '/ˈækjərət/', 'Accurate pronunciation takes practice.', '准确的发音需要练习。'],
  ['attitude', '态度', '/ˈætɪtuːd/', 'A positive attitude helps you learn.', '积极的态度有助于学习。'],
  ['confidence', '信心', '/ˈkɑːnfɪdəns/', 'Practice builds confidence.', '练习能建立信心。'],
  ['contribute', '贡献；促成', '/kənˈtrɪbjuːt/', 'Every member can contribute an idea.', '每个成员都可以贡献一个想法。'],
  ['distinguish', '区分；辨别', '/dɪˈstɪŋɡwɪʃ/', 'Can you distinguish these two sounds?', '你能分辨这两个声音吗？'],
];
const CET4_WORDS: StudyCard[] = CET4_ROWS.map(([prompt, meaning, phonetic, example, exampleMeaning], index) => ({
  id: `cet4-${index + 1}-${prompt}`,
  kind: 'vocabulary' as const,
  prompt, answer: prompt, meaning, phonetic, example, exampleMeaning,
  options: [],
}));

type CantoneseRow = readonly [string, string, string, string, string, string];
const CANTONESE_ROWS: CantoneseRow[] = [
  ['早晨', 'zou2 san4', '早上好', 'zou2 san4', '早晨呀！', '早上好！'],
  ['食飯', 'sik6 faan6', '吃饭', 'sik6 faan6', '你食咗飯未呀？', '你吃饭了吗？'],
  ['飲茶', 'jam2 caa4', '喝茶；饮茶', 'jam2 caa4', '得閒一齊飲茶啦。', '有空一起喝茶吧。'],
  ['唔該', 'm4 goi1', '谢谢；劳驾', 'm4 goi1', '唔該借借。', '麻烦让一下。'],
  ['多謝', 'do1 ze6', '谢谢（感谢）', 'do1 ze6', '多謝你幫我。', '谢谢你帮我。'],
  ['幾多錢', 'gei2 do1 cin2', '多少钱', 'gei2 do1 cin2', '呢杯咖啡幾多錢？', '这杯咖啡多少钱？'],
  ['我唔明', 'ngo5 m4 ming4', '我不明白', 'ngo5 m4 ming4', '唔好意思，我唔明。', '不好意思，我不明白。'],
  ['慢慢講', 'maan6 maan6 gong2', '慢慢说', 'maan6 maan6 gong2', '你可以慢慢講。', '你可以慢慢说。'],
  ['好食', 'hou2 sik6', '好吃', 'hou2 sik6', '呢間餐廳啲嘢好食。', '这家餐厅的东西很好吃。'],
  ['好攰', 'hou2 gui6', '很累', 'hou2 gui6', '今日返工好攰。', '今天上班很累。'],
  ['得閒', 'dak1 haan4', '有空；闲暇', 'dak1 haan4', '你得閒先搵我啦。', '你有空再找我吧。'],
  ['拜拜', 'baai1 baai3', '再见', 'baai1 baai3', '聽日見，拜拜！', '明天见，再见！'],
];
const CANTONESE_PRONUNCIATION: StudyCard[] = CANTONESE_ROWS.map(([prompt, answer, meaning, phonetic, example, exampleMeaning], index) => ({
  id: `canto-${index + 1}`,
  kind: 'pronunciation' as const,
  prompt, answer, meaning, phonetic, example, exampleMeaning,
  options: [],
}));

export function getStudyDeck(languageId: LearningLanguageId): readonly StudyCard[] {
  return languageId === 'english' ? CET4_WORDS : CANTONESE_PRONUNCIATION;
}

function dayKey(timestamp = Date.now()): string { return new Date(timestamp).toISOString().slice(0, 10); }

function optionsFor(card: StudyCard, deck: readonly StudyCard[]): string[] {
  const value = (item: StudyCard) => item.kind === 'vocabulary' ? item.meaning : item.phonetic;
  const others = deck.filter((item) => item.id !== card.id).map(value).slice(0, 3);
  return [value(card), ...others].sort((a, b) => a.localeCompare(b));
}

export function createStudyState(languageId: LearningLanguageId): StudyState {
  const deck = getStudyDeck(languageId);
  return {
    contentVersion: languageId === 'english' ? 'cet4-core-2026-01' : 'cantonese-pronunciation-2026-01',
    cards: deck.map((card, index) => ({ cardId: card.id, dueAt: Date.now() + index * 1_000, intervalDays: 0, repetitions: 0, ease: 2.5, lapses: 0 })),
    reviewedToday: 0, correctToday: 0, streak: 0,
  };
}

export function normalizeStudyState(languageId: LearningLanguageId, value: unknown): StudyState {
  const fallback = createStudyState(languageId);
  if (!value || typeof value !== 'object') return fallback;
  const item = value as Partial<StudyState>;
  const known = new Set(getStudyDeck(languageId).map((card) => card.id));
  const saved = Array.isArray(item.cards) ? item.cards.filter((card): card is StudyProgress => Boolean(card && typeof card === 'object' && known.has((card as StudyProgress).cardId))).map((card) => ({
    cardId: card.cardId, dueAt: typeof card.dueAt === 'number' ? card.dueAt : Date.now(), intervalDays: typeof card.intervalDays === 'number' ? Math.max(0, card.intervalDays) : 0,
    repetitions: typeof card.repetitions === 'number' ? Math.max(0, card.repetitions) : 0, ease: typeof card.ease === 'number' ? Math.max(1.3, card.ease) : 2.5,
    lapses: typeof card.lapses === 'number' ? Math.max(0, card.lapses) : 0, lastScore: typeof card.lastScore === 'number' ? card.lastScore : undefined, lastReviewedAt: typeof card.lastReviewedAt === 'number' ? card.lastReviewedAt : undefined,
  })) : [];
  const byId = new Map(saved.map((card) => [card.cardId, card]));
  return {
    ...fallback, ...item,
    cards: fallback.cards.map((card) => byId.get(card.cardId) ?? card),
    reviewedToday: typeof item.reviewedToday === 'number' ? Math.max(0, item.reviewedToday) : 0,
    correctToday: typeof item.correctToday === 'number' ? Math.max(0, item.correctToday) : 0,
    streak: typeof item.streak === 'number' ? Math.max(0, item.streak) : 0,
  };
}

export function dueStudyCards(languageId: LearningLanguageId, state: StudyState, now = Date.now()): StudyCard[] {
  const deck = getStudyDeck(languageId);
  const progress = new Map(state.cards.map((item) => [item.cardId, item]));
  return deck.filter((card) => (progress.get(card.id)?.dueAt ?? 0) <= now).sort((a, b) => (progress.get(a.id)!.dueAt - progress.get(b.id)!.dueAt)).map((card) => ({ ...card, options: optionsFor(card, deck) }));
}

export function gradeStudyCard(languageId: LearningLanguageId, state: StudyState, cardId: string, score: number, now = Date.now()): StudyState {
  const card = state.cards.find((item) => item.cardId === cardId);
  if (!card) return state;
  const correct = score >= 3;
  const intervalDays = correct ? (card.repetitions === 0 ? 1 : card.repetitions === 1 ? 3 : Math.max(1, Math.round(card.intervalDays * card.ease))) : 0;
  const nextEase = Math.max(1.3, card.ease + (correct ? 0.05 : -0.2));
  const next: StudyProgress = { ...card, dueAt: now + intervalDays * 86_400_000, intervalDays, repetitions: correct ? card.repetitions + 1 : 0, ease: nextEase, lapses: card.lapses + (correct ? 0 : 1), lastScore: score, lastReviewedAt: now };
  const today = dayKey(now);
  const sameDay = state.lastStudyDay === today;
  return { ...state, cards: state.cards.map((item) => item.cardId === cardId ? next : item), reviewedToday: sameDay ? state.reviewedToday + 1 : 1, correctToday: sameDay ? state.correctToday + (correct ? 1 : 0) : correct ? 1 : 0, lastStudyDay: today, streak: sameDay ? state.streak : state.streak + 1 };
}

export function studySummary(languageId: LearningLanguageId, state: StudyState, now = Date.now()) {
  const deckSize = getStudyDeck(languageId).length;
  const due = dueStudyCards(languageId, state, now).length;
  const learned = state.cards.filter((card) => card.repetitions > 0).length;
  return { deckSize, due, learned, reviewedToday: state.reviewedToday, correctToday: state.correctToday, accuracy: state.reviewedToday ? Math.round(state.correctToday / state.reviewedToday * 100) : 0, streak: state.streak };
}
