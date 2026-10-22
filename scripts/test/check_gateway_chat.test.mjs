import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { checkGatewayChat, ChatCheckError } from '../check_gateway_chat.mjs';

const origin = 'https://gateway.example.com';
const token = 'synthetic-session-secret';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function fixture({ onStart, onHello, customizeFetch, open = true, snapshot = {}, cancelFails = false, socketThrows = false } = {}) {
  const requests = [], frames = [], sockets = [];
  let payload;
  function emit(ws, value) { ws.emit('message', Buffer.from(JSON.stringify(value)), false); }
  const socketFactory = (url, options) => {
    if (socketThrows) throw new Error(`upstream ${token}`);
    const ws = new EventEmitter();
    ws.url = url;
    ws.options = options;
    ws.terminated = false;
    ws.terminate = () => { ws.terminated = true; queueMicrotask(() => ws.emit('close')); };
    ws.send = (raw) => {
      const frame = JSON.parse(raw);
      frames.push(frame);
      if (frame.type === 'hello') {
        queueMicrotask(() => onHello ? onHello(ws, emit) : emit(ws, { type: 'ready' }));
      }
      if (frame.type === 'start') {
        payload = frame.payload;
        queueMicrotask(() => {
          if (onStart) return onStart(ws, payload, emit);
          emit(ws, { type: 'delta', requestId: payload.requestId, delta: '连接成功。' });
          emit(ws, { type: 'done', requestId: payload.requestId });
        });
      }
    };
    sockets.push(ws);
    if (open) queueMicrotask(() => ws.emit('open'));
    return ws;
  };
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    const route = new URL(url).pathname;
    if (customizeFetch) {
      const result = await customizeFetch(route, options, { payload });
      if (result) return result;
    }
    if (route === '/health') return json({ ok: true, service: 'nova-chat-gateway' });
    if (route === '/v1/setup/status') return json({ needsBootstrap: false, providerConfigured: true, registrationEnabled: true });
    if (route === '/v1/auth/me') return options.headers?.authorization
      ? json({ user: { id: 'synthetic-user', disabled: false } }) : json({ error: { code: 'unauthorized' } }, 401);
    if (route === '/v1/models') return json({ models: ['test-model'], defaultModel: 'test-model' });
    if (route.endsWith('/cancel')) return json({ ok: !cancelFails }, cancelFails ? 503 : 200);
    if (route.startsWith('/v1/chat/jobs/')) return json({ requestId: payload.requestId, conversationId: payload.conversationId, status: 'completed', text: '连接成功。', ...snapshot });
    throw new Error('unexpected_route');
  };
  return { requests, frames, sockets, options: { accessToken: token, fetchImpl, socketFactory, chatTimeoutMs: 100 } };
}
async function fails(f, code, extra = {}) {
  let error;
  try { await checkGatewayChat(origin, { ...f.options, ...extra }); } catch (caught) { error = caught; }
  assert.ok(error instanceof ChatCheckError);
  assert.equal(error.code, `chat_check_${code}_failed`);
  assert.equal(error.report.publicChatVerified, false);
  assert.equal(JSON.stringify(error.report).includes(token), false);
  assert.equal(error.message.includes(token), false);
  return error;
}

test('requires authenticated WSS deltas, done and matching completed job; reports no secrets', async () => {
  const f = fixture();
  const result = await checkGatewayChat(origin, f.options);
  assert.equal(result.publicChatVerified, true);
  assert.equal(result.scope, 'public-gateway');
  assert.equal(result.modelRequestsAttempted, 1);
  assert.equal(result.deltaCount, 1);
  assert.equal(result.checks.length, 7);
  assert.equal(result.checks.every(item => item.ok), true);
  assert.equal(f.sockets[0].terminated, true);
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(JSON.stringify(result).includes('synthetic-user'), false);
  assert.equal(JSON.stringify(result).includes('连接成功'), false);
  assert.equal(f.requests.some(x => x.url.endsWith('/logout')), false);
});

