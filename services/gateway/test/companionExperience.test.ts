import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { companionContextSchema, type GenerateRequest } from '@nova-chat/protocol';
import { loadConfig } from '../src/config.js';
import { AppDatabase } from '../src/database.js';
import { ModelProvider } from '../src/provider.js';
import { buildServer } from '../src/server.js';
const dirs: string[] = [];
const databases = new Set<AppDatabase>();
const apps = new Set<FastifyInstance>();
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPacAAAAASUVORK5CYII=', 'base64');
const route = (purpose: 'chat' | 'image') => ({ apiBaseUrl: `https://${purpose}.companion.example/v1`, apiKey: `${purpose}-secret`, apiMode: 'chat-completions' as const, authMode: 'bearer' as const, defaultModel: purpose === 'chat' ? 'deepseek-chat' : 'gpt-image-1', allowedModels: [purpose === 'chat' ? 'deepseek-chat' : 'gpt-image-1'] });
async function config() {
  const dir = await mkdtemp(path.join(tmpdir(), 'nova-companion-experience-')); dirs.push(dir);
  return loadConfig({ NODE_ENV: 'test', DATA_DIR: dir, LOG_LEVEL: 'silent', SERVER_MASTER_KEY: 'test-companion-master-key-more-than-thirty-two', ADMIN_BOOTSTRAP_TOKEN: 'test-companion-bootstrap-token', OPENAI_BASE_URL: 'https://ordinary.example/v1', OPENAI_API_KEY: 'ordinary-secret', OPENAI_MODEL: 'ordinary-model', ALLOWED_MODELS: 'ordinary-model', REQUESTS_PER_MINUTE: '500' });
}
async function appWith(c: Awaited<ReturnType<typeof config>>) { const app = await buildServer(c); apps.add(app); return app; }
async function close(app: FastifyInstance) { await app.close(); apps.delete(app); }
const bearer = (token: string) => ({ authorization: `Bearer ${token}`, 'x-nova-companion-profile-version': '2' });
async function auth(app: FastifyInstance) {
  const r = await app.inject({ method: 'POST', url: '/v1/auth/bootstrap', payload: { email: 'admin@qa.local', password: 'temporary-test-password', displayName: 'QA', deviceId: 'qa-test-device', bootstrapToken: 'test-companion-bootstrap-token' } });
  expect(r.statusCode).toBe(201); return r.json() as { accessToken: string; user: { id: string } };
}
function request(companionId?: string): GenerateRequest {
  return { requestId: randomUUID(), conversationId: randomUUID(), deviceId: 'qa-test-device', companionId, messages: [{ role: 'user', content: '今天过得怎么样？', attachments: [] }], options: { model: 'ordinary-model', instructions: 'USER_OVERRIDE_MUST_NOT_REACH_COMPANION', reasoningEffort: 'high', verbosity: 'high', maxOutputTokens: 2048, autoTools: true, knowledgeBase: true, webSearch: true, codeInterpreter: true } };
}
afterEach(async () => { vi.unstubAllGlobals(); for (const app of apps) await app.close(); apps.clear(); for (const db of databases) db.close(); databases.clear(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe('independent companion experience', () => {
  it('uses the administrator chat route, hides model metadata, and ignores ordinary user controls', async () => {
    const c = await config(); const app = await appWith(c); const owner = await auth(app);
    const saved = await app.inject({ method: 'PUT', url: '/v1/admin/companion-provider/chat', headers: bearer(owner.accessToken), payload: route('chat') }); expect(saved.statusCode).toBe(200);
    const publicConfig = JSON.stringify(saved.json()); expect(publicConfig).not.toContain('chat-secret'); expect(publicConfig).not.toContain('chat.companion.example');
    const profiles = await app.inject({ method: 'GET', url: '/v1/companions', headers: bearer(owner.accessToken) });
    const input = request(profiles.json().companions[0].id);
    input.messages = [{ role: 'user', content: '下班了', attachments: [] }, { role: 'assistant', content: '回家了吗？', attachments: [] }, { role: 'user', content: '刚吃完饭', attachments: [] }];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ model: 'deepseek-chat', choices: [{ message: { content: '今天在看书，你呢？' } }] }), { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetchMock);
    const response = await app.inject({ method: 'POST', url: '/v1/chat', headers: bearer(owner.accessToken), payload: input });
    expect(response.statusCode).toBe(200); expect(response.json().text).toContain('看书'); expect(response.json()).not.toHaveProperty('model'); expect(response.json()).not.toHaveProperty('usage');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://chat.companion.example/v1/chat/completions'); expect(init.headers).toMatchObject({ authorization: 'Bearer chat-secret' });
    const body = JSON.parse(String(init.body)); expect(body.model).toBe('deepseek-chat'); expect(body.max_completion_tokens).toBe(512); expect(body.tools).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'function', function: expect.objectContaining({ name: 'get_weather' }) })])); expect(JSON.stringify(body)).not.toContain('USER_OVERRIDE');
    const system = body.messages.find((message: { role: string }) => message.role === 'system').content;
    expect(system).not.toContain('deepseek-chat'); expect(system).not.toContain('本次请求实际配置的模型');
    expect(system).toContain('不向用户展示或猜测这些内部配置'); expect(system).toContain('角色日常只是背景'); expect(system).toContain('版本：8'); expect(system).toContain('20岁成年女性，大二中文系学生'); expect(system).toContain('【本轮接话节奏】');
    await close(app);
    const restarted = await appWith(c);
    const recovered = await restarted.inject({ method: 'GET', url: `/v1/chat/jobs/${input.requestId}?conversationId=${input.conversationId}`, headers: bearer(owner.accessToken) });
    expect(recovered.statusCode).toBe(200); expect(recovered.json()).toMatchObject({ status: 'completed', text: '今天在看书，你呢？' }); expect(recovered.json()).not.toHaveProperty('model');
    const duplicate = await restarted.inject({ method: 'POST', url: '/v1/chat', headers: bearer(owner.accessToken), payload: input }); expect(duplicate.statusCode).toBe(409); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('recovers a crashed partial reply and keeps it scoped to its owner and conversation', async () => {
    const c = await config(); const app = await appWith(c); const owner = await auth(app); await close(app);
    const input = request(); const db = new AppDatabase(c);
    db.saveGenerationSnapshot(owner.user.id, input.conversationId, input.requestId, { requestId: input.requestId, conversationId: input.conversationId, status: 'running', text: '已经收到的半段回复', createdAt: Date.now(), updatedAt: Date.now() }); db.close();
    const restarted = await appWith(c);
    const recovered = await restarted.inject({ method: 'GET', url: `/v1/chat/jobs/${input.requestId}?conversationId=${input.conversationId}`, headers: bearer(owner.accessToken) });
    expect(recovered.json()).toMatchObject({ status: 'failed', text: '已经收到的半段回复', error: { code: 'gateway_restarted', retryable: true } });
    const wrongScope = await restarted.inject({ method: 'GET', url: `/v1/chat/jobs/${input.requestId}?conversationId=${randomUUID()}`, headers: bearer(owner.accessToken) }); expect(wrongScope.statusCode).toBe(404);
    const account = await restarted.inject({ method: 'POST', url: '/v1/auth/register', payload: { email: 'other@qa.local', password: 'temporary-test-password', displayName: 'Other', deviceId: 'other-test-device' } });
    const other = await restarted.inject({ method: 'GET', url: `/v1/chat/jobs/${input.requestId}?conversationId=${input.conversationId}`, headers: bearer(account.json().accessToken) }); expect(other.statusCode).toBe(404);
    const denied = await restarted.inject({ method: 'PUT', url: '/v1/admin/companion-provider/image', headers: bearer(account.json().accessToken), payload: route('image') }); expect(denied.statusCode).toBe(403);
  });
  it('saves the first face and sends its bytes through image edits for later scenes and replacements', async () => {
    const c = await config(); const db = new AppDatabase(c); databases.add(db);
    const owner = db.createUser({ email: 'face@qa.local', password: 'temporary-test-password', displayName: 'Face' });
    db.setCompanionProviderSettings('image', route('image'), owner.id);
    const profile = db.createCompanion(owner.id, { appearance: '成年、短发、棕色眼睛' });
    const provider = new ModelProvider(c, db);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetchMock);
    const input = { ...request(profile.id), companion: companionContextSchema.strip().parse(profile), companionAction: 'photo' as const };
    const first = await provider.generate(input, owner, new AbortController().signal, () => {});
    const firstFace = first.attachments![0]!.id; expect(db.getCompanion(owner.id, profile.id)?.avatarFileId).toBe(firstFace);
    // The provider must reload the face, even if the caller still has the original profile.
    await provider.generate(input, owner, new AbortController().signal, () => {});
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]; expect(url).toBe('https://image.companion.example/v1/images/edits'); expect(init.headers).toMatchObject({ authorization: 'Bearer image-secret' }); expect(init.headers).not.toHaveProperty('content-type');
    const form = init.body as FormData; expect(form.get('model')).toBe('gpt-image-1'); expect(form.get('prompt')).toContain('preserve the same face'); expect(Buffer.from(await (form.get('image') as Blob).arrayBuffer())).toEqual(png);
    expect(db.getCompanion(owner.id, profile.id)?.avatarFileId).toBe(firstFace);
    db.updateCompanion(owner.id, profile.id, { avatarFileId: first.attachments![0]!.id });
    const revision = db.companionAppearanceRevision(profile.id); db.updateCompanion(owner.id, profile.id, { appearance: '成年、长发、绿色眼睛' });
    expect(db.getCompanion(owner.id, profile.id)?.avatarFileId).toBeNull(); expect(db.saveGeneratedCompanionFace(owner.id, profile.id, revision, firstFace)).toBe(false);
    await provider.generate(input, owner, new AbortController().signal, () => {});
    const [newUrl, newInit] = fetchMock.mock.calls[2] as unknown as [string, RequestInit]; expect(newUrl).toContain('/images/generations'); expect(JSON.parse(String(newInit.body)).prompt).toContain('长发、绿色眼睛');
    expect(db.getCompanion(owner.id, profile.id)?.avatarFileId).not.toBe(firstFace);
  });
  it('does not fall back to ordinary service when companion chat has not been configured', async () => {
    const c = await config(); const db = new AppDatabase(c); databases.add(db); const owner = db.createUser({ email: 'unconfigured@qa.local', password: 'temporary-test-password', displayName: 'QA' }); const p = db.createCompanion(owner.id);
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(new ModelProvider(c, db).generate({ ...request(p.id), companion: companionContextSchema.strip().parse(p) }, owner, new AbortController().signal, () => {})).rejects.toMatchObject({ code: 'companion_chat_unconfigured' }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['chat', 'image'] as const)('discovers %s models from its own saved route without changing the ordinary catalog', async purpose => {
    const app = await appWith(await config()); const owner = await auth(app);
    await app.inject({ method: 'PUT', url: '/v1/admin/companion-provider/' + purpose, headers: bearer(owner.accessToken), payload: route(purpose) });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] }))); vi.stubGlobal('fetch', fetchMock);
    const result = await app.inject({ method: 'POST', url: '/v1/admin/companion-provider/' + purpose + '/test', headers: bearer(owner.accessToken) });
    expect(result.statusCode).toBe(200); expect(result.json()).toEqual({ ok: true, models: ['model-a', 'model-b'] });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://' + purpose + '.companion.example/v1/models');
    expect(fetchMock.mock.calls[0]?.[1].headers).toMatchObject({ authorization: 'Bearer ' + purpose + '-secret' });
    const catalog = await app.inject({ method: 'GET', url: '/v1/models', headers: bearer(owner.accessToken) });
    expect(catalog.json()).toMatchObject({ models: ['ordinary-model'], defaultModel: 'ordinary-model' });
    const saved = await app.inject({ method: 'GET', url: '/v1/admin/companion-provider/' + purpose, headers: bearer(owner.accessToken) });
    expect(saved.json().provider.defaultModel).toBe(route(purpose).defaultModel);
  });
  it('discovers an unsaved companion route before a model is chosen, without persisting drafts', async () => {
    const app = await appWith(await config()); const owner = await auth(app);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'deepseek-chat' }] }))); vi.stubGlobal('fetch', fetchMock);
    const result = await app.inject({ method: 'POST', url: '/v1/admin/companion-provider/chat/test', headers: bearer(owner.accessToken), payload: { apiBaseUrl: 'https://new.companion.example/v1', apiKey: 'new-secret', apiMode: 'chat-completions', authMode: 'bearer' } });
    expect(result.statusCode).toBe(200); expect(fetchMock.mock.calls[0]?.[0]).toBe('https://new.companion.example/v1/models');
    const saved = await app.inject({ method: 'GET', url: '/v1/admin/companion-provider/chat', headers: bearer(owner.accessToken) });
    expect(saved.json().provider.apiKeySet).toBe(false);
  });
  it('requires administrator authentication and replacement credentials before querying a changed companion destination', async () => {
    const app = await appWith(await config()); const owner = await auth(app);
    await app.inject({ method: 'PUT', url: '/v1/admin/companion-provider/chat', headers: bearer(owner.accessToken), payload: route('chat') });
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const anonymous = await app.inject({ method: 'POST', url: '/v1/admin/companion-provider/chat/test' }); expect(anonymous.statusCode).toBe(401);
    const user = (await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email: 'model-user@qa.local', password: 'temporary-test-password', deviceId: 'model-user-device' } })).json();
    const denied = await app.inject({ method: 'POST', url: '/v1/admin/companion-provider/chat/test', headers: bearer(user.accessToken) }); expect(denied.statusCode).toBe(403);
    const changed = await app.inject({ method: 'POST', url: '/v1/admin/companion-provider/chat/test', headers: bearer(owner.accessToken), payload: { apiBaseUrl: 'https://other.companion.example/v1' } });
    expect(changed.statusCode).toBe(400); expect(changed.json().error.code).toBe('provider_credentials_required'); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('automatically looks up companion weather despite ordinary tool controls being off', async () => {
    const app = await appWith(await config()); const owner = await auth(app);
    await app.inject({ method: 'PUT', url: '/v1/admin/companion-provider/chat', headers: bearer(owner.accessToken), payload: route('chat') });
    const profiles = (await app.inject({ method: 'GET', url: '/v1/companions', headers: bearer(owner.accessToken) })).json();
    const input = request(profiles.companions[0].id); input.options.autoTools = false; input.messages[0]!.content = '长沙今天的天气怎么样';
    const observation = new Date(Date.now() + 28800 * 1000).toISOString().slice(0, 16);
    const weather = { timezone: 'Asia/Shanghai', utc_offset_seconds: 28800, current: { temperature_2m: 28, weather_code: 3, time: observation }, daily: { time: [observation.slice(0, 10)], temperature_2m_max: [30], temperature_2m_min: [25], weather_code: [3] } };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(weather), { headers: { 'content-type': 'application/json' } })).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '长沙现在28°C，今天是阴天。' } }] }), { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetchMock);
    const result = await app.inject({ method: 'POST', url: '/v1/chat', headers: bearer(owner.accessToken), payload: input });
    expect(result.statusCode).toBe(200); expect(result.json().text).toContain('28°C'); expect(result.json()).not.toHaveProperty('model');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('api.open-meteo.com');
    const modelBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1].body)); expect(modelBody.model).toBe('deepseek-chat'); expect(modelBody.messages.some((message: any) => String(message.content).includes('"temperature_2m":28'))).toBe(true);
    expect(modelBody.tools.some((tool: any) => tool.function.name === 'get_weather')).toBe(true);
    expect(result.json().tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'get_weather', status: 'completed' })]));
  });
  it('executes internal companion calculator calls using the administrator model', async () => {
    const app = await appWith(await config()); const owner = await auth(app);
    await app.inject({ method: 'PUT', url: '/v1/admin/companion-provider/chat', headers: bearer(owner.accessToken), payload: route('chat') });
    const profiles = (await app.inject({ method: 'GET', url: '/v1/companions', headers: bearer(owner.accessToken) })).json();
    const input = request(profiles.companions[0].id); input.options.autoTools = false; input.messages[0]!.content = '帮我算一下125乘8';
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'calc-1', type: 'function', function: { name: 'calculate', arguments: '{"expression":"125*8"}' } }] }, finish_reason: 'tool_calls' }] }), { headers: { 'content-type': 'application/json' } })).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '算好了，是1000。' } }] }), { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetchMock);
    const result = await app.inject({ method: 'POST', url: '/v1/chat', headers: bearer(owner.accessToken), payload: input });
    expect(result.statusCode).toBe(200); expect(result.json().text).toContain('1000');
    const followup = JSON.parse(String(fetchMock.mock.calls[1]?.[1].body)); expect(followup.model).toBe('deepseek-chat');
    const toolResult = followup.messages.find((message: any) => message.role === 'tool'); expect(JSON.parse(toolResult.content).data.result).toBe(1000);
    expect(result.json().tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'calculate', status: 'completed' })]));
  });

});
