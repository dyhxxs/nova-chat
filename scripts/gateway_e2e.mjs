import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../services/gateway/src/config.ts';
import { buildServer } from '../services/gateway/src/server.ts';
import { WebSocket } from 'ws';

const fake = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/v1/models') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'synthetic-model' }] }));
    return;
  }
  if (request.method === 'POST' && request.url === '/v1/chat/completions') {
    for await (const _chunk of request) { /* consume request body */ }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const id = 'synthetic-response';
    const send = (value) => response.write(`data: ${JSON.stringify(value)}\n\n`);
    send({ id, choices: [{ delta: { content: '企业级 ' }, finish_reason: null }] });
    send({ id, choices: [{ delta: { content: '验收通过。' }, finish_reason: null }] });
    send({ id, choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } });
    response.end('data: [DONE]\n\n');
    return;
  }
  response.writeHead(404).end();
});
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
const fakePort = fake.address().port;
const dataDir = await mkdtemp(path.join(tmpdir(), 'nova-gateway-e2e-'));
const config = loadConfig({
  NODE_ENV: 'test', DATA_DIR: dataDir, HOST: '127.0.0.1', PORT: '8787', LOG_LEVEL: 'silent',
  SERVER_MASTER_KEY: 'synthetic-e2e-master-key-longer-than-thirty-two-characters',
  ADMIN_BOOTSTRAP_TOKEN: 'synthetic-e2e-bootstrap-token',
  OPENAI_API_KEY: 'synthetic-provider-key', OPENAI_BASE_URL: `http://127.0.0.1:${fakePort}/v1`,
  OPENAI_MODEL: 'synthetic-model', ALLOWED_MODELS: 'synthetic-model', PROVIDER_API_MODE: 'chat-completions',
  REQUESTS_PER_MINUTE: '500', MAX_CONCURRENT_PER_DEVICE: '4', MAX_FILE_BYTES: '1048576',
});
const app = await buildServer(config);
const origin = await app.listen({ host: '127.0.0.1', port: 0 });
const json = async (route, options = {}) => {
  const response = await fetch(origin + route, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = await response.json();
  assert.equal(response.headers.get('x-request-id')?.length > 10, true);
  return { response, body };
};
const admin = await json('/v1/auth/bootstrap', { method: 'POST', body: JSON.stringify({ email: 'admin@e2e.test', password: 'admin-pass-123', displayName: 'E2E Admin', deviceId: 'e2e-admin-device', bootstrapToken: 'synthetic-e2e-bootstrap-token' }) });
assert.equal(admin.response.status, 201);
const adminToken = admin.body.accessToken;
const user = await json('/v1/auth/register', { method: 'POST', headers: { authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ email: 'user@e2e.test', password: 'user-pass-123', displayName: 'E2E User', deviceId: 'e2e-user-device' }) });
assert.equal(user.response.status, 201);
const userToken = user.body.accessToken;
const denied = await json('/v1/admin/provider', { headers: { authorization: `Bearer ${userToken}` } });
assert.equal(denied.response.status, 403);
const provider = await json('/v1/admin/provider', { headers: { authorization: `Bearer ${adminToken}` } });
assert.equal(provider.response.status, 200);
assert.equal(provider.body.provider.apiKeySet, true);
assert.equal(JSON.stringify(provider.body).includes('synthetic-provider-key'), false);
const knowledge = await json('/v1/knowledge', { method: 'POST', headers: { authorization: `Bearer ${userToken}` }, body: JSON.stringify({ title: '上线验收资料', text: 'Nova Chat 企业级上线验收口径：真实模型、资料隔离、流式回复和备份恢复都必须完成。' }) });
assert.equal(knowledge.response.status, 201);
const search = await json('/v1/knowledge/search?q=' + encodeURIComponent('资料隔离'), { headers: { authorization: `Bearer ${userToken}` } });
assert.equal(search.response.status, 200);
assert.equal(search.body.sources.length, 1);
const requestPayload = (withKnowledge = false) => ({ requestId: randomUUID(), conversationId: randomUUID(), deviceId: 'e2e-user-device', messages: [{ role: 'user', content: '请回复验收结果。', attachments: [] }], options: { model: 'synthetic-model', maxOutputTokens: 1000, autoTools: false, knowledgeBase: withKnowledge, webSearch: false, codeInterpreter: false } });
const rest = await json('/v1/chat', { method: 'POST', headers: { authorization: `Bearer ${userToken}` }, body: JSON.stringify(requestPayload(true)) });
assert.equal(rest.response.status, 200);
assert.equal(rest.body.text, '企业级 验收通过。');
assert.equal(rest.body.knowledge.sources.length, 1);
const form = new FormData();
form.append('file', new Blob(['部署资料：生产环境必须使用 HTTPS/WSS。'], { type: 'text/plain' }), 'deployment.txt');
const uploadResponse = await fetch(origin + '/v1/files', { method: 'POST', headers: { authorization: `Bearer ${userToken}` }, body: form });
assert.equal(uploadResponse.status, 201);
const upload = await uploadResponse.json();
const imported = await json('/v1/knowledge/import', { method: 'POST', headers: { authorization: `Bearer ${userToken}` }, body: JSON.stringify({ fileId: upload.attachment.id }) });
assert.equal(imported.response.status, 201);
const wsPayload = requestPayload(false);
const wsResult = await new Promise((resolve, reject) => {
  const socket = new WebSocket(origin.replace('http:', 'ws:') + '/v1/chat/stream');
  let text = '';
  const timer = setTimeout(() => { socket.terminate(); reject(new Error('websocket timeout')); }, 5000);
  socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', accessToken: userToken, deviceId: 'e2e-user-device', appVersion: '1.1.31', appVersionCode: 33 })));
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'ready') socket.send(JSON.stringify({ type: 'start', payload: wsPayload }));
    if (message.type === 'delta' && message.requestId === wsPayload.requestId) text += message.delta;
    if (message.type === 'done' && message.requestId === wsPayload.requestId) { clearTimeout(timer); socket.close(); resolve(text); }
    if (message.type === 'error') { clearTimeout(timer); socket.terminate(); reject(new Error(message.code)); }
  });
  socket.on('error', reject);
});
assert.equal(wsResult, '企业级 验收通过。');
await app.close();
await new Promise((resolve) => fake.close(resolve));
console.log(JSON.stringify({ ok: true, checks: ['bootstrap', 'register', 'admin-privacy', 'knowledge-search', 'rest-chat', 'file-import', 'websocket-chat'] }));