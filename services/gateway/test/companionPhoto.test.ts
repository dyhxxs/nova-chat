import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type GenerateRequest, companionContextSchema } from '@nova-chat/protocol';
import { loadConfig } from '../src/config.js';
import { AppDatabase } from '../src/database.js';
import { ModelProvider } from '../src/provider.js';
import { companionPhotoIntent, companionPhotoScene } from '../src/companionPhoto.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPacAAAAASUVORK5CYII=', 'base64');
const dirs: string[] = [];
const databases: AppDatabase[] = [];
function input(content: string): GenerateRequest {
  return { requestId: randomUUID(), conversationId: randomUUID(), deviceId: 'companion-photo-regression', messages: [{ role: 'user', content, attachments: [] }], options: { model: 'ignored', instructions: '', reasoningEffort: 'none', verbosity: 'low', maxOutputTokens: 512, autoTools: false, webSearch: false, codeInterpreter: false, knowledgeBase: false } };
}
const imageResponse = () => new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { headers: { 'content-type': 'application/json' } });
async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'nova-companion-photo-regression-')); dirs.push(dir);
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: dir, LOG_LEVEL: 'silent', SERVER_MASTER_KEY: 'companion-photo-test-master-more-than-32-characters' });
  const db = new AppDatabase(config); databases.push(db);
  const user = db.createUser({ email: 'photo@qa.local', password: 'temporary-test-password', displayName: 'QA' });
  db.setCompanionProviderSettings('image', { apiBaseUrl: 'https://images.example/v1', apiKey: 'private-image-test-secret', apiMode: 'chat-completions', authMode: 'bearer', defaultModel: 'gpt-image-2', allowedModels: ['gpt-image-2'] }, user.id);
  db.setCompanionProviderSettings('chat', { apiBaseUrl: 'https://chat.example/v1', apiKey: 'private-chat-test-secret', apiMode: 'chat-completions', authMode: 'bearer', defaultModel: 'deepseek-flash', allowedModels: ['deepseek-flash'] }, user.id);
  const profile = db.createCompanion(user.id, { appearance: '28岁的成年女性，短发，棕色眼睛' });
  return { db, user, profile, provider: new ModelProvider(config, db) };
}
afterEach(async () => {
  vi.unstubAllGlobals(); for (const db of databases.splice(0)) db.close();
  for (const dir of dirs.splice(0)) { expect(path.dirname(path.resolve(dir))).toBe(path.resolve(tmpdir())); expect(path.basename(dir)).toMatch(/^nova-companion-photo-regression-/); await rm(dir, { recursive: true, force: true }); }
});