test('disables redirects on every HTTP request and WSS upgrade; token is not in URL', async () => {
  const f = fixture();
  await checkGatewayChat(origin, f.options);
  for (const request of f.requests) {
    assert.equal(request.options.redirect, 'error');
    assert.ok(request.options.signal instanceof AbortSignal);
    assert.equal(request.url.includes(token), false);
    assert.equal(new URL(request.url).origin, origin);
  }
  assert.equal(f.sockets[0].url, 'wss://gateway.example.com/v1/chat/stream');
  assert.deepEqual(f.sockets[0].options, { followRedirects: false, handshakeTimeout: 15000, maxPayload: 65536, perMessageDeflate: false });
});

test('sends one isolated synthetic request using the advertised default and disables all tools', async () => {
  const f = fixture();
  await checkGatewayChat(origin, f.options);
  const starts = f.frames.filter(x => x.type === 'start');
  assert.equal(starts.length, 1);
  const payload = starts[0].payload;
  assert.notEqual(payload.requestId, payload.conversationId);
  assert.equal(payload.messages.length, 1);
  assert.equal(payload.options.model, 'test-model');
  for (const key of ['autoTools', 'knowledgeBase', 'webSearch', 'codeInterpreter']) assert.equal(payload.options[key], false);
});

test('duplicate ready cannot create duplicate billable requests', async () => {
  const f = fixture({ onHello: (ws, emit) => { emit(ws, { type: 'ready' }); emit(ws, { type: 'ready' }); } });
  await checkGatewayChat(origin, f.options);
  assert.equal(f.frames.filter(x => x.type === 'start').length, 1);
});

test('loopback diagnostic is explicitly scoped and never claims a public verification', async () => {
  const f = fixture();
  const report = await checkGatewayChat('http://127.0.0.1:8787', { ...f.options, localOnly: true });
  assert.equal(report.scope, 'loopback-only');
  assert.equal(report.publicChatVerified, false);
  assert.equal(f.sockets[0].url, 'ws://127.0.0.1:8787/v1/chat/stream');
});

test('missing, whitespace, oversized or header-injecting credentials fail without network access', async () => {
  for (const accessToken of [undefined, '', ' ', 'has space', 'secret\r\ninject', 'x'.repeat(4097)]) {
    const f = fixture();
    await fails(f, 'configuration', { accessToken });
    assert.equal(f.requests.length, 0);
    assert.equal(f.sockets.length, 0);
  }
});

test('public mode rejects local, insecure, temporary and credential-bearing URLs', async () => {
  for (const value of ['http://127.0.0.1:8787', 'http://gateway.example.com', 'https://preview.trycloudflare.com', 'https://secret@gateway.example.com', 'https://gateway.example.com/path']) {
    const f = fixture();
    await assert.rejects(checkGatewayChat(value, f.options), /configuration/);
    assert.equal(f.requests.length, 0);
  }
});

test('public HTTP IPv4 requires opt-in and uses an unencrypted WebSocket', async () => {
  const address = 'http://8.8.8.8:8787';
  const rejected = fixture();
  await assert.rejects(checkGatewayChat(address, rejected.options), /configuration/);
  assert.equal(rejected.requests.length, 0);

  const f = fixture();
  const result = await checkGatewayChat(address, { ...f.options, allowHttpIp: true });
  assert.equal(result.gatewayUrl, address);
  assert.equal(result.publicChatVerified, true);
  assert.equal(f.sockets[0].url, 'ws://8.8.8.8:8787/v1/chat/stream');
  assert.equal(f.requests.every((request) => new URL(request.url).origin === address), true);
});

test('loopback option cannot be used to authorize remote or credential-bearing origins', async () => {
  for (const value of ['http://192.168.1.2:8787', origin, 'http://localhost:8787', 'http://secret@127.0.0.1:8787', 'http://127.0.0.1:8787/path']) {
    const f = fixture();
    await assert.rejects(checkGatewayChat(value, { ...f.options, localOnly: true }), /configuration/);
    assert.equal(f.requests.length, 0);
  }
});

test('temporary public origin is checked only with explicit preview opt-in', async () => {
  const f = fixture();
  const result = await checkGatewayChat('https://preview.trycloudflare.com', { ...f.options, allowTemporary: true });
  assert.equal(result.publicChatVerified, true);
});

test('unhealthy or unconfigured public endpoint is not sent credentials or a chat', async () => {
  const f = fixture({ customizeFetch: route => route === '/health' ? json({ error: token }, 530) : undefined });
  await fails(f, 'readiness');
  assert.equal(f.requests.some(r => r.options.headers?.authorization), false);
  assert.equal(f.sockets.length, 0);
});

