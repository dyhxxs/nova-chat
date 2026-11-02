import { describe, expect, it } from 'vitest';
import { createStudyState, dueStudyCards, getStudyDeck, gradeStudyCard, normalizeStudyState, studySummary } from '../src/lib/studyDeck';

describe('language study deck', () => {
  it('provides independent English and Cantonese content packs', () => {
    expect(getStudyDeck('english').length).toBeGreaterThanOrEqual(40);
    expect(getStudyDeck('english')[0]?.kind).toBe('vocabulary');
    expect(getStudyDeck('cantonese').length).toBeGreaterThanOrEqual(10);
    expect(getStudyDeck('cantonese')[0]?.kind).toBe('pronunciation');
  });

  it('grades a correct answer into a future review interval', () => {
    const now = Date.now();
    const state = createStudyState('english');
    const first = dueStudyCards('english', state, now)[0]!;
    const next = gradeStudyCard('english', state, first.id, 4, now);
    const progress = next.cards.find((item) => item.cardId === first.id)!;
    expect(progress.repetitions).toBe(1);
    expect(progress.intervalDays).toBe(1);
    expect(progress.dueAt).toBe(now + 86_400_000);
    expect(studySummary('english', next, now).learned).toBe(1);
  });

  it('keeps an incorrect answer due immediately and normalizes old or unknown cards', () => {
    const now = Date.UTC(2026, 0, 1);
    const state = createStudyState('cantonese');
    const first = state.cards[0]!;
    const next = gradeStudyCard('cantonese', state, first.cardId, 1, now);
    expect(next.cards[0]?.dueAt).toBe(now);
    const normalized = normalizeStudyState('cantonese', { cards: [{ cardId: 'missing', dueAt: 1 }], streak: 2 });
    expect(normalized.cards).toHaveLength(getStudyDeck('cantonese').length);
    expect(normalized.streak).toBe(2);
  });
});