describe('companion photo conversations', () => {
  it('routes short photo follow-ups while keeping explanations and ordinary chat as text', () => {
    const request = input('发张自拍给我');
    for (const content of ['发张自拍给我', '生成一张你的照片', '制作一张自拍']) { request.messages[0]!.content = content; expect(companionPhotoIntent(request), content).toBe(true); }
    request.messages.unshift({ role: 'assistant', content: '', attachments: [{ id: randomUUID(), name: 'selfie.png', mimeType: 'image/png', size: png.length, kind: 'image' }] });
    for (const content of ['比个心', '再来一张', '换件衣服', '换个姿势', '我要全身的', '给我侧脸']) { request.messages[1]!.content = content; expect(companionPhotoIntent(request), content).toBe(true); }
    for (const content of ['比心是什么意思？', '不要发照片', '不要生成照片', '怎么生成照片', '照片为什么报错？', '今天运动后全身酸痛', '你换衣服了吗？', '这张照片是在比心吗？']) { request.messages[1]!.content = content; expect(companionPhotoIntent(request), content).toBe(false); }
  });

  it('continues the same face for a heart pose and then chats through the text-only route', async () => {
    const { db, user, profile, provider } = await setup();
    const fetchMock = vi.fn().mockResolvedValueOnce(imageResponse()).mockResolvedValueOnce(imageResponse()).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '刚刚那个比心有点笨拙，哈哈。' } }] }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const request = { ...input('发张你在咖啡馆的自拍'), companionId: profile.id, companion: companionContextSchema.strip().parse(profile) };
    const first = await provider.generate(request, user, new AbortController().signal, () => {});
    const face = first.attachments![0]!;
    request.messages.push({ role: 'assistant', content: first.text, attachments: [face] }, { role: 'user', content: '比个心', attachments: [] });
    const second = await provider.generate(request, user, new AbortController().signal, () => {});
    expect(second.text).toBe('给你比个心 ♡'); expect(second.attachments).toHaveLength(1);
    expect(fetchMock.mock.calls[1]![0]).toBe('https://images.example/v1/images/edits');
    const form = fetchMock.mock.calls[1]![1].body as FormData;
    expect(Buffer.from(await (form.get('image') as Blob).arrayBuffer())).toEqual(png);
    expect(db.getCompanion(user.id, profile.id)?.avatarFileId).toBe(face.id);
    request.messages.push({ role: 'assistant', content: second.text, attachments: second.attachments! }, { role: 'user', content: '哈哈你平时喜欢听什么音乐', attachments: [] });
    const reply = await provider.generate(request, user, new AbortController().signal, () => {});
    expect(reply.text).toContain('比心'); expect(fetchMock.mock.calls[2]![0]).toBe('https://chat.example/v1/chat/completions');
    const body = JSON.parse(String(fetchMock.mock.calls[2]![1].body));
    expect(body.model).toBe('deepseek-flash'); expect(body.messages.every((message: { content: unknown }) => typeof message.content === 'string')).toBe(true);
    expect(JSON.stringify(body)).not.toContain('image_url'); expect(JSON.stringify(body)).not.toContain('data:image');
    expect(JSON.stringify(body)).toContain('本轮已分享一张');
  });

  it('keeps a rejected photo request out of the next independent photo scene without changing its original prompt', async () => {
    const { user, profile, provider } = await setup();
    const fetchMock = vi.fn().mockResolvedValueOnce(imageResponse()).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'moderation_blocked' } }), { status: 400 })).mockResolvedValueOnce(imageResponse());
    vi.stubGlobal('fetch', fetchMock);
    const request = { ...input('发张你在咖啡馆看书的自拍'), companionId: profile.id, companion: companionContextSchema.strip().parse(profile) };
    const first = await provider.generate(request, user, new AbortController().signal, () => {});
    const face = first.attachments![0]!;
    request.messages.push({ role: 'assistant', content: first.text, attachments: [face] }, { role: 'user', content: '不是让你发一下你的比基尼照片给我吗', attachments: [] });
    await expect(provider.generate(request, user, new AbortController().signal, () => {})).rejects.toMatchObject({ code: 'provider_content_rejected', retryable: false });
    expect((fetchMock.mock.calls[1]![1].body as FormData).get('prompt')).toContain('不是让你发一下你的比基尼照片给我吗');
    // Failed assistant bubbles are omitted from the wire history, leaving orphan user turns.
    request.messages.push({ role: 'user', content: '那发一张你在干嘛的照片给我', attachments: [] });
    const next = await provider.generate(request, user, new AbortController().signal, () => {});
    expect(next.attachments).toHaveLength(1);
    const form = fetchMock.mock.calls[2]![1].body as FormData;
    expect(form.get('prompt')).toContain('那发一张你在干嘛的照片给我');
    expect(form.get('prompt')).toContain('咖啡馆看书');
    expect(form.get('prompt')).not.toContain('比基尼');
    expect(Buffer.from(await (form.get('image') as Blob).arrayBuffer())).toEqual(png);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('uses the current request, a fulfilled photo scene and the companion activity rather than unrelated user history', () => {
    const request = input('第一次无关的照片要求');
    request.messages.push({ role: 'assistant', content: '刚把窗边的灯打开，继续看书。', attachments: [] }, { role: 'user', content: '发一张你现在的照片', attachments: [] });
    expect(companionPhotoScene(request)).toContain('刚把窗边的灯打开');
    expect(companionPhotoScene(request)).toContain('发一张你现在的照片');
    expect(companionPhotoScene(request)).not.toContain('第一次无关');
  });

  it('reports an upstream photo moderation rejection without altering the reference or retrying', async () => {
    const { db, user, profile, provider } = await setup();
    const fetchMock = vi.fn().mockResolvedValueOnce(imageResponse()).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'moderation_blocked', message: 'Your request was rejected by the safety system. private-image-test-secret https://images.example/private' } }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    const request = { ...input('发张自拍'), companionId: profile.id, companion: companionContextSchema.strip().parse(profile) };
    const first = await provider.generate(request, user, new AbortController().signal, () => {}); const face = first.attachments![0]!;
    request.messages.push({ role: 'assistant', content: first.text, attachments: [face] }, { role: 'user', content: '再发一张照片给我', attachments: [] });
    await expect(provider.generate(request, user, new AbortController().signal, () => {})).rejects.toMatchObject({ code: 'provider_content_rejected', status: 422, retryable: false, message: '这次照片没有通过图片服务审核，请修改描述后重新发送。' });
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(db.getCompanion(user.id, profile.id)?.avatarFileId).toBe(face.id);
  });

  it('keeps unknown photo request rejections separate from model configuration errors', async () => {
    const { user, profile, provider } = await setup();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'request rejected private-image-test-secret' } }), { status: 400 })); vi.stubGlobal('fetch', fetchMock);
    await expect(provider.generate({ ...input('发张自拍'), companionId: profile.id, companion: companionContextSchema.strip().parse(profile) }, user, new AbortController().signal, () => {})).rejects.toMatchObject({ code: 'provider_image_request_rejected', status: 422, retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
