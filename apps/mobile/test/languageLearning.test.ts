import { describe, expect, it } from 'vitest';
import { turnsForLearningMode, type LearningTurn } from '../src/lib/languageLearning';

const turn = (id: string, mode?: LearningTurn['mode']): LearningTurn => ({
  id,
  role: 'assistant',
  text: id,
  mode,
  createdAt: 1,
});

describe('language learning mode history', () => {
  it('keeps conversation and translation turns separate', () => {
    const turns = [turn('conversation', 'conversation'), turn('translation', 'translate')];
    expect(turnsForLearningMode(turns, 'conversation').map((item) => item.id)).toEqual(['conversation']);
    expect(turnsForLearningMode(turns, 'translate').map((item) => item.id)).toEqual(['translation']);
  });

  it('keeps legacy untagged turns in conversation mode only', () => {
    const turns = [turn('legacy')];
    expect(turnsForLearningMode(turns, 'conversation')).toHaveLength(1);
    expect(turnsForLearningMode(turns, 'translate')).toHaveLength(0);
  });
});
