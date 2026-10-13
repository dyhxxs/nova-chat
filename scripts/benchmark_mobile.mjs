/** Synthetic-only benchmark. Requires the workspace dev dependencies (tsx).
 * Run: npm run benchmark:mobile -- --output .run/mobile-performance.json
 * Optional historical comparison: --baseline-repository <local repository .ts>
 * Node timings / bridge payload counts are NOT Hermes or device measurements.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createSqliteSnapshotRepository } from '../apps/mobile/src/lib/sqliteSnapshotRepository.ts';
import { createConversationSelector } from '../apps/mobile/src/lib/conversationHistory.ts';
import { testSnapshotDatabase } from '../apps/mobile/test/helpers/snapshotDatabase.ts';

const { values } = parseArgs({ options: {
  output: { type: 'string' }, 'baseline-repository': { type: 'string' },
}, strict: true, allowPositionals: false });
const round = (value) => Math.round(value * 100) / 100;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const key = '@nova-chat/account/v1/synthetic:https%3A%2F%2Fbenchmark.invalid';
const body = JSON.stringify({ synthetic: true, text: '合成历史🙂'.repeat(430_000) });
const snapshotBytes = Buffer.byteLength(body);

async function measureStorage(factory) {
  const samples = [];
  let bridgeBodyReadBytes = 0; let legacyMarkerWrites = 0;
  const iterations = 8;
  for (let sample = 0; sample < 3; sample++) {
    const fixture = testSnapshotDatabase();
    const legacy = new Map(); let markers = 0;
    try {
      const repository = factory(async () => fixture.db, {
        getItem: async (id) => legacy.get(id) ?? null,
        setItem: async (id, value) => { markers++; legacy.set(id, value); },
      });
      // Initialize and warm up before measuring steady-state updates.
      await repository.setItem(key, body);
      await repository.setItem(key, body);
      fixture.metrics.bodyReadBytes = 0; markers = 0;
      const started = performance.now();
      for (let i = 0; i < iterations; i++) await repository.setItem(key, body + ' '.repeat(i % 2));
      samples.push(round(performance.now() - started));
      bridgeBodyReadBytes = fixture.metrics.bodyReadBytes; legacyMarkerWrites = markers;
      assert.equal(await repository.getItem(key), body + ' ');
    } finally { fixture.sql.close(); }
  }
  return { iterationsPerSample: iterations, samplesMs: samples, medianMs: median(samples),
    bridgeBodyReadBytesPerSample: bridgeBodyReadBytes, legacyMarkerWritesPerSample: legacyMarkerWrites };
}
function conversations(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: 'synthetic-' + i, title: '合成会话 ' + i, createdAt: i, updatedAt: i,
    pinned: i % 23 === 0, archived: i % 7 === 0,
    messages: Array.from({ length: 8 }, (_, j) => ({
      id: i + '-' + j, role: j % 2 ? 'assistant' : 'user', createdAt: j,
      status: 'complete', attachments: [], model: 'synthetic-model',
      content: ('这是合成文本，ＮＦＫＣ检索。topic' + i % 17 + ' ').repeat(12) + 'marker' + j,
    })),
  }));
}
function measureSearch(count) {
  const list = conversations(count);
  const queries = ['topic3', '合成 topic12', 'ＮＦＫＣ marker7', 'topic16 marker4', 'not-found', 'marker0'];
  const noCache = createConversationSelector(0);
  const bounded = createConversationSelector();
  for (const query of queries) assert.deepEqual(bounded(list, query, 'all').map((c) => c.id), noCache(list, query, 'all').map((c) => c.id));
  function run(selector) {
    const start = performance.now(); let matches = 0;
    for (let repeat = 0; repeat < 3; repeat++) for (const query of queries) matches += selector(list, query, 'all').length;
    return { elapsed: round(performance.now() - start), matches };
  }
  const uncached = []; const cached = [];
  // Alternate order to avoid systematically favoring the second run.
  for (let sample = 0; sample < 3; sample++) {
    const results = sample % 2 ? [run(bounded), run(noCache)].reverse() : [run(noCache), run(bounded)];
    assert.equal(results[0].matches, results[1].matches);
    uncached.push(results[0].elapsed); cached.push(results[1].elapsed);
  }
  return { conversations: count, messages: count * 8, snapshotBytes: Buffer.byteLength(JSON.stringify(list)),
    normalizedCacheBudgetCharacters: 2_000_000, queriesPerSample: queries.length * 3,
    uncachedSamplesMs: uncached, cachedSamplesMs: cached, uncachedMedianMs: median(uncached),
    cachedMedianMs: median(cached), medianSpeedup: round(median(uncached) / median(cached)), resultsEquivalent: true };
}
const current = await measureStorage(createSqliteSnapshotRepository);
assert.equal(current.bridgeBodyReadBytesPerSample, snapshotBytes * current.iterationsPerSample + 4);
assert.equal(current.legacyMarkerWritesPerSample, 0);
let baseline;
if (values['baseline-repository']) {
  // Explicit opt-in local CODE module, never a real user database or snapshot.
  const module = await import(pathToFileURL(resolve(values['baseline-repository'])).href);
  baseline = await measureStorage(module.createSqliteSnapshotRepository);
}
const report = {
  generatedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
  syntheticDataOnly: true, storage: { backend: 'Node SQLite :memory:', snapshotBytes, current, baseline },
  search: [measureSearch(500), measureSearch(2000)],
  limitations: [
    'Node process timings, not native Expo SQLite bridge, Hermes, UI frame rate or disk durability.',
    'Bridge bytes count returned body fields only; SQL strings, parameters and marker reads are not included.',
    'Search uses warmed immutable conversations; edits and over-budget entries still require normalization.',
    'Timing ratios are observations, not CI thresholds or universal device performance guarantees.',
  ],
};
if (values.output) {
  const output = resolve(values.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
}
console.log(JSON.stringify(report, null, 2));
