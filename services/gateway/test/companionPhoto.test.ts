import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMPANION_DEFAULT_PERSONA_PROMPT, type GenerateRequest, companionContextSchema } from '@nova-chat/protocol';
import { loadConfig } from '../src/config.js';
import { AppDatabase } from '../src/database.js';
import { ModelProvider } from '../src/provider.js';
import { buildCompanionPhotoPrompt, companionPhotoIntent, companionPhotoScene, companionPhotoSubject } from '../src/companionPhoto.js';

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
  it.each(['那你能把书的封面发给我看看嘛', '把书封面发给我看看吗', '给我看看那本书', '发一张早餐的照片', '发张窗外的图片'])('routes an object request without a selfie: %s', content => {
    const value = input(content);
    expect(companionPhotoIntent(value)).toBe(true);
    expect(companionPhotoSubject(value)).toBe('object');
    expect(buildCompanionPhotoPrompt(value, companionContextSchema.parse({}), true)).toContain('no companion, portrait');
  });

  it('uses the companion\'s own object offer for an internal photo action', () => {
    const value: GenerateRequest = { ...input('今天过得怎么样'), companionAction: 'photo' };
    value.messages.push({ role: 'assistant', content: '刚买了《恶意》，给你看看这本书的封面', attachments: [] });
    expect(companionPhotoSubject(value)).toBe('object');
    const prompt = buildCompanionPhotoPrompt(value, companionContextSchema.parse({}), false);
    expect(prompt).toContain('《恶意》');
    expect(prompt).toContain('Companion photo offer to fulfill:');
    expect(prompt).toContain('no companion, portrait');
  });

  it('keeps scene details sent as consecutive companion chat bubbles', () => {
    const value = input('你在看什么');
    value.messages.push(
      { role: 'assistant', content: '翻到一本挺有意思的书', attachments: [] },
      { role: 'assistant', content: '是《恶意》，我在窗边看', attachments: [] },
      { role: 'user', content: '把那本书的封面发给我看看', attachments: [] },
    );
    const prompt = buildCompanionPhotoPrompt(value, companionContextSchema.parse({}), false);
    expect(prompt).toContain('《恶意》');
    expect(prompt).toContain('窗边');
  });

  it.each(['只要你的自拍', '只拍你拿着那本书的照片', '发张你穿这件衣服的照片'])('keeps an explicitly requested person in frame: %s', content => {
    expect(companionPhotoSubject(input(content))).toBe('companion');
  });

  it('shares a book cover without changing an existing reference face, then preserves that face in a portrait', async () => {
    const { db, user, profile, provider } = await setup();
    const fetchMock = vi.fn().mockImplementation(async () => imageResponse()); vi.stubGlobal('fetch', fetchMock);
    const value = { ...input('发张你的自拍'), companionId: profile.id, companion: companionContextSchema.strip().parse(profile) };
    const first = await provider.generate(value, user, new AbortController().signal, () => {});
    const faceId = first.attachments![0]!.id;
    value.messages.push({ role: 'assistant', content: '我在看《恶意》', attachments: first.attachments! }, { role: 'user', content: '把书的封面发给我看看', attachments: [] });
    const cover = await provider.generate(value, user, new AbortController().signal, () => {});
    expect(fetchMock.mock.calls[1]![0]).toBe('https://images.example/v1/images/generations');
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1].body)).prompt).toContain('《恶意》');
    expect(db.getCompanion(user.id, profile.id)?.avatarFileId).toBe(faceId);
    value.messages.push({ role: 'assistant', content: cover.text, attachments: cover.attachments! }, { role: 'user', content: '再来一张', attachments: [] });
    expect(companionPhotoSubject(value)).toBe('object');
    value.messages.push({ role: 'user', content: '发张你拿着那本书的照片', attachments: [] });
    await provider.generate(value, user, new AbortController().signal, () => {});
    expect(fetchMock.mock.calls[2]![0]).toBe('https://images.example/v1/images/edits');
    expect(db.getCompanion(user.id, profile.id)?.avatarFileId).toBe(faceId);
  });

  it('does not establish a reference face from the first object image', async () => {
    const { db, user, profile, provider } = await setup();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => imageResponse()));
    await provider.generate({ ...input('发张早餐的照片'), companionId: profile.id, companion: companionContextSchema.strip().parse(profile) }, user, new AbortController().signal, () => {});
    expect(db.getCompanion(user.id, profile.id)?.avatarFileId).toBeNull();
  });


  it.each(['Lumi', '沈知意', '自定义人物'])('uses the saved %s persona to establish a face instead of caller context or another character', async name => {
    const { db, user, provider } = await setup();
    const custom = '你是陆川，31岁成年男性，修复旧家具的木工。短卷发，穿亚麻衬衫，安静有耐心，喜欢山间徒步。';
    const profile = name === '自定义人物'
      ? db.createCompanion(user.id, { name, personaPrompt: custom })
      : name === 'Lumi' ? db.createCompanion(user.id) : db.listCompanions(user.id).find(candidate => candidate.name === name)!;
    expect(profile.avatarFileId).toBeNull(); expect(profile.appearance).toBe('');
    const fetchMock = vi.fn().mockImplementation(async () => imageResponse()); vi.stubGlobal('fetch', fetchMock);
    const stale = { ...companionContextSchema.strip().parse(profile), personaPrompt: '错误人物：太空机器人', appearance: '金属外壳' };
    const first = await provider.generate({ ...input('发张你在窗边的日常自拍'), companionId: profile.id, companion: stale }, user, new AbortController().signal, () => {});
    expect(fetchMock.mock.calls[0]![0]).toBe('https://images.example/v1/images/generations');
    const prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body)).prompt;
    expect(prompt).toContain(profile.personaPrompt); expect(prompt).toContain('background, lifestyle, tastes and temperament');
    expect(prompt).not.toContain('太空机器人'); expect(prompt).not.toContain('金属外壳');
    if (name !== 'Lumi') expect(prompt).not.toContain(COMPANION_DEFAULT_PERSONA_PROMPT);
    expect(db.getCompanion(user.id, profile.id)?.avatarFileId).toBe(first.attachments![0]!.id);
  });

  it('uses brief character traits only when the complete persona is absent, with explicit appearance priority', () => {
    const profile = companionContextSchema.parse({ name: '顾言', personality: ['35岁成年男性，做建筑设计，喜欢干净利落的衣服'], speakingStyle: ['话少，直接'], appearance: '短发、灰色眼睛' });
    const prompt = buildCompanionPhotoPrompt(input('发张自拍'), profile, false);
    expect(prompt).toContain('做建筑设计'); expect(prompt).toContain('话少，直接'); expect(prompt).toContain('短发、灰色眼睛');
    expect(prompt).toContain('explicit appearance preferences take precedence over persona appearance');
    const full = buildCompanionPhotoPrompt(input('发张自拍'), { ...profile, personaPrompt: '你是成年女性陶艺师，有一头红色卷发。' }, false);
    expect(full).toContain('红色卷发'); expect(full).not.toContain('做建筑设计'); expect(full).not.toContain('话少，直接');
    expect(full).not.toContain(COMPANION_DEFAULT_PERSONA_PROMPT);
  });

  it('keeps the selected reference face despite conflicting persona appearance', async () => {
    const { db, user, profile, provider } = await setup();
    const fetchMock = vi.fn().mockImplementation(async () => imageResponse()); vi.stubGlobal('fetch', fetchMock);
    const request = { ...input('发张自拍'), companionId: profile.id, companion: companionContextSchema.strip().parse(profile) };
    const first = await provider.generate(request, user, new AbortController().signal, () => {}); const face = first.attachments![0]!;
    db.updateCompanion(user.id, profile.id, { avatarFileId: face.id, appearance: '长发、绿色眼睛', personaPrompt: '成年女性，金色卷发，活泼。' });
    await provider.generate({ ...request, conversationId: randomUUID(), messages: input('发张在书店的照片').messages }, user, new AbortController().signal, () => {});
    expect(fetchMock.mock.calls[1]![0]).toBe('https://images.example/v1/images/edits');
    const form = fetchMock.mock.calls[1]![1].body as FormData;
    expect(form.get('prompt')).toContain('Do not redesign the reference person to match the persona');
    expect(form.get('prompt')).toContain('an attached identity reference takes precedence');
    expect(Buffer.from(await (form.get('image') as Blob).arrayBuffer())).toEqual(png);
    expect(db.getCompanion(user.id, profile.id)?.avatarFileId).toBe(face.id);
  });

  it('does not save an obsolete first face when the user changes appearance during generation', async () => {
    const { db, user, profile, provider } = await setup();
    let complete!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { complete = resolve; });
    const fetchMock = vi.fn().mockReturnValue(pending); vi.stubGlobal('fetch', fetchMock);
    const generation = provider.generate({ ...input('发张自拍'), companionId: profile.id, companion: companionContextSchema.strip().parse(profile) }, user, new AbortController().signal, () => {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    db.updateCompanion(user.id, profile.id, { appearance: '新设定：成年女性，长发' });
    complete(imageResponse()); const result = await generation;
    expect(result.attachments).toHaveLength(1); expect(db.getCompanion(user.id, profile.id)?.avatarFileId).toBeNull();
  });

  it('routes short photo follow-ups while keeping explanations and ordinary chat as text', () => {
    const request = input('发张自拍给我');
    for (const content of ['发张自拍给我', '生成一张你的照片', '制作一张自拍', '那给我看看你改稿的样子', '让我看看你在咖啡馆看书的样子']) { request.messages[0]!.content = content; expect(companionPhotoIntent(request), content).toBe(true); }
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
    const request = input('发张你在旧场景的照片');
    request.messages.push({ role: 'assistant', content: '刚把窗边的灯打开，继续看书。', attachments: [] }, { role: 'user', content: '发一张你现在的照片', attachments: [] });
    expect(companionPhotoScene(request)).toContain('刚把窗边的灯打开');
    expect(companionPhotoScene(request)).toContain('发一张你现在的照片');
    expect(companionPhotoScene(request)).not.toContain('旧场景');
  });


  it('carries the manuscript scene through several non-scene replies into the actual image request', async () => {
    const { user, profile, provider } = await setup();
    const request = { ...input('在干嘛？'), companionId: profile.id, companion: companionContextSchema.strip().parse(profile) };
    request.messages.push(
      { role: 'assistant', content: '在房间书桌前改稿', attachments: [] },
      { role: 'user', content: '改怎么样了', attachments: [] },
      { role: 'assistant', content: '卡在结尾 第三遍了还是不对', attachments: [] },
      { role: 'user', content: '给我看看你改稿的样子', attachments: [] },
      { role: 'assistant', content: '现在这个样子给你看 我怕你以后看见我就想起一片红', attachments: [] },
      { role: 'user', content: '为啥', attachments: [] },
      { role: 'assistant', content: '因为电脑稿子满屏都是划掉的字 看着像案发现场', attachments: [] },
      { role: 'user', content: '给我看看嘛 我给你买零食', attachments: [] },
      { role: 'assistant', content: '零食收买不了我', attachments: [] },
      { role: 'user', content: '我给你跪下了', attachments: [] },
      { role: 'assistant', content: '跪着也没用', attachments: [] },
      { role: 'user', content: '发张你现在的照片给我', attachments: [] },
    );
    const fetchMock = vi.fn().mockImplementation(async () => imageResponse()); vi.stubGlobal('fetch', fetchMock);
    await provider.generate(request, user, new AbortController().signal, () => {});
    const prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body)).prompt;
    for (const detail of ['在房间书桌前改稿', '卡在结尾', '满屏都是划掉的字', '零食收买不了我', '跪着也没用', '发张你现在的照片给我']) expect(prompt).toContain(detail);
    expect(prompt.indexOf('Companion: 在房间书桌前改稿')).toBeLessThan(prompt.indexOf('Companion: 跪着也没用'));
    expect(prompt).toContain('red manuscript revisions are ink or editing marks, not blood');
    expect(prompt).toContain('visibly depict it with its relevant objects');
  });

  it('keeps fulfilled scenes chronological while omitting orphan and refused photo details', () => {
    const request = input('发张在咖啡馆的自拍');
    request.messages.push(
      { role: 'assistant', content: '这张给你', attachments: [{ id: randomUUID(), name: 'photo.png', mimeType: 'image/png', size: png.length, kind: 'image' }] },
      { role: 'user', content: '你回家了吗', attachments: [] },
      { role: 'assistant', content: '回了 在书桌前改稿', attachments: [] },
      { role: 'user', content: '发张你穿红色礼服在天台的照片', attachments: [] },
      { role: 'assistant', content: '先把稿子改完', attachments: [] },
      { role: 'user', content: '发张海边的照片', attachments: [] },
      { role: 'user', content: '发一张你现在在干嘛的照片', attachments: [] },
    );
    const scene = companionPhotoScene(request);
    expect(scene).toContain('咖啡馆'); expect(scene).toContain('回了 在书桌前改稿'); expect(scene).toContain('先把稿子改完');
    expect(scene).not.toContain('红色礼服'); expect(scene).not.toContain('天台'); expect(scene).not.toContain('海边');
    const independent = input('发张你在公园散步的照片');
    expect(companionPhotoScene(independent)).not.toContain('改稿'); expect(companionPhotoScene(independent)).not.toContain('咖啡馆');
  });

  it('bounds recent scene history while retaining the latest explicit change of place and activity', () => {
    const request = input('旧的活动');
    request.messages.push({ role: 'assistant', content: '旧活动'.repeat(2000), attachments: [] });
    for (let index = 0; index < 20; index += 1) request.messages.push(
      { role: 'user', content: String(index) + '用户'.repeat(1000), attachments: [] },
      { role: 'assistant', content: String(index) + '近况'.repeat(2000), attachments: [] },
    );
    request.messages.push({ role: 'user', content: '稿子晚点再改 发张去公园散步的照片 穿蓝色衬衫', attachments: [] });
    const scene = companionPhotoScene(request);
    expect(scene.length).toBeLessThan(14500); expect(scene).not.toContain('旧活动'); expect(scene).toContain('Companion: 19');
    expect(scene).toContain('Current photo request: 稿子晚点再改 发张去公园散步的照片 穿蓝色衬衫');
    const prompt = buildCompanionPhotoPrompt(request, companionContextSchema.parse({}), true);
    expect(prompt).toContain('latest explicit new location, activity, clothing or pose overrides incompatible older scene details');
    expect(prompt).toContain('preserve the same face');
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
