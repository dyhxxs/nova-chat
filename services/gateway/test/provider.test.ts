import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerateRequest } from '@nova-chat/protocol';
import { loadConfig } from '../src/config.js';
import { AppDatabase } from '../src/database.js';
import { ModelProvider } from '../src/provider.js';

const databases: AppDatabase[] = [];
const temporaryDirectories: string[] = [];

async function provider() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'nova-chat-provider-test-'));
  temporaryDirectories.push(dataDir);
  const config = loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    SERVER_MASTER_KEY: 'provider-test-master-key-with-more-than-thirty-two-characters',
    OPENAI_API_KEY: 'provider-test-key',
    OPENAI_BASE_URL: 'https://provider.example/v1',
    OPENAI_MODEL: 'gpt-5.6-sol',
    ALLOWED_MODELS: 'gpt-5.6-sol,gpt-5.6-terra',
    PROVIDER_API_MODE: 'responses',
  });
  const database = new AppDatabase(config);
  databases.push(database);
  return new ModelProvider(config, database);
}

async function imageProvider(env: NodeJS.ProcessEnv = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'nova-chat-image-provider-test-'));
  temporaryDirectories.push(dataDir);
  const config = loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    SERVER_MASTER_KEY: 'provider-test-master-key-with-more-than-thirty-two-characters',
    OPENAI_API_KEY: 'provider-test-key',
    OPENAI_BASE_URL: 'https://provider.example/v1',
    OPENAI_MODEL: 'gpt-5.6-sol',
    ALLOWED_MODELS: 'gpt-5.6-sol,gpt-image-1,gpt-image-2',
    PROVIDER_API_MODE: 'responses',
    IMAGE_CONCURRENCY_RETRY_BASE_MS: '0',
    ...env,
  });
  const database = new AppDatabase(config);
  databases.push(database);
  const user = database.createUser({ email: 'image-test@example.local', password: 'test-password', displayName: 'Image Test' });
  return { provider: new ModelProvider(config, database), userId: user.id, database };
}

