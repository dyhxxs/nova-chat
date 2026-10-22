import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--counterexamples', '--replay', '--manual', '--out'].includes(args[i]) || !args[i + 1]) throw new Error('Expected --counterexamples FILE --replay DIRECTORY --manual FILE --out NEW_DIRECTORY');
  options[args[i].slice(2)] = resolve(args[i + 1]);
}
if (Object.keys(options).length !== 4) throw new Error('All four arguments are required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const [counterexampleBytes, summaryBytes, turnBytes, manualBytes] = await Promise.all([
  readFile(options.counterexamples), readFile(join(options.replay, 'summary.json')),
  readFile(join(options.replay, 'turns.jsonl')), readFile(options.manual),
]);
const cases = JSON.parse(counterexampleBytes);
const summary = JSON.parse(summaryBytes);
const turns = turnBytes.toString('utf8').trim().split('\n').map(JSON.parse);
const manual = JSON.parse(manualBytes);
if (summary.replaySha256 !== hash(counterexampleBytes) || !summary.fullDialoguesGenerated || !summary.fullReviewsAvailable) throw new Error('Replay context hash or completed evaluation mismatch');
if (manual.runId !== summary.runId || manual.reviewedTurns !== turns.length || !manual.reviewedBy) throw new Error('Manual review does not match this completed run');
const selected = [];
const excluded = [];
for (const original of cases) {
  const matches = turns.filter(t => t.scenarioId === original.id);
  const annotations = manual.records.filter(r => r.scenarioId === original.id);
  if (matches.length !== 1 || annotations.length !== 1) throw new Error('Each counterexample needs exactly one replay and manual decision');
  const replay = matches[0];
  const annotation = annotations[0];
  if (replay.runId !== summary.runId || replay.inputProvenance.source !== 'counterexample_replay' || replay.userInput !== original.messages.at(-1).content) throw new Error('Original and replay user context mismatch');
  if (!annotation.acceptForPreference || replay.review.status !== 'reviewed' || replay.review.overallScore < 4 || replay.review.issues.some(i => ['medium','high'].includes(i.severity)) || !replay.assistantReply || Object.keys(replay.errors ?? {}).length || replay.assistantReply === original.rejectedResponse) {
    excluded.push({ scenarioId: original.id, reason: annotation.assessment });
    continue;
  }
  if (!annotation.assessment || !annotation.problemTags?.length) throw new Error('Candidate needs a manual assessment and problem tags');
  selected.push({
    schema: 'companion-preference-candidate-v1', synthetic: true, weightTrainingPerformed: false,
    persona: summary.companionName, context: original.messages,
    rejectedResponse: original.rejectedResponse, preferredResponse: replay.assistantReply,
    problemTags: annotation.problemTags, manualAssessment: annotation.assessment,
    provenance: { originalRun: original.originalRun, originalScenario: original.originalScenario, originalTurn: original.originalTurn,
      replayRun: summary.runId, replayScenario: original.id, runtimeVersion: summary.companionRuntimeVersion,
      replayContextSha256: summary.replaySha256, evaluator: summary.evaluator, reviewedBy: manual.reviewedBy },
  });
}
await mkdir(options.out, { recursive: false });
const jsonl = rows => rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
await writeFile(join(options.out, 'preferences.jsonl'), jsonl(selected));
await writeFile(join(options.out, 'sft-candidates.jsonl'), jsonl(selected.map(c => ({
  schema: 'companion-sft-candidate-v1', synthetic: true, persona: c.persona,
  messages: [...c.context, { role: 'assistant', content: c.preferredResponse }], provenance: c.provenance,
}))));
const manifest = { status: 'candidates-only', weightTrainingPerformed: false, selectedCount: selected.length, excluded,
  contextPairing: 'exact-original-replay-only', needs: 'Training-specific persona/system prompt, independent held-out validation and a supported weight-training provider',
  sources: { counterexamplesSha256: hash(counterexampleBytes), summarySha256: hash(summaryBytes), turnsSha256: hash(turnBytes), manualSha256: hash(manualBytes) } };
await writeFile(join(options.out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ out: options.out, candidateCount: selected.length, excludedCount: excluded.length, weightTrainingPerformed: false }));
