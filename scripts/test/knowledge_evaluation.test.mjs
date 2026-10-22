import assert from 'node:assert/strict';
import test from 'node:test';
import { compareKnowledgeReports, evaluateKnowledgeCases, percentile, renderKnowledgeComparisonMarkdown, renderKnowledgeEvaluationMarkdown } from '../knowledge_evaluation.mjs';

test('knowledge evaluation reports recall, refusal and source precision separately', () => {
  const store = {
    search(_userId, query) {
      if (query === 'known') return { sources: [{ documentId: 'doc-a' }, { documentId: 'noise' }] };
      if (query === 'cross') return { sources: [{ documentId: 'doc-a' }, { documentId: 'doc-b' }] };
      return { sources: [] };
    },
  };
  const report = evaluateKnowledgeCases(store, 'user', [
    { id: 'a', category: 'answerable_single', query: 'known', expectedSourceIds: ['doc-a'] },
    { id: 'b', category: 'answerable_cross', query: 'cross', expectedSourceIds: ['doc-a', 'doc-b'] },
    { id: 'c', category: 'refusal', query: 'unknown', expectedSourceIds: [] },
  ], (() => {
    let tick = 0;
    return () => (tick += 1);
  })());
  assert.equal(report.summary.recallAt5, 1);
  assert.equal(report.summary.refusalAccuracy, 1);
  assert.equal(report.summary.citationAccuracy, 0.75);
  assert.equal(report.failures.length, 0);
  assert.match(renderKnowledgeEvaluationMarkdown({ synthetic: true, description: 'test' }, report), /Recall@5/);
});

test('percentile handles empty and ordered samples', () => {
  assert.equal(percentile([], 95), 0);
  assert.equal(percentile([5, 1, 3], 95), 5);
});


test('knowledge evaluation can compare strategies using the same report shape', () => {
  const store = { search(_userId, query) {
    return { sources: query === 'known' ? [{ documentId: 'doc-a' }] : [] };
  } };
  const lexical = evaluateKnowledgeCases(store, 'user', [{ id: 'a', category: 'answerable_single', query: 'known', expectedSourceIds: ['doc-a'] }]);
  const bm25 = evaluateKnowledgeCases(store, 'user', [{ id: 'a', category: 'answerable_single', query: 'known', expectedSourceIds: ['doc-a'] }], undefined, 'bm25');
  const comparison = compareKnowledgeReports({ lexical, bm25 });
  assert.equal(comparison.delta.recallAt5, 0);
  assert.match(renderKnowledgeComparisonMarkdown({ synthetic: true, description: 'test' }, comparison), /BM25 - lexical/);
});
