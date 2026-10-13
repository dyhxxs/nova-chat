import { syntheticPdf } from './helpers/syntheticPdf.js';
import { pdfTextExtractor } from '../src/pdfText.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
const apps: FastifyInstance[] = [];
const dirs: string[] = [];
async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'nova-knowledge-routes-')); dirs.push(dir);
  const app = await buildServer(loadConfig({ NODE_ENV: 'test', DATA_DIR: dir, LOG_LEVEL: 'silent', OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: 'https://model.example/v1', REQUESTS_PER_MINUTE: '500' })); apps.push(app);
  const a = (await app.inject({ method: 'POST', url: '/v1/auth/bootstrap', payload: { email: 'a@example.com', password: 'secure password123', displayName: 'A', deviceId: 'knowledge-device-a', bootstrapToken: '' } })).json();
  const b = (await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email: 'b@example.com', password: 'secure password123', displayName: 'B', deviceId: 'knowledge-device-b' } })).json();
  expect(a.accessToken).toBeTruthy(); expect(b.accessToken).toBeTruthy();
  const auth = (token = a.accessToken) => ({ authorization: 'Bearer ' + token });
  const create = async (title = '报销制度', text = '报销截止日期是每月25日。') => (await app.inject({ method: 'POST', url: '/v1/knowledge', headers: auth(), payload: { title, text } })).json().document;
  return { app, a, b, auth, create };
}
afterEach(async () => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const app of apps.splice(0)) await app.close();
  for (const dir of dirs.splice(0)) {
    const target = path.resolve(dir);
    if (path.dirname(target) !== path.resolve(tmpdir()) || !path.basename(target).startsWith('nova-knowledge-routes-')) throw new Error('Unsafe cleanup');
    await rm(target, { recursive: true, force: true });
  }
});
const payload = (options = {}) => ({ requestId: randomUUID(), conversationId: randomUUID(), deviceId: 'knowledge-device-a', messages: [{ role: 'user', content: '报销截止日期是什么？' }], options: { knowledgeBase: true, ...options } });
function multipart(name: string, type: string, text: string | Buffer) {
  const boundary = 'nova-knowledge-boundary';
  return { headers: { 'content-type': 'multipart/form-data; boundary=' + boundary }, payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`), Buffer.from(text), Buffer.from(`\r\n--${boundary}--\r\n`)]) };
}
describe('knowledge API authorization and transport', () => {
  it('requires login and validates payloads without accepting an owner override', async () => {
    const { app, auth } = await setup();
    for (const url of ['/v1/knowledge', '/v1/knowledge/search?q=test', '/v1/knowledge/' + randomUUID()]) expect((await app.inject({ url })).statusCode).toBe(401);
    for (const body of [{ title: '', text: '正文' }, { title: '标题', text: '' }, { title: '标题', text: '正文', userId: 'someone' }]) expect((await app.inject({ method: 'POST', url: '/v1/knowledge', headers: auth(), payload: body })).statusCode).toBe(400);
    expect((await app.inject({ url: '/v1/knowledge/search?q=' + 'x'.repeat(201), headers: auth() })).statusCode).toBe(400);
  });
  it('does not let an administrator or another user inspect/modify the other account library', async () => {
    const { app, b, auth, create } = await setup();
    const doc = await create();
    for (const method of ['GET', 'DELETE', 'PUT'] as const) {
      const response = await app.inject({ method, url: '/v1/knowledge/' + doc.id, headers: auth(b.accessToken), ...(method === 'PUT' ? { payload: { title: 'changed', text: 'changed', expectedUpdatedAt: doc.updatedAt } } : {}) });
      expect(response.statusCode).toBe(404);
    }
    expect((await app.inject({ url: '/v1/knowledge', headers: auth(b.accessToken) })).json().documents).toEqual([]);
    const other = (await app.inject({ method: 'POST', url: '/v1/knowledge', headers: auth(b.accessToken), payload: { title: '用户资料', text: 'secret' } })).json().document;
    expect((await app.inject({ url: '/v1/knowledge/' + other.id, headers: auth() })).statusCode).toBe(404);
  });
  it('supports edit conflicts, duplicate detection, deletion and immediate reindexing', async () => {
    const { app, auth, create } = await setup();
    const doc = await create();
    const update = { title: '出差制度', text: '出差申请提前五天。', expectedUpdatedAt: doc.updatedAt };
    expect((await app.inject({ method: 'PUT', url: '/v1/knowledge/' + doc.id, headers: auth(), payload: update })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: '/v1/knowledge/' + doc.id, headers: auth(), payload: update })).statusCode).toBe(409);
    expect((await app.inject({ url: '/v1/knowledge/search?q=' + encodeURIComponent('出差申请'), headers: auth() })).json().sources).toHaveLength(1);
    const duplicate = await app.inject({ method: 'POST', url: '/v1/knowledge', headers: auth(), payload: { title: '又一份', text: update.text } });
    expect(duplicate.statusCode).toBe(200); expect(duplicate.json().duplicate).toBe(true);
    expect((await app.inject({ method: 'DELETE', url: '/v1/knowledge/' + doc.id, headers: auth() })).statusCode).toBe(200);
    expect((await app.inject({ url: '/v1/knowledge/search?q=' + encodeURIComponent('出差申请'), headers: auth() })).json().sources).toEqual([]);
  });
  it('imports owned text files, rejects other owners and refuses oversized extracted content', async () => {
    const { app, b, auth } = await setup();
    const form = multipart('guide.txt', 'text/plain', '报销截止日期25日。');
    const file = (await app.inject({ method: 'POST', url: '/v1/files', ...form, headers: { ...form.headers, ...auth() } })).json().attachment;
    expect(file?.id).toBeTruthy();
    expect((await app.inject({ method: 'POST', url: '/v1/knowledge/import', headers: auth(b.accessToken), payload: { fileId: file.id } })).statusCode).toBe(404);
    const imported = await app.inject({ method: 'POST', url: '/v1/knowledge/import', headers: auth(), payload: { fileId: file.id } });
    expect(imported.statusCode).toBe(201); expect(imported.json().document.sourceName).toBe('guide.txt');
    const large = multipart('large.txt', 'text/plain', 'a'.repeat(120001));
    const largeFile = (await app.inject({ method: 'POST', url: '/v1/files', ...large, headers: { ...large.headers, ...auth() } })).json().attachment;
    expect((await app.inject({ method: 'POST', url: '/v1/knowledge/import', headers: auth(), payload: { fileId: largeFile.id } })).statusCode).toBe(413);
  });
  it('imports owned PDF text and preserves page warnings, sources and searchability', async () => {
    const { app, auth, b } = await setup();
    const form = multipart('guide.pdf', 'application/pdf', syntheticPdf(['长沙报销截止每月二十五日', ''], { chinese: true }));
    const file = (await app.inject({ method: 'POST', url: '/v1/files', ...form, headers: { ...form.headers, ...auth() } })).json().attachment;
    const spy = vi.spyOn(pdfTextExtractor, 'extract');
    expect((await app.inject({ method: 'POST', url: '/v1/knowledge/import', headers: auth(b.accessToken), payload: { fileId: file.id } })).statusCode).toBe(404);
    expect(spy).not.toHaveBeenCalled();
    const result = await app.inject({ method: 'POST', url: '/v1/knowledge/import', headers: auth(), payload: { fileId: file.id } });
    expect(result.statusCode).toBe(201);
    expect(result.json().importInfo).toEqual({ format: 'pdf', pages: 2, pagesWithoutText: [2] });
    const doc = (await app.inject({ url: '/v1/knowledge/' + result.json().document.id, headers: auth() })).json().document;
    expect(doc.text).toContain('长沙报销截止每月二十五日'); expect(doc.text).toContain('未提取到文字');
    expect(doc.sourceName).toBe('guide.pdf');
    const search = await app.inject({ url: '/v1/knowledge/search?q=' + encodeURIComponent('报销截止'), headers: auth() });
    expect(search.json().sources[0].excerpt).toContain('二十五日');
    const duplicate = await app.inject({ method: 'POST', url: '/v1/knowledge/import', headers: auth(), payload: { fileId: file.id } });
    expect(duplicate.statusCode).toBe(200); expect(duplicate.json().duplicate).toBe(true);
  });
  it('rechecks the session after PDF work and does not save for a revoked session', async () => {
    const { app, auth } = await setup();
    const form = multipart('slow.pdf', 'application/pdf', syntheticPdf(['slow text']));
    const file = (await app.inject({ method: 'POST', url: '/v1/files', ...form, headers: { ...form.headers, ...auth() } })).json().attachment;
    let finish!: () => void;
    vi.spyOn(pdfTextExtractor, 'extract').mockImplementationOnce(() => new Promise(resolve => {
      finish = () => resolve({ text: 'slow text', importInfo: { format: 'pdf', pages: 1, pagesWithoutText: [] } });
    }));
    const importing = app.inject({ method: 'POST', url: '/v1/knowledge/import', headers: auth(), payload: { fileId: file.id } }).then(value => value);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect((await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: auth() })).statusCode).toBe(200);
    finish(); expect((await importing).statusCode).toBe(401);
  });
  it('does not create library records for unreadable PDFs', async () => {
    const { app, auth } = await setup();
    for (const bytes of [syntheticPdf(['']), syntheticPdf(['private'], { password: 'secret' }), Buffer.from('%PDF-broken')]) {
      const form = multipart('unreadable.pdf', 'application/pdf', bytes);
      const file = (await app.inject({ method: 'POST', url: '/v1/files', ...form, headers: { ...form.headers, ...auth() } })).json().attachment;
      expect((await app.inject({ method: 'POST', url: '/v1/knowledge/import', headers: auth(), payload: { fileId: file.id } })).statusCode).toBe(415);
    }
    expect((await app.inject({ url: '/v1/knowledge', headers: auth() })).json().usage.documents).toBe(0);
  });
  it('returns citation snapshots through REST and scoped job recovery; old requests stay opt-out', async () => {
    const { app, auth, b, create } = await setup(); await create();
    const mock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ output_text: '每月25日。[资料1]' }), { headers: { 'content-type': 'application/json' } })));
    vi.stubGlobal('fetch', mock);
    const req = payload();
    const result = await app.inject({ method: 'POST', url: '/v1/chat', headers: auth(), payload: req });
    expect(result.statusCode).toBe(200); expect(result.json().knowledge.sources[0].excerpt).toContain('25日');
    const jobUrl = `/v1/chat/jobs/${req.requestId}?conversationId=${req.conversationId}`;
    expect((await app.inject({ url: jobUrl, headers: auth() })).json().knowledge).toEqual(result.json().knowledge);
    expect((await app.inject({ url: jobUrl, headers: auth(b.accessToken) })).statusCode).toBe(404);
    const old = payload({ autoTools: false }); delete (old.options as { knowledgeBase?: boolean }).knowledgeBase;
    expect((await app.inject({ method: 'POST', url: '/v1/chat', headers: auth(), payload: old })).json().knowledge).toBeUndefined();
    expect(String(mock.mock.calls[1]?.[1].body)).not.toContain('网关资料检索结果');
  });
  it('delivers original source snapshots in WebSocket done messages', async () => {
    const { app, a, create } = await setup(); await create();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: '25日。[资料1]' }), { headers: { 'content-type': 'application/json' } })));
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const req = payload();
    const socket = new WebSocket(address.replace('http:', 'ws:') + '/v1/chat/stream');
    try {
      const result: any = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WS timeout')), 5000);
        socket.on('error', error => { clearTimeout(timer); reject(error); });
        socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', accessToken: a.accessToken, deviceId: req.deviceId })));
        socket.on('message', data => {
          const message = JSON.parse(String(data));
          if (message.type === 'ready') socket.send(JSON.stringify({ type: 'start', payload: req }));
          if (message.type === 'error') { clearTimeout(timer); reject(new Error(message.code)); }
          if (message.type === 'done') { clearTimeout(timer); resolve(message); }
        });
      });
      expect(result.knowledge.sources[0].label).toBe('资料1');
      expect(result.knowledge.sources[0].excerpt).toContain('25日');
    } finally { socket.terminate(); }
  });
});
