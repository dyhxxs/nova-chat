// Run only against this workspace's own gateway. Uses a short-lived local admin session,
// revokes it in finally, and makes two small billable model requests; never prints credentials.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import { WebSocket } from 'ws';
import { loadConfig } from '../services/gateway/dist/config.js';
import { AppDatabase } from '../services/gateway/dist/database.js';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const gatewayDir = path.join(root, 'services', 'gateway');
process.chdir(gatewayDir);
if (!process.argv.includes('--confirm-billable')) throw new Error('Pass --confirm-billable to allow two model requests using the existing administrator configuration.');
const base = new URL(process.env.GATEWAY_SMOKE_URL || 'http://127.0.0.1:8787');
if (base.username || base.password || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname)))) throw new Error('Gateway must be HTTPS or local loopback.');
const config = loadConfig({ ...parse(await readFile(path.join(gatewayDir, '.env'))), ...process.env });
const db = new AppDatabase(config);
const report = { testedAt: new Date().toISOString(), gateway: base.origin, checks: [] };
let session;
function assert(value, label) { if (!value) throw new Error(label); }
try {
  const admin = db.listUsers().find((user) => user.role === 'admin' && !user.disabled);
  assert(admin, 'No local administrator');
  session = db.createSession(admin.id, 'common-tools-live-verifier');
  const headers = { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' };
  const unauthenticated = await fetch(new URL('/v1/tools', base), { signal: AbortSignal.timeout(15_000) });
  assert(unauthenticated.status === 401, 'Tool catalog must require authentication');
  const catalogResponse = await fetch(new URL('/v1/tools', base), { headers, signal: AbortSignal.timeout(15_000) });
  const catalog = await catalogResponse.json();
  assert(catalogResponse.ok && catalog.tools?.length === 8, 'Eight tool capabilities expected');
  report.checks.push({ name: 'authenticated_catalog', ok: true, toolCount: catalog.tools.length });
  const payload = (content) => ({ requestId: randomUUID(), conversationId: randomUUID(), deviceId: 'common-tools-live-verifier', messages: [{ role: 'user', content, attachments: [] }], options: { reasoningEffort: 'low', verbosity: 'low', maxOutputTokens: 2048, webSearch: false, codeInterpreter: false } });
  // Omit new options/context to prove an installed older client benefits too.
  const weatherRequest = payload('长沙天气怎么样？明天需要带伞吗？也告诉我现在是几月几号星期几、北京时间几点。请说明天气数据时间和来源。');
  const weatherResponse = await fetch(new URL('/v1/chat', base), { method: 'POST', headers, body: JSON.stringify(weatherRequest), signal: AbortSignal.timeout(120_000) });
  const weather = await weatherResponse.json();
  assert(weatherResponse.ok && weather.text?.trim() && weather.tools?.some((tool) => tool.name === 'get_weather' && tool.status === 'completed'), 'Live old-client weather request failed');
  report.checks.push({ name: 'old_client_rest_weather_time', ok: true, model: weather.model, text: weather.text, tools: weather.tools });
  const searchRequest = { ...payload('联网搜索 Open-Meteo 的官方网站，检查搜索结果是否相关，只给出官网名称和链接。'), context: { timezone: 'Asia/Shanghai' } };
  const wsUrl = new URL('/v1/chat/stream', base); wsUrl.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const result = await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl); const activities = []; let text = ''; let settled = false;
    const settle = (error, data) => { if (settled) return; settled = true; clearTimeout(timer); ws.close(); if (error) reject(error); else resolve(data); };
    const timer = setTimeout(() => { settle(new Error('WebSocket live request timed out')); ws.terminate(); }, 120_000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', accessToken: session.token, deviceId: 'common-tools-live-verifier', appVersion: '1.1.16' })));
    ws.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === 'ready') ws.send(JSON.stringify({ type: 'start', payload: searchRequest }));
        if (message.type === 'error') return settle(new Error(message.code || 'WebSocket generation error'));
        if (message.requestId !== searchRequest.requestId) return;
        if (message.type === 'tool') activities.push(message.activity);
        if (message.type === 'delta') text += message.delta;
        if (message.type === 'done') settle(null, { text, model: message.model, activities, tools: message.tools });
      } catch (error) { settle(error); }
    });
    ws.on('error', () => settle(new Error('WebSocket connection failed')));
    ws.on('close', () => { if (!settled) settle(new Error('WebSocket closed before completion')); });
  });
  assert(result.text?.trim() && result.activities.some((tool) => tool.name === 'search_web' && tool.status === 'completed'), 'Live search did not execute');
  assert(/https?:\/\/(?:www\.)?open-meteo\.com/i.test(result.text), 'Search answer missing relevant official URL');
  const snapshotUrl = new URL(`/v1/chat/jobs/${searchRequest.requestId}`, base); snapshotUrl.searchParams.set('conversationId', searchRequest.conversationId);
  const snapshotResponse = await fetch(snapshotUrl, { headers, signal: AbortSignal.timeout(15_000) }); const snapshot = await snapshotResponse.json();
  assert(snapshotResponse.ok && snapshot.status === 'completed' && snapshot.tools?.some((tool) => tool.name === 'search_web'), 'Job snapshot lost tool state');
  report.checks.push({ name: 'websocket_search_and_resume_state', ok: true, ...result });
} catch (error) {
  report.checks.push({ name: 'live_gateway_smoke', ok: false, message: error.message }); process.exitCode = 1;
} finally {
  if (session) db.revokeSession(session.token);
  db.close();
  await mkdir(path.join(root, 'artifacts'), { recursive: true });
  await writeFile(path.join(root, 'artifacts', 'common-tools-live-gateway.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