function request(overrides: Partial<GenerateRequest['options']> = {}): GenerateRequest {
  return {
    requestId: '11111111-1111-4111-8111-111111111111',
    conversationId: '22222222-2222-4222-8222-222222222222',
    deviceId: 'provider-test-device',
    messages: [{ role: 'user', content: 'hello', attachments: [] }],
    options: {
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      verbosity: 'medium',
      instructions: '',
      maxOutputTokens: 4096,
      webSearch: false,
      codeInterpreter: false,
      ...overrides,
    },
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, index: number): any {
  return JSON.parse(String((fetchMock.mock.calls[index]?.[1] as RequestInit | undefined)?.body ?? '{}'));
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  while (databases.length) databases.pop()?.close();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('ModelProvider compatibility', () => {
  it('falls back stale client model IDs to the administrator default and reports the actual model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'resp-1', output_text: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    const modelProvider = await provider();
    const deltas: string[] = [];

    const result = await modelProvider.generate(
      request({ model: 'gpt-5.6' }),
      { id: 'user-1' },
      new AbortController().signal,
      (delta) => deltas.push(delta),
    );

    expect(result).toMatchObject({ text: 'ok', model: 'gpt-5.6-sol', responseId: 'resp-1' });
    expect(deltas).toEqual(['ok']);
    expect(requestBody(fetchMock, 0).model).toBe('gpt-5.6-sol');
    expect(requestBody(fetchMock, 0).instructions).toContain('gpt-5.6-sol');
  });

  it('removes an unsupported code interpreter and retries once without duplicating output', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'invalid_request_error', message: 'Unsupported tool type: code_interpreter' } }, 400))
      .mockResolvedValueOnce(jsonResponse({ id: 'resp-2', output_text: 'compatible answer' }));
    vi.stubGlobal('fetch', fetchMock);
    const modelProvider = await provider();
    const deltas: string[] = [];

    const result = await modelProvider.generate(
      request({ webSearch: true, codeInterpreter: true }),
      { id: 'user-2' },
      new AbortController().signal,
      (delta) => deltas.push(delta),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock, 0).tools).toEqual([
      { type: 'web_search' },
      { type: 'code_interpreter', container: { type: 'auto' } },
    ]);
    expect(requestBody(fetchMock, 1).tools).toEqual([{ type: 'web_search' }]);
    expect(deltas).toEqual(['compatible answer']);
    expect(result).toMatchObject({ text: 'compatible answer', model: 'gpt-5.6-sol' });
  });

  it('removes all requested tools for a generic unsupported-tool response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'invalid_request_error', message: 'Unsupported tool type' } }, 400))
      .mockResolvedValueOnce(jsonResponse({ id: 'resp-3', output_text: 'plain answer' }));
    vi.stubGlobal('fetch', fetchMock);
    const modelProvider = await provider();

    await modelProvider.generate(
      request({ webSearch: true, codeInterpreter: true }),
      { id: 'user-3' },
      new AbortController().signal,
      () => undefined,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock, 1)).not.toHaveProperty('tools');
  });

  it('does not retry after any streamed output has already reached the client', async () => {
    const stream = [
      'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
      'data: {"type":"response.failed","response":{"error":{"code":"invalid_request_error","message":"Unsupported tool type: code_interpreter"}}}\n\n',
    ].join('');
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    const modelProvider = await provider();
    const deltas: string[] = [];

    await expect(modelProvider.generate(
      request({ codeInterpreter: true }),
      { id: 'user-4' },
      new AbortController().signal,
      (delta) => deltas.push(delta),
    )).rejects.toMatchObject({ code: 'provider_tool_unsupported' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(deltas).toEqual(['partial']);
  });

  it('routes image intent to /images/generations and stores the returned image', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: [{ b64_json: 'aGVsbG8=', mime_type: 'image/png' }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { provider: modelProvider, userId } = await imageProvider();
    const result = await modelProvider.generate(
      { ...request({ model: 'gpt-image-1' }), messages: [{ role: 'user', content: '生成一张猫的图片', attachments: [] }] },
      { id: userId },
      new AbortController().signal,
      () => undefined,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://provider.example/v1/images/generations');
    expect(requestBody(fetchMock, 0)).toMatchObject({ model: 'gpt-image-1', prompt: '生成一张猫的图片', n: 1 });
    expect(result).toMatchObject({ model: 'gpt-image-1', text: '', attachments: [{ mimeType: 'image/png', kind: 'image' }] });
  });

  it('maps an upstream account concurrency limit to a retryable Chinese error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      error: { code: 'provider_rate_limited', message: 'Concurrency limit exceeded for account, please retry later' },
    }, 429));
    vi.stubGlobal('fetch', fetchMock);
    const { provider: modelProvider, userId } = await imageProvider({ IMAGE_CONCURRENCY_RETRY_COUNT: '0' });

    let caught: unknown;
    try {
      await modelProvider.generate(
        { ...request({ model: 'gpt-image-2' }), messages: [{ role: 'user', content: '生成一张猫的图片', attachments: [] }] },
        { id: userId },
        new AbortController().signal,
        () => undefined,
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      status: 429,
      code: 'provider_concurrency_limited',
      retryable: true,
      message: expect.stringContaining('图片服务'),
    });
    expect((caught as Error).message).not.toContain('Concurrency limit exceeded');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('waits and retries the same image model after an upstream concurrency response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        error: { code: 'provider_rate_limited', message: 'Concurrency limit exceeded for account, please retry later' },
      }, 429))
      .mockResolvedValueOnce(jsonResponse({ data: [{ b64_json: 'aGVsbG8=', mime_type: 'image/png' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { provider: modelProvider, userId } = await imageProvider();

    const result = await modelProvider.generate(
      { ...request({ model: 'gpt-image-2' }), messages: [{ role: 'user', content: '生成一张猫的图片', attachments: [] }] },
      { id: userId },
      new AbortController().signal,
      () => undefined,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock, 0).model).toBe('gpt-image-2');
    expect(requestBody(fetchMock, 1).model).toBe('gpt-image-2');
    expect(result).toMatchObject({ model: 'gpt-image-2', attachments: [{ kind: 'image' }] });
  });

  it('serializes image calls from different users sharing the administrator provider account', async () => {
    let resolveFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValueOnce(jsonResponse({ data: [{ b64_json: 'aGVsbG8=', mime_type: 'image/png' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { provider: modelProvider, userId, database } = await imageProvider({ MAX_CONCURRENT_IMAGE_REQUESTS: '1' });
    const secondUser = database.createUser({ email: 'image-test-2@example.local', password: 'test-password', displayName: 'Image Test 2' });
    const imageRequest = { ...request({ model: 'gpt-image-2' }), messages: [{ role: 'user' as const, content: '生成一张猫的图片', attachments: [] }] };

    const first = modelProvider.generate(imageRequest, { id: userId }, new AbortController().signal, () => undefined);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const second = modelProvider.generate(imageRequest, { id: secondUser.id }, new AbortController().signal, () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFirst(jsonResponse({ data: [{ b64_json: 'aGVsbG8=', mime_type: 'image/png' }] }));
    await first;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await second;
  });

  it('cancels an image request while it is waiting in the shared provider queue', async () => {
    let resolveFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const fetchMock = vi.fn().mockImplementationOnce(() => firstResponse);
    vi.stubGlobal('fetch', fetchMock);
    const { provider: modelProvider, userId, database } = await imageProvider({ MAX_CONCURRENT_IMAGE_REQUESTS: '1' });
    const secondUser = database.createUser({ email: 'image-test-cancel@example.local', password: 'test-password', displayName: 'Image Test Cancel' });
    const imageRequest = { ...request({ model: 'gpt-image-2' }), messages: [{ role: 'user' as const, content: '生成一张猫的图片', attachments: [] }] };

    const first = modelProvider.generate(imageRequest, { id: userId }, new AbortController().signal, () => undefined);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const queuedController = new AbortController();
    const queued = modelProvider.generate(imageRequest, { id: secondUser.id }, queuedController.signal, () => undefined);
    queuedController.abort();

    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFirst(jsonResponse({ data: [{ b64_json: 'aGVsbG8=', mime_type: 'image/png' }] }));
    await first;
  });

  it.each([
    '生成照片',
    '帮我生成一张照片',
    '做一个头像',
    '给我做一张壁纸',
    '生照片',
    '不要文字，生成一张照片',
  ])('automatically routes Chinese photo requests (%s) to the image model', async (prompt) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: [{ b64_json: 'aGVsbG8=', mime_type: 'image/png' }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { provider: modelProvider, userId } = await imageProvider();
    const result = await modelProvider.generate(
      { ...request({ model: 'gpt-5.6-sol' }), messages: [{ role: 'user', content: prompt, attachments: [] }] },
      { id: userId },
      new AbortController().signal,
      () => undefined,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://provider.example/v1/images/generations');
    expect(requestBody(fetchMock, 0)).toMatchObject({ model: 'gpt-image-2', prompt, n: 1 });
    expect(result).toMatchObject({ model: 'gpt-image-2', attachments: [{ mimeType: 'image/png', kind: 'image' }] });
  });

  it('returns writing and a real image attachment for a text-plus-image request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: [{ b64_json: 'aGVsbG8=', mime_type: 'image/png' }],
      }))
      .mockResolvedValueOnce(jsonResponse({ id: 'resp-paired', output_text: '春风从窗边经过，带来一段温柔的文字。' }));
    vi.stubGlobal('fetch', fetchMock);
    const { provider: modelProvider, userId } = await imageProvider();
    const deltas: string[] = [];
    const result = await modelProvider.generate(
      { ...request({ model: 'gpt-5.6-sol' }), messages: [{ role: 'user', content: '写一段关于春天的短文，并配一张自然风格的图', attachments: [] }] },
      { id: userId },
      new AbortController().signal,
      (delta) => deltas.push(delta),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://provider.example/v1/images/generations');
    expect(requestBody(fetchMock, 0).prompt).toContain('不要在图片中绘制文字');
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('https://provider.example/v1/responses');
    expect(requestBody(fetchMock, 1).instructions).toContain('不要输出图片提示词');
    expect(result).toMatchObject({ model: 'gpt-5.6-sol', text: '春风从窗边经过，带来一段温柔的文字。', attachments: [{ kind: 'image' }] });
    expect(deltas).toEqual(['春风从窗边经过，带来一段温柔的文字。']);
  });

  it.each([
    '不要生成图片',
    '为什么不能生成照片',
    '怎么生成头像',
  ])('keeps negative or explanatory image wording on the text route (%s)', async (prompt) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'resp-text', output_text: '文字回答' }));
    vi.stubGlobal('fetch', fetchMock);
    const modelProvider = await provider();
    await modelProvider.generate(
      { ...request({ model: 'gpt-5.6-sol' }), messages: [{ role: 'user', content: prompt, attachments: [] }] },
      { id: 'user-image-negative' },
      new AbortController().signal,
      () => undefined,
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://provider.example/v1/responses');
  });


  it('routes “补充图片的完整” to image generation instead of returning prompt text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: [{ b64_json: 'aGVsbG8=', mime_type: 'image/png' }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { provider: modelProvider, userId } = await imageProvider();
    const previousImage = { id: '00000000-0000-4000-8000-000000000012', name: 'generated.png', mimeType: 'image/png', size: 100, kind: 'image' as const };
    const result = await modelProvider.generate(
      {
        ...request({ model: 'gpt-5.6-sol' }),
        messages: [
          { role: 'user', content: '生成一张人物照片', attachments: [] },
          { role: 'assistant', content: '', attachments: [previousImage] },
          { role: 'user', content: '补充图片的完整', attachments: [] },
        ],
      },
      { id: userId },
      new AbortController().signal,
      () => undefined,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://provider.example/v1/images/generations');
    expect(requestBody(fetchMock, 0).prompt).toContain('本次修改要求：补充图片的完整');
    expect(result).toMatchObject({ attachments: [{ kind: 'image' }] });
  });

  it('routes image follow-ups with an image reference to the image model and carries the prompt chain', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: [{ b64_json: 'aGVsbG8=', mime_type: 'image/png' }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { provider: modelProvider, userId } = await imageProvider();
    const previousImage = { id: '00000000-0000-4000-8000-000000000010', name: 'generated.png', mimeType: 'image/png', size: 100, kind: 'image' as const };
    const result = await modelProvider.generate(
      {
        ...request({ model: 'gpt-5.6-sol' }),
        messages: [
          { role: 'user', content: '生成一张人物照片，室外自然光', attachments: [] },
          { role: 'assistant', content: '', attachments: [previousImage] },
          { role: 'user', content: '我不满意，改成全身的 [Image #1]', attachments: [] },
        ],
      },
      { id: userId },
      new AbortController().signal,
      () => undefined,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://provider.example/v1/images/generations');
    expect(requestBody(fetchMock, 0).model).toBe('gpt-image-2');
    expect(requestBody(fetchMock, 0).prompt).toContain('原始创作要求：生成一张人物照片，室外自然光');
    expect(requestBody(fetchMock, 0).prompt).toContain('本次修改要求：我不满意，改成全身的 [Image #1]');
    expect(result).toMatchObject({ model: 'gpt-image-2', attachments: [{ kind: 'image' }] });
  });

  it('includes a completed assistant image in normal vision questions without sending an invalid assistant attachment', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'resp-vision', output_text: '这是一张插画。' }));
    vi.stubGlobal('fetch', fetchMock);
    const { provider: modelProvider, userId, database } = await imageProvider();
    const imagePath = path.join(database.uploadsDir, 'vision.png');
    await writeFile(imagePath, png);
    database.createFile({
      id: '00000000-0000-4000-8000-000000000011',
      userId,
      name: 'vision.png',
      mimeType: 'image/png',
      size: png.length,
      kind: 'image',
      storagePath: imagePath,
    });

    await modelProvider.generate(
      {
        ...request({ model: 'gpt-5.6-sol' }),
        messages: [
          { role: 'user', content: '生成一张蓝天白云插画', attachments: [] },
          { role: 'assistant', content: '', attachments: [{ id: '00000000-0000-4000-8000-000000000011', name: 'vision.png', mimeType: 'image/png', size: png.length, kind: 'image' }] },
          { role: 'user', content: '这张图是什么风格？', attachments: [] },
        ],
      },
      { id: userId },
      new AbortController().signal,
      () => undefined,
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://provider.example/v1/responses');
    const body = requestBody(fetchMock, 0);
    expect(body.input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: expect.arrayContaining([
          expect.objectContaining({ type: 'input_image', image_url: expect.stringContaining('data:image/png;base64,') }),
        ]),
      }),
    ]));
    expect(body.input).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', attachments: expect.anything() }),
    ]));
  });

  it('retries image generation without response_format when the provider rejects that optional field', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'invalid_request_error', message: 'response_format is not supported' } }, 400))
      .mockResolvedValueOnce(new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { provider: modelProvider, userId } = await imageProvider();

    const result = await modelProvider.generate(
      { ...request({ model: 'gpt-image-1' }), messages: [{ role: 'user', content: '画一张海报', attachments: [] }] },
      { id: userId },
      new AbortController().signal,
      () => undefined,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock, 0)).toHaveProperty('response_format', 'b64_json');
    expect(requestBody(fetchMock, 1)).not.toHaveProperty('response_format');
    expect(result).toMatchObject({ model: 'gpt-image-1', attachments: [{ mimeType: 'image/png', kind: 'image', size: png.length }] });
  });

  it('falls back to another configured image model when image generation is unavailable', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'model_not_found', message: 'model not found' } }, 404))
      .mockResolvedValueOnce(jsonResponse({ data: [{ base64: 'aGVsbG8=', mime_type: 'image/png' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { provider: modelProvider, userId } = await imageProvider();
    const result = await modelProvider.generate(
      { ...request({ model: 'gpt-image-1' }), messages: [{ role: 'user', content: '画一张海报', attachments: [] }] },
      { id: userId },
      new AbortController().signal,
      () => undefined,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock, 0).model).toBe('gpt-image-1');
    expect(requestBody(fetchMock, 1).model).toBe('gpt-image-2');
    expect(result.model).toBe('gpt-image-2');
  });

  it('falls back to another configured text model when the provider is temporarily unavailable', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'server_error', message: 'temporary failure' } }, 503))
      .mockResolvedValueOnce(jsonResponse({ id: 'resp-fallback', output_text: '备用模型已响应' }));
    vi.stubGlobal('fetch', fetchMock);
    const modelProvider = await provider();
    const result = await modelProvider.generate(
      request(),
      { id: 'user-text-fallback' },
      new AbortController().signal,
      () => undefined,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock, 0).model).toBe('gpt-5.6-sol');
    expect(requestBody(fetchMock, 1).model).toBe('gpt-5.6-terra');
    expect(result).toMatchObject({ model: 'gpt-5.6-terra', text: '备用模型已响应' });
  });

  it('turns provider pricing errors into an actionable Chinese administrator message', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({
      error: { code: 'invalid_request_error', message: 'Model gpt-5.6 has not been priced by the administrator yet.' },
    }, 400));
    vi.stubGlobal('fetch', fetchMock);
    const modelProvider = await provider();

    await expect(modelProvider.generate(
      request(),
      { id: 'user-5' },
      new AbortController().signal,
      () => undefined,
    )).rejects.toMatchObject({
      code: 'provider_model_unpriced',
      message: expect.stringContaining('管理员配置的模型'),
    });
  });
});