test('unprotected auth endpoint and proxy 401 are not accepted as an authentication guard', async () => {
  for (const response of [() => json({ user: {} }), () => json({ error: { code: 'proxy_error' } }, 401), () => new Response('<html>proxy</html>', { status: 401 })]) {
    const f = fixture({ customizeFetch: (route, options) => route === '/v1/auth/me' && !options.headers?.authorization ? response() : undefined });
    await fails(f, 'authentication_guard');
    assert.equal(f.sockets.length, 0);
  }
});

test('expired and disabled test sessions cannot pass or trigger model generation', async () => {
  for (const body of [{ error: { code: 'unauthorized' } }, { user: { id: 'user', disabled: true } }, { user: {} }]) {
    const f = fixture({ customizeFetch: (route, options) => route === '/v1/auth/me' && options.headers?.authorization ? json(body) : undefined });
    await fails(f, 'authenticated_session');
    assert.equal(f.sockets.length, 0);
  }
});

test('invalid or unavailable advertised default model fails before opening WSS', async () => {
  for (const body of [{}, { models: [], defaultModel: 'missing' }, { models: [''], defaultModel: '' }, { models: ['x'.repeat(101)], defaultModel: 'x'.repeat(101) }]) {
    const f = fixture({ customizeFetch: route => route === '/v1/models' ? json(body) : undefined });
    await fails(f, 'model_catalog');
    assert.equal(f.sockets.length, 0);
  }
});

test('oversized authenticated JSON is bounded and rejected', async () => {
  const f = fixture({ customizeFetch: route => route === '/v1/models' ? json({ data: 'x'.repeat(256 * 1024) }) : undefined });
  await fails(f, 'model_catalog');
  assert.equal(f.sockets.length, 0);
});

test('HTTP and socket implementation errors cannot leak secrets', async () => {
  const f = fixture({ customizeFetch: () => { throw new Error(`network contained ${token}`); } });
  await fails(f, 'readiness');
  await fails(fixture({ socketThrows: true }), 'websocket_chat');
});

test('WSS ready alone is not chat success and timeout closes socket and requests job cancellation', async () => {
  const f = fixture({ onStart: () => {} });
  const error = await fails(f, 'websocket_chat', { chatTimeoutMs: 10 });
  assert.equal(error.report.modelRequestsAttempted, 1);
  assert.equal(error.report.cancellationRequested, true);
  assert.equal(f.sockets[0].terminated, true);
  const cancel = f.requests.find(r => r.options.method === 'POST');
  assert.ok(new URL(cancel.url).searchParams.get('conversationId'));
  assert.equal(f.frames.filter(x => x.type === 'start').length, 1);
});

test('handshake timeout sends no hello, chat or cancellation request', async () => {
  const f = fixture({ open: false });
  const error = await fails(f, 'websocket_chat', { chatTimeoutMs: 10 });
  assert.equal(error.report.modelRequestsAttempted, 0);
  assert.equal(f.frames.length, 0);
  assert.equal(f.requests.some(r => r.options.method === 'POST'), false);
  assert.equal(f.sockets[0].terminated, true);
});

test('cancel cleanup failure is reported without masking the original chat failure', async () => {
  const f = fixture({ onStart: ws => ws.emit('error', new Error(token)), cancelFails: true });
  const error = await fails(f, 'websocket_chat');
  assert.equal(error.report.cancellationRequested, false);
});

test('early close and authentication refusal do not produce a false chat success', async () => {
  for (const onHello of [(ws) => ws.emit('close'), (ws, emit) => emit(ws, { type: 'error', code: 'unauthorized', message: token })]) {
    const f = fixture({ onHello });
    const error = await fails(f, 'websocket_chat');
    assert.equal(error.report.modelRequestsAttempted, 0);
  }
});

test('done with empty, whitespace or missing deltas fails', async () => {
  for (const delta of [undefined, '', '   ']) {
    const f = fixture({ onStart: (ws, payload, emit) => {
      if (delta !== undefined) emit(ws, { type: 'delta', requestId: payload.requestId, delta });
      emit(ws, { type: 'done', requestId: payload.requestId });
    } });
    await fails(f, 'websocket_chat');
  }
});

