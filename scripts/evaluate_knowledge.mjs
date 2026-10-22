import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { KnowledgeStore } from '../services/gateway/src/knowledge.ts';
import { compareKnowledgeReports, evaluateKnowledgeCases, renderKnowledgeComparisonMarkdown, renderKnowledgeEvaluationMarkdown } from './knowledge_evaluation.mjs';

const { values } = parseArgs({ options: {
  dataset: { type: 'string', default: 'docs/evaluation/knowledge_eval.json' },
  'output-dir': { type: 'string', default: 'artifacts/knowledge-evaluation' },
  strategy: { type: 'string', default: 'lexical' },
}, strict: true, allowPositionals: false });

const datasetPath = path.resolve(values.dataset);
const outputDir = path.resolve(values['output-dir']);
const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
if (dataset.synthetic !== true) throw new Error('evaluation_dataset_must_be_marked_synthetic');
if (!Array.isArray(dataset.documents) || !Array.isArray(dataset.cases)) throw new Error('invalid_evaluation_dataset');
if (!['lexical', 'bm25', 'compare'].includes(values.strategy)) throw new Error('strategy_must_be_lexical_bm25_or_compare');

const database = new DatabaseSync(':memory:');
database.exec("PRAGMA foreign_keys = ON; CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users(id) VALUES ('knowledge-evaluation-user');");
try {
  const store = new KnowledgeStore(database);
  const userId = 'knowledge-evaluation-user';
  for (const document of dataset.documents) {
    const inserted = store.save(userId, document.title, document.text, document.sourceName).document;
    database.prepare('UPDATE knowledge_documents SET id=? WHERE id=?').run(document.id, inserted.id);
    database.prepare('UPDATE knowledge_index SET document_id=? WHERE document_id=?').run(document.id, inserted.id);
  }
  const run = strategy => evaluateKnowledgeCases(store, userId, dataset.cases, undefined, strategy);
  const report = values.strategy === 'compare'
    ? compareKnowledgeReports({ lexical: run('lexical'), bm25: run('bm25') })
    : run(values.strategy);
  await mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, 'report.json');
  const markdownPath = path.join(outputDir, 'report.md');
  await writeFile(jsonPath, `${JSON.stringify({ ...report, dataset: { path: datasetPath, synthetic: dataset.synthetic, documentCount: dataset.documents.length } }, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, values.strategy === 'compare' ? renderKnowledgeComparisonMarkdown(dataset, report) : renderKnowledgeEvaluationMarkdown(dataset, report), 'utf8');
  console.log(JSON.stringify({ output: { json: jsonPath, markdown: markdownPath }, strategy: values.strategy, summary: values.strategy === 'compare' ? { lexical: report.strategies.lexical.summary, bm25: report.strategies.bm25.summary, delta: report.delta } : report.summary }, null, 2));
} finally {
  database.close();
}
