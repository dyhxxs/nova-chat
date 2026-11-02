import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { ModelProvider } from '../src/provider.js';

const apps: FastifyInstance[] = [];
const directories: string[] = [];
const bootstrapToken = 'language-learning-bootstrap-token-2026';

async function setup(overrides: Record<string, string> = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'nova-language-learning-test-'));
  directories.push(dataDir);
  const config = loadConfig({
    NODE_ENV: 'test', DATA_DIR: dataDir, LOG_LEVEL: 'silent', SERVER_MASTER_KEY: 'language-learning-test-master-key',
    ADMIN_BOOTSTRAP_TOKEN: bootstrapToken, OPENAI_API_KEY: 'model-provider-key', OPENAI_MODEL: 'gpt-5.6-sol',
    ALLOWED_MODELS: 'gpt-5.6-sol', VOICE_API_KEY: 'voice-environment-key', VOICE_BASE_URL: 'https://voice-environment.test/v1',
    REQUESTS_PER_MINUTE: '500', ...overrides,
  });
  const app = await buildServer(config as AppConfig);
  apps.push(app);
  const auth = await app.inject({ method: 'POST', url: '/v1/auth/bootstrap', payload: {
    email: 'language-admin@example.com', password: 'language-admin-password', displayName: 'Language Admin',
    deviceId: 'language-admin-device', bootstrapToken,
  } });
  expect(auth.statusCode).toBe(201);
  return { app, config, auth: auth.json() as { accessToken: string; user: { id: string; role: string } } };
}

function bearer(accessToken: string) { return { authorization: 'Bearer ' + accessToken }; }

afterEach(async () => {
  vi.restoreAllMocks();
  while (apps.length) await apps.pop()!.close();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('language learning agent', () => {
  it('lists the supported languages and keeps voice credentials private', async () => {
    const { app, auth } = await setup();
    expect((await app.inject({ url: '/v1/language-learning/config' })).statusCode).toBe(401);
    const response = await app.inject({ url: '/v1/language-learning/config', headers: bearer(auth.accessToken) });
    expect(response.statusCode).toBe(200);
    expect(response.json().languages.map((item: { id: string }) => item.id)).toEqual(['cantonese', 'english']);
    expect(response.json().voice.enabled).toBe(true);
    expect(response.body).not.toContain('voice-environment-key');
    expect(response.body).not.toContain('voice-environment.test');
  });

  it('returns a structured teaching turn with one actionable learning point', async () => {
    const { app, auth } = await setup();
    const generate = vi.spyOn(ModelProvider.prototype, 'generate').mockResolvedValue({
      text: JSON.stringify({
        reply: 'Could I have a latte, please?', translation: '我可以要一杯拿铁吗？', correction: '“Give me latte” → “Could I have a latte, please?”',
        pronunciation: '/kʊd aɪ hæv ə ˈlɑːteɪ/', lesson: 'Could I have… 是礼貌点单的常用句型。', followUp: '把 latte 换成 tea 再说一次。',
      }), model: 'test-language-model',
    });
    const response = await app.inject({ method: 'POST', url: '/v1/language-learning/chat', headers: bearer(auth.accessToken), payload: {
      languageId: 'english', message: 'Give me latte', history: [{ role: 'assistant', content: 'Let us practise ordering.' }], level: 'beginner', mode: 'conversation',
    } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ languageId: 'english', mode: 'conversation', reply: 'Could I have a latte, please?', speechText: 'Could I have a latte, please?', model: 'test-language-model' });
    expect(generate).toHaveBeenCalledOnce();
    const request = generate.mock.calls[0]![0];
    expect(request.options.instructions).toContain('LinguaSoul');
    expect(request.options.instructions).toContain('英语');
    expect(request.options.autoTools).toBe(false);
    expect(request.messages.at(-1)).toMatchObject({ role: 'user', content: 'Give me latte' });
  });

  it('falls back to plain text when the model does not return JSON', async () => {
    const { app, auth } = await setup();
    vi.spyOn(ModelProvider.prototype, 'generate').mockResolvedValue({ text: 'Try saying “How are you?”', model: 'plain-text-model' });
    const response = await app.inject({ method: 'POST', url: '/v1/language-learning/chat', headers: bearer(auth.accessToken), payload: { languageId: 'cantonese', message: '你食咗飯未？' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ languageId: 'cantonese', mode: 'conversation', reply: 'Try saying “How are you?”', translation: '', correction: '', pronunciation: '', lesson: '', followUp: '' });
  });

  it('forces the translation mode endpoint to teach a natural target-language expression', async () => {
    const { app, auth } = await setup();
    const generate = vi.spyOn(ModelProvider.prototype, 'generate').mockResolvedValue({ text: JSON.stringify({ reply: '我想飲茶。', translation: '我想喝茶。' }), model: 'translate-model' });
    const response = await app.inject({ method: 'POST', url: '/v1/language-learning/translate', headers: bearer(auth.accessToken), payload: { languageId: 'cantonese', message: '我想喝茶。', mode: 'conversation' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ languageId: 'cantonese', mode: 'translate', reply: '我想飲茶。', translation: '我想喝茶。' });
    expect(generate.mock.calls[0]![0].options.instructions).toContain('翻译练习');
  });

  it('uses the administrator-saved voice destination and never returns the full key', async () => {
    const { app, auth } = await setup();
    const initial = await app.inject({ url: '/v1/admin/voice-provider', headers: bearer(auth.accessToken) });
    expect(initial.statusCode).toBe(200);
    expect(initial.body).not.toContain('voice-environment-key');
    expect(initial.body).not.toContain('voice-environment.test');
    expect(initial.json().provider.apiBaseUrl).toBe('');
    const saved = await app.inject({ method: 'PUT', url: '/v1/admin/voice-provider', headers: bearer(auth.accessToken), payload: {
      apiBaseUrl: 'https://voice-database.test/v1', apiKey: 'voice-database-secret', ttsModel: 'tts-database', asrModel: 'asr-database', defaultVoiceId: 'zh_male_taocheng_uranus_bigtts',
    } });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain('voice-database-secret');
    expect(saved.json().provider).toMatchObject({ apiBaseUrl: 'https://voice-database.test/v1', apiKeySet: true, ttsModel: 'tts-database', asrModel: 'asr-database', defaultVoiceId: 'zh_male_taocheng_uranus_bigtts' });
    const languageConfig = await app.inject({ url: '/v1/language-learning/config', headers: bearer(auth.accessToken) });
    expect(languageConfig.json().voice.defaultVoiceId).toBe('zh_male_taocheng_uranus_bigtts');

    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const [input, init] = args;
      expect(String(input)).toBe('https://voice-database.test/v1/media/generate');
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer voice-database-secret');
      expect(String(init?.body)).toContain('tts-database');
      return new Response(JSON.stringify({ code: 200, data: { task_id: 'database-task' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const speech = await app.inject({ method: 'POST', url: '/v1/voice/speech', headers: bearer(auth.accessToken), payload: { requestId: '8f2a6f6a-9e25-4b15-90d2-9b5f0e17b6e1', text: 'Hello' } });
    expect(speech.statusCode).toBe(202);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
