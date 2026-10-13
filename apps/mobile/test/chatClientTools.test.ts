import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: 'test' } } }));
const gateway = vi.hoisted(() => ({ getGenerationJob: vi.fn(), cancelGenerationJob: vi.fn() }));
vi.mock('../src/services/gatewayApiClient', () => gateway);
import { resumeGeneration, startGeneration } from '../src/services/chatClient';
const request = {
  requestId: '123e4567-e89b-12d3-a456-426614174000', conversationId: '123e4567-e89b-12d3-a456-426614174001', deviceId: 'test-tools-device',
  messages: [{ role: 'user' as const, content: '长沙天气怎么样', attachments: [] }],
  options: { model: 'model-a', reasoningEffort: 'low' as const, verbosity: 'low' as const, instructions: '', maxOutputTokens: 256, webSearch: false, codeInterpreter: false, autoTools: true },
};
const activity = { id: 'weather-1', name: 'get_weather', title: '天气预报', status: 'completed' as const };
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('tool status and per-request device context', () => {
  it('sends device timezone with REST fallback and preserves disabled autoTools', async () => {
    vi.stubGlobal('WebSocket', class { constructor() { throw new Error('no websocket'); } });
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ requestId: request.requestId, text: '现在10点', model: 'model-a' }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', mock);
    await new Promise<void>((resolve, reject) => startGeneration({ serverUrl: 'https://gateway.test', accessToken: 'token', request: { ...request, options: { ...request.options, autoTools: false } }, handlers: { onDelta: vi.fn(), onDone: () => resolve(), onError: reject, onCancelled: vi.fn() } }));
    const payload = JSON.parse(mock.mock.calls[0]?.[1].body);
    expect(payload.context.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(payload.options.autoTools).toBe(false);
    expect(request).not.toHaveProperty('context');
  });
  it('forwards tool events only for the matching WebSocket request', () => {
    const sockets: any[] = [];
    vi.stubGlobal('WebSocket', class {
      readyState = 1; onopen?: () => void; onmessage?: (value: any) => void;
      send = vi.fn(); close = vi.fn(); constructor() { sockets.push(this); }
    });
    const onTool = vi.fn(); const done = vi.fn();
    const controller = startGeneration({ serverUrl: 'https://gateway.test', accessToken: 'token', request, handlers: { onDelta: vi.fn(), onDone: done, onError: vi.fn(), onCancelled: vi.fn(), onTool } });
    const socket = sockets[0];
    socket.onmessage({ data: JSON.stringify({ type: 'tool', requestId: 'other-request', activity }) });
    socket.onmessage({ data: JSON.stringify({ type: 'tool', requestId: request.requestId, activity }) });
    expect(onTool).toHaveBeenCalledExactlyOnceWith(activity);
    socket.onmessage({ data: JSON.stringify({ type: 'done', requestId: request.requestId, tools: [activity] }) });
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ tools: [activity] })); controller.dispose();
  });
  it('restores tool state when resuming a durable background job', async () => {
    gateway.getGenerationJob.mockResolvedValue({ requestId: request.requestId, conversationId: request.conversationId, status: 'completed', text: '长沙多云', tools: [activity] });
    const onTool = vi.fn();
    await new Promise<void>((resolve, reject) => resumeGeneration({ serverUrl: 'https://gateway.test', accessToken: 'token', requestId: request.requestId, conversationId: request.conversationId, handlers: { onDelta: vi.fn(), onTool, onDone: () => resolve(), onError: reject, onCancelled: vi.fn() } }));
    expect(onTool).toHaveBeenCalledExactlyOnceWith(activity);
  });
});

const knowledgeFixture = { query: '报销日期', sources: [{ label: '资料1', documentId: '11111111-1111-4111-8111-111111111111', title: '报销', chunk: 1, excerpt: '每月25日截止。', updatedAt: 1 }] };
describe('knowledge source transport', () => {
  it('preserves REST source snapshots and explicit opt-in', async () => {
    vi.stubGlobal('WebSocket', class { constructor() { throw new Error('no websocket'); } });
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: '25日。[资料1]', knowledge: knowledgeFixture })));
    vi.stubGlobal('fetch', mock);
    const done: any = await new Promise((resolve, reject) => startGeneration({ serverUrl: 'https://gateway.test', accessToken: 'token', request: { ...request, options: { ...request.options, knowledgeBase: true } }, handlers: { onDelta: vi.fn(), onDone: resolve, onError: reject, onCancelled: vi.fn() } }));
    expect(done.knowledge).toEqual(knowledgeFixture);
    expect(JSON.parse(mock.mock.calls[0]?.[1].body).options.knowledgeBase).toBe(true);
  });
  it('isolates WS sources by request and discards malformed metadata', () => {
    const sockets: any[] = [];
    vi.stubGlobal('WebSocket', class { readyState = 1; send = vi.fn(); close = vi.fn(); constructor() { sockets.push(this); } });
    const done = vi.fn();
    const controller = startGeneration({ serverUrl: 'https://gateway.test', accessToken: 'token', request, handlers: { onDelta: vi.fn(), onDone: done, onError: vi.fn(), onCancelled: vi.fn() } });
    sockets[0].onmessage({ data: JSON.stringify({ type: 'done', requestId: 'other', knowledge: knowledgeFixture }) });
    expect(done).not.toHaveBeenCalled();
    sockets[0].onmessage({ data: JSON.stringify({ type: 'done', requestId: request.requestId, knowledge: { ...knowledgeFixture, sources: 'invalid' } }) });
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ knowledge: undefined }));
    controller.dispose();
  });
  it('retains sources when resuming a background job', async () => {
    gateway.getGenerationJob.mockResolvedValue({ requestId: request.requestId, conversationId: request.conversationId, status: 'completed', text: '25日', knowledge: knowledgeFixture });
    const done: any = await new Promise((resolve, reject) => resumeGeneration({ serverUrl: 'https://gateway.test', accessToken: 'token', requestId: request.requestId, conversationId: request.conversationId, handlers: { onDelta: vi.fn(), onDone: resolve, onError: reject, onCancelled: vi.fn() } }));
    expect(done.knowledge).toEqual(knowledgeFixture);
  });
});
