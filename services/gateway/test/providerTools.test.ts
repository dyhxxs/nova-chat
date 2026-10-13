import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateRequestSchema, type ToolActivity } from '@nova-chat/protocol';
import { loadConfig } from '../src/config.js';
import { AppDatabase } from '../src/database.js';
import { ModelProvider } from '../src/provider.js';

const databases: AppDatabase[] = [];
const directories: string[] = [];
async function provider(mode: 'responses' | 'chat-completions' = 'responses') {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'nova-tool-provider-')); directories.push(dataDir);
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: dataDir, OPENAI_API_KEY: 'private-provider-key', OPENAI_BASE_URL: 'https://model.example/v1', PROVIDER_API_MODE: mode });
  const database = new AppDatabase(config); databases.push(database);
  return new ModelProvider(config, database);
}
function request(content = '帮我算一笔费用', options = {}) {
  return generateRequestSchema.parse({ requestId: '11111111-1111-4111-8111-111111111111', conversationId: '22222222-2222-4222-8222-222222222222', deviceId: 'test-tools-device', messages: [{ role: 'user', content }], options, context: { timezone: 'Asia/Shanghai' } });
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const sse = (events: unknown[]) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
const body = (mock: ReturnType<typeof vi.fn>, index: number) => JSON.parse(String(mock.mock.calls[index]?.[1].body));
const call = { type: 'function_call', call_id: 'call-1', name: 'calculate', arguments: '{"expression":"12*5"}' };
const signal = () => new AbortController().signal;
afterEach(async () => {
  vi.unstubAllGlobals(); vi.useRealTimers();
  for (const db of databases.splice(0)) db.close();
  await Promise.all(directories.splice(0).map((dir) => {
    const target = path.resolve(dir);
    if (path.dirname(target) !== path.resolve(tmpdir()) || !path.basename(target).startsWith('nova-tool-provider-')) throw new Error('Unsafe test cleanup target');
    return rm(target, { recursive: true, force: true });
  }));
});

describe('gateway function-calling round trips', () => {
  it('executes Responses JSON function calls and preserves reasoning with store:false', async () => {
    const reasoning = { id: 'reason-1', type: 'reasoning', encrypted_content: 'opaque-reasoning', summary: [] };
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ id: 'r1', output: [reasoning, call], usage: { input_tokens: 10, output_tokens: 3 } }))
      .mockResolvedValueOnce(json({ id: 'r2', output_text: '结果是60', usage: { input_tokens: 20, output_tokens: 4 } }));
    vi.stubGlobal('fetch', fetchMock);
    const deltas: string[] = []; const tools: ToolActivity[] = [];
    const result = await (await provider()).generate(request(), { id: 'user-1' }, signal(), (delta) => deltas.push(delta), (item) => tools.push(item));
    expect(result.text).toBe('结果是60'); expect(deltas).toEqual(['结果是60']);
    expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 7, totalTokens: 37 });
    const followup = body(fetchMock, 1);
    expect(followup.store).toBe(false); expect(followup.include).toContain('reasoning.encrypted_content');
    expect(followup.input).toContainEqual(reasoning);
    const output = followup.input.find((item: any) => item.type === 'function_call_output');
    expect(output.call_id).toBe('call-1'); expect(JSON.parse(output.output).data.result).toBe(60);
    expect(tools.map((item) => item.status)).toEqual(['running', 'completed']);
    expect(result.tools).toHaveLength(1);
  });
  it('accumulates Responses streamed arguments and handles final text sent only in completed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(sse([
      { type: 'response.output_item.added', output_index: 0, item: { id: 'item-1', type: 'function_call', call_id: 'call-1', name: 'calculate', arguments: '' } },
      { type: 'response.function_call_arguments.delta', item_id: 'item-1', delta: '{"expression":' },
      { type: 'response.function_call_arguments.delta', output_index: 0, delta: '"12*5"}' },
      { type: 'response.completed', response: { id: 'r1' } },
    ])).mockResolvedValueOnce(sse([{ type: 'response.completed', response: { id: 'r2', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '60' }] }] } }])));
    expect((await (await provider()).generate(request(), { id: 'user' }, signal(), () => undefined)).text).toBe('60');
  });
  it('supports Chat Completions JSON tool calls and sends tool messages not Responses syntax', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ id: 'c1', choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: call.name, arguments: call.arguments } }] } }] }))
      .mockResolvedValueOnce(json({ id: 'c2', choices: [{ message: { content: '60' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await (await provider('chat-completions')).generate(request(), { id: 'user' }, signal(), () => undefined);
    expect(result.text).toBe('60');
    const messages = body(fetchMock, 1).messages;
    expect(messages[0].content).toContain('Asia/Shanghai');
    expect(messages.at(-2).tool_calls[0].id).toBe('call-1');
    expect(messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call-1' });
    expect(JSON.parse(messages.at(-1).content).data.result).toBe(60);
  });
  it('assembles Chat Completions SSE tool call fragments', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(sse([
      { id: 'c1', choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'calculate', arguments: '{"expression":"' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '12*5"}' } }] } }] },
    ])).mockResolvedValueOnce(sse([{ choices: [{ delta: { content: '60' } }] }]));
    vi.stubGlobal('fetch', fetchMock);
    expect((await (await provider('chat-completions')).generate(request(), { id: 'user' }, signal(), () => undefined)).text).toBe('60');
    expect(body(fetchMock, 1).messages.at(-1).tool_call_id).toBe('call-1');
  });
  it('returns invalid tool arguments to the model for correction without executing arbitrary code', async () => {
    const mock = vi.fn().mockResolvedValueOnce(json({ output: [{ ...call, arguments: '{"expression":"process.exit()"}' }] }))
      .mockResolvedValueOnce(json({ output_text: '该表达式不支持。' })); vi.stubGlobal('fetch', mock);
    await (await provider()).generate(request(), { id: 'user' }, signal(), () => undefined);
    const result = JSON.parse(body(mock, 1).input.at(-1).output);
    expect(result.ok).toBe(false); expect(result.error.code).toBe('invalid_expression');
  });
  it('prefetches Changsha weather before a tool-rejecting provider and keeps it on retry', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-09T02:10:00Z'));
    const weather = { timezone: 'Asia/Shanghai', utc_offset_seconds: 28800, current: { temperature_2m: 28, weather_code: 3, time: '2026-09-09T10:00' }, daily: { time: ['2026-09-09'], temperature_2m_max: [30], temperature_2m_min: [25] } };
    const mock = vi.fn().mockResolvedValueOnce(json(weather))
      .mockResolvedValueOnce(json({ error: { message: 'Unknown parameter: tools' } }, 400))
      .mockResolvedValueOnce(json({ output_text: '长沙当前28°C，来源Open-Meteo。' })); vi.stubGlobal('fetch', mock);
    const result = await (await provider()).generate(request('长沙天气怎么样'), { id: 'user' }, signal(), () => undefined);
    expect(result.text).toContain('28'); expect(mock).toHaveBeenCalledTimes(3);
    expect((mock.mock.calls[0]?.[1].headers as Record<string, string>)).not.toHaveProperty('authorization');
    expect(body(mock, 2)).not.toHaveProperty('tools');
    expect(JSON.stringify(body(mock, 2).input)).toContain('temperature_2m');
    expect(body(mock, 2).instructions).toContain('上游拒绝');
  });
  it('does real fallback search when functions are rejected, marking source data untrusted', async () => {
    const mock = vi.fn().mockResolvedValueOnce(json({ error: { message: 'Unsupported tool type' } }, 400))
      .mockResolvedValueOnce(new Response('<rss><item><title>官方公告</title><link>https://example.com/news</link><description>最新公告</description></item></rss>'))
      .mockResolvedValueOnce(json({ output_text: '查到一条公告。' })); vi.stubGlobal('fetch', mock);
    const result = await (await provider()).generate(request('搜索最新公告'), { id: 'user' }, signal(), () => undefined);
    expect(result.tools?.[0]?.name).toBe('search_web');
    expect(String(mock.mock.calls[1]?.[0])).toContain('bing.com');
    expect(JSON.stringify(body(mock, 2).input)).toContain('不可信数据');
  });
  it('keeps time even with all tools disabled and performs no external lookup', async () => {
    const mock = vi.fn().mockResolvedValue(json({ output_text: '现在是北京时间。' })); vi.stubGlobal('fetch', mock);
    await (await provider()).generate(request('长沙天气怎么样', { autoTools: false }), { id: 'user' }, signal(), () => undefined);
    expect(mock).toHaveBeenCalledTimes(1); expect(body(mock, 0)).not.toHaveProperty('tools');
    expect(body(mock, 0).instructions).toContain('网关系统时钟');
  });
  it('rejects an empty response that merely has an ID instead of completing a blank bubble', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ id: 'empty' })));
    await expect((await provider()).generate(request(), { id: 'user' }, signal(), () => undefined)).rejects.toMatchObject({ code: 'empty_provider_response' });
  });
  it('bounds infinite tool loops and tells the provider to finish after four rounds', async () => {
    const mock = vi.fn().mockImplementation(() => Promise.resolve(json({ output: [call] }))); vi.stubGlobal('fetch', mock);
    await expect((await provider()).generate(request(), { id: 'user' }, signal(), () => undefined)).rejects.toMatchObject({ code: 'provider_tool_limit' });
    expect(mock).toHaveBeenCalledTimes(5); expect(body(mock, 4).tool_choice).toBe('none');
  });
  it('rejects a stream that closes without a terminal event, even after text', async () => {
    const response = new Response('data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: '部分文字' }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const chunks: string[] = [];
    await expect((await provider()).generate(request(), { id: 'user' }, signal(), (delta) => chunks.push(delta))).rejects.toBeInstanceOf(Error);
    expect(chunks).toEqual(['部分文字']);
  });
  it('does not turn a truncated/incomplete stream into success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse([{ type: 'response.incomplete', response: { id: 'r1' } }])));
    await expect((await provider()).generate(request(), { id: 'user' }, signal(), () => undefined)).rejects.toBeInstanceOf(Error);
  });
});
