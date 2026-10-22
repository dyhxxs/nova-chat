import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestScheduler } from '../companion_eval_requests.mjs';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
test('QA requests respect concurrency, spacing and FIFO starts', async () => {
  const run = createRequestScheduler({ concurrency: 2, minIntervalMs: 15 });
  let active = 0, peak = 0; const starts = [];
  const results = await Promise.all(Array.from({ length: 5 }, (_, index) => run(async () => {
    starts.push({ index, time: Date.now() }); peak = Math.max(peak, ++active);
    await pause(40); active--; return index;
  })));
  assert.deepEqual(results, [0, 1, 2, 3, 4]);
  assert.deepEqual(starts.map(s => s.index), results);
  assert.equal(peak, 2);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i].time - starts[i - 1].time >= 15);
});
test('a failed QA request releases its slot without dropping queued requests', async () => {
  const run = createRequestScheduler({ concurrency: 1, minIntervalMs: 0 });
  const failed = run(() => { throw new Error('synthetic_failure'); });
  const next = run(async () => 'next_started');
  await assert.rejects(failed, /synthetic_failure/);
  assert.equal(await next, 'next_started');
});
