// Local, opt-in live integration smoke. Two small billable requests, synthetic data only.
// Temporary document/session are removed in finally. Never prints credentials or other library content.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import WebSocket from 'ws';
import { loadConfig } from '../services/gateway/dist/config.js';
import { AppDatabase } from '../services/gateway/dist/database.js';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const gatewayDir = path.join(root, 'services/gateway');
if (!process.argv.includes('--confirm-billable')) throw new Error('Pass --confirm-billable to permit two small requests using the local administrator provider configuration.');
process.chdir(gatewayDir);
const base = 'http://127.0.0.1:8787'; // Deliberately fixed: never send a local administrator session to an arbitrary host.
const config = loadConfig({ ...parse(await readFile(path.join(gatewayDir, '.env'), 'utf8')), ...process.env });
const db = new AppDatabase(config);
const report = { testedAt: new Date().toISOString(), gateway: base, checks: [] };
let session; let document; let admin;
const assert = (value, message) => { if (!value) throw new Error(message); };
const call = async (route, method = 'GET', body) => {
  const response = await fetch(base + route, { method, headers: { authorization: 'Bearer ' + session.token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120000) });
  const data = await response.json();
  if (!response.ok) throw new Error('Gateway ' + response.status + ': ' + (data.error?.code || 'unknown'));
  return data;
};
try {
  admin = db.listUsers().find(user => user.role === 'admin' && !user.disabled); assert(admin, 'No local administrator');
  session = db.createSession(admin.id, 'knowledge-live-verifier');
  const marker = 'NVC-' + randomUUID().slice(0, 8);
  const fixture = { title: '临时自测：白鹭计划 ' + marker, text: `白鹭计划的演示码是 ${marker}。演示集合地点是青竹会议室。此资料为自动化测试，不是真实用户资料。` };
  document = (await call('/v1/knowledge', 'POST', fixture)).document;
  assert(document?.id, 'Document was not created');
  const searched = await call('/v1/knowledge/search?q=' + encodeURIComponent('白鹭计划 ' + marker));
  assert(searched.sources?.some(source => source.documentId === document.id && source.excerpt.includes(marker)), 'Indexed fixture not found');
  report.checks.push({ name: 'create_and_chinese_search', ok: true });
  const request = () => ({ requestId: randomUUID(), conversationId: randomUUID(), deviceId: 'knowledge-live-device', messages: [{ role: 'user', content: `根据资料回答白鹭计划 ${marker}：演示码是什么，集合地点在哪里？引用资料编号，简短回答。` }], options: { model: db.getProviderSettings().defaultModel, maxOutputTokens: 512, reasoningEffort: 'low', verbosity: 'low', knowledgeBase: true, autoTools: true, webSearch: true, codeInterpreter: true } });
  const req = request();
  const result = await call('/v1/chat', 'POST', req);
  assert(result.text.includes(marker) && result.text.includes('青竹') && /\[资料\d+\]/.test(result.text), 'REST answer did not ground in fixture');
  assert(result.knowledge?.sources.some(source => source.documentId === document.id), 'REST lost source metadata');
  assert(!result.tools?.length, 'External tools executed in library mode');
  const snapshot = await call(`/v1/chat/jobs/${req.requestId}?conversationId=${req.conversationId}`);
  assert(JSON.stringify(snapshot.knowledge) === JSON.stringify(result.knowledge), 'Job source snapshot mismatch');
  report.checks.push({ name: 'live_rest_grounded_answer_and_job', ok: true, model: result.model, text: result.text });
  const wsReq = request();
  const wsResult = await new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:8787/v1/chat/stream'); let text = ''; let settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); ws.close(); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => { finish(new Error('WebSocket timeout')); ws.terminate(); }, 120000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', accessToken: session.token, deviceId: wsReq.deviceId })));
    ws.on('error', () => finish(new Error('WebSocket failed')));
    ws.on('close', () => { if (!settled) finish(new Error('WebSocket closed before completion')); });
    ws.on('message', raw => {
      try {
        const message = JSON.parse(String(raw));
        if (message.type === 'ready') ws.send(JSON.stringify({ type: 'start', payload: wsReq }));
        if (message.type === 'error') return finish(new Error(message.code));
        if (message.requestId !== wsReq.requestId) return;
        if (message.type === 'tool') return finish(new Error('Unexpected external tool activity'));
        if (message.type === 'delta') text += message.delta;
        if (message.type === 'done') finish(null, { text, knowledge: message.knowledge, model: message.model });
      } catch { finish(new Error('Invalid WebSocket message')); }
    });
  });
  assert(wsResult.text.includes(marker) && wsResult.text.includes('青竹') && /\[资料\d+\]/.test(wsResult.text), 'WS answer did not ground in fixture');
  assert(wsResult.knowledge?.sources.some(source => source.documentId === document.id), 'WS lost source metadata');
  report.checks.push({ name: 'live_websocket_grounded_answer', ok: true, model: wsResult.model, text: wsResult.text });
  await call('/v1/knowledge/' + document.id, 'DELETE');
  const deletedId = document.id; document = undefined;
  assert(!(await call('/v1/knowledge/search?q=' + encodeURIComponent(marker))).sources.some(source => source.documentId === deletedId), 'Deleted fixture still searchable');
  report.checks.push({ name: 'delete_removes_index', ok: true });
} catch (error) { report.checks.push({ name: 'knowledge_live_smoke', ok: false, error: error instanceof Error ? error.message : 'Unknown failure' }); process.exitCode = 1; }
finally {
  try { if (document && admin) db.knowledge.delete(admin.id, document.id); }
  finally { if (session) db.revokeSession(session.token); db.close(); }
  await writeFile(path.join(root, 'artifacts/knowledge-live-gateway.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