test('unrelated request frames cannot satisfy the synthetic chat', async () => {
  const f = fixture({ onStart: (ws, payload, emit) => {
    emit(ws, { type: 'delta', requestId: 'other', delta: 'fake reply' });
    emit(ws, { type: 'done', requestId: 'other' });
    emit(ws, { type: 'done', requestId: payload.requestId });
  } });
  await fails(f, 'websocket_chat');
});

test('malformed, binary and oversized WebSocket frames fail boundedly', async () => {
  for (const onStart of [
    (ws) => ws.emit('message', Buffer.from('{bad'), false),
    (ws) => ws.emit('message', Buffer.from('{}'), true),
    (ws) => ws.emit('message', Buffer.alloc(65537), false),
    (ws, payload, emit) => emit(ws, { type: 'delta', requestId: payload.requestId, delta: {} }),
    (ws, payload, emit) => emit(ws, { type: 'delta', requestId: payload.requestId, delta: 'x'.repeat(32769) }),
  ]) await fails(fixture({ onStart }), 'websocket_chat');
});

test('tool execution, cancellation and server errors are never accepted as a successful reply', async () => {
  for (const type of ['tool', 'cancelled', 'error']) {
    const f = fixture({ onStart: (ws, payload, emit) => emit(ws, { type, requestId: payload.requestId, message: token }) });
    await fails(f, 'websocket_chat');
  }
});

test('completed snapshot must match both IDs, exact streamed text and completed state', async () => {
  for (const snapshot of [{ status: 'running' }, { requestId: 'other' }, { conversationId: 'other' }, { text: 'different' }]) {
    const f = fixture({ snapshot });
    const error = await fails(f, 'completed_job_snapshot');
    assert.equal(error.report.cancellationRequested, true);
  }
});

test('late ready after completion cannot start a second generation', async () => {
  const f = fixture();
  await checkGatewayChat(origin, f.options);
  f.sockets[0].emit('message', Buffer.from('{"type":"ready"}'), false);
  assert.equal(f.frames.filter(x => x.type === 'start').length, 1);
});

test('invalid timeout configuration is rejected without network I/O', async () => {
  for (const extra of [{ chatTimeoutMs: 0 }, { httpTimeoutMs: -1 }, { chatTimeoutMs: 120001 }, { httpTimeoutMs: 30001 }, { chatTimeoutMs: 1.5 }]) {
    const f = fixture();
    await fails(f, 'configuration', extra);
    assert.equal(f.requests.length, 0);
  }
});

test('friend build requires chat before expensive builds and again before APK distribution', async () => {
  const source = await readFile(new URL('../build_friend_android.ps1', import.meta.url), 'utf8');
  const pre = source.indexOf("Invoke-ReleaseChatCheck -Stage '构建前'");
  const post = source.indexOf("Invoke-ReleaseChatCheck -Stage '构建后'");
  assert.ok(pre > 0 && pre < source.indexOf('npm run verify'));
  assert.ok(post > source.indexOf('check_apk_gateway.mjs') && post < source.indexOf('Copy-Item -LiteralPath $source'));
  assert.equal(source.includes('--local-only'), false);
  assert.match(source, /IsNullOrWhiteSpace\(\$releaseSessionToken\)/);
  assert.match(source, /SetEnvironmentVariable\('NOVA_RELEASE_SESSION_TOKEN', \$null, 'Process'\)/);
  assert.match(source, /finally\s*\{\s*foreach \(\$name in \$environmentNames\)/);
});

test('poisoned setup metadata never reroutes session credentials or the chat', async () => {
  const f = fixture({ customizeFetch: route => route === '/v1/setup/status' ? json({
    needsBootstrap: false, registrationEnabled: true, providerConfigured: true,
    gatewayUrl: 'https://unverified.attacker.com', publicChatVerified: true,
  }) : undefined });
  const report = await checkGatewayChat(origin, f.options);
  assert.equal(report.gatewayUrl, origin);
  assert.equal(f.requests.every(r => new URL(r.url).origin === origin), true);
  assert.equal(new URL(f.sockets[0].url).hostname, new URL(origin).hostname);
});
