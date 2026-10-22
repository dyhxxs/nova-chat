import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGatewayRuntime, validateRuntimeGateway } from '../check_gateway_runtime.mjs';

const origin = 'http://127.0.0.1:8787';
const requestHeaders = { 'x-request-id': 'runtime-smoke-123' };
const health = { ok: true, service: 'nova-chat-gateway', status: 'alive' };
const ready = { ok: true, service: 'nova-chat-gateway', checks: { database: 'ok', provider: 'configured' } };

function response(body, status = 200, headers = requestHeaders) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function mocked({ healthBody = health, healthStatus = 200, readyBody = ready, readyStatus = 200, headers = requestHeaders } = {}) {
  return async (url) => url.endsWith('/healthz')
    ? response(healthBody, healthStatus, headers)
    : response(readyBody, readyStatus, headers);
}

async function fails(fetchImpl, codePattern) {
  await assert.rejects(
    checkGatewayRuntime(origin, { fetchImpl }),
    error => error?.code?.includes(codePattern),
  );
}

test('accepts local HTTP gateways and rejects credentials, paths, queries and fragments', () => {
  assert.equal(validateRuntimeGateway('http://127.0.0.1:8787/'), origin);
  assert.equal(validateRuntimeGateway('https://gateway.internal:9443'), 'https://gateway.internal:9443');
  for (const value of [
    'ftp://127.0.0.1:8787',
    'http://user:password@127.0.0.1:8787',
    'http://127.0.0.1:8787/path',
    'http://127.0.0.1:8787/?token=secret',
    'http://127.0.0.1:8787/#fragment',
  ]) assert.throws(() => validateRuntimeGateway(value), /invalid_gateway_url/);
});

test('passes health and readiness when the provider is configured', async () => {
  const report = await checkGatewayRuntime(origin, { fetchImpl: mocked() });
  assert.equal(report.ok, true);
  assert.equal(report.provider, 'configured');
  assert.deepEqual(report.checks.map(item => item.name), ['healthz', 'readyz']);
  assert.equal(report.checks.every(item => item.ok && item.requestIdPresent && item.status === 200), true);
});

test('allows a healthy database before a provider is configured', async () => {
  const report = await checkGatewayRuntime(origin, {
    fetchImpl: mocked({ readyBody: { ...ready, checks: { database: 'ok', provider: 'unconfigured' } } }),
  });
  assert.equal(report.ok, true);
  assert.equal(report.provider, 'unconfigured');
});

test('fails when the database is unavailable or readiness is not HTTP 200', async () => {
  await fails(mocked({ readyStatus: 503, readyBody: { ok: false, service: 'nova-chat-gateway', checks: { database: 'unavailable', provider: 'unknown' } } }), 'readyz_http_503');
  await fails(mocked({ readyBody: { ...ready, checks: { database: 'unavailable', provider: 'unknown' } } }), 'readyz_invalid_payload');
});

test('requires a valid request ID on every probe response', async () => {
  await fails(mocked({ headers: {} }), 'missing_request_id');
});

test('rejects wrong services and non-alive health responses', async () => {
  await fails(mocked({ healthBody: { ...health, service: 'other' } }), 'healthz_invalid_payload');
  await fails(mocked({ healthBody: { ...health, status: 'draining' } }), 'healthz_invalid_payload');
});

test('rejects oversized responses before accepting them', async () => {
  const fetchImpl = async (url) => url.endsWith('/healthz')
    ? new Response('x'.repeat(64 * 1024 + 1), { status: 200, headers: requestHeaders })
    : response(ready);
  await fails(fetchImpl, 'healthz_response_too_large');
});

test('rejects redirects and does not expose response contents', async () => {
  const secret = 'private-response-secret';
  const fetchImpl = async (url) => url.endsWith('/healthz')
    ? new Response(secret, { status: 302, headers: { location: 'http://user:password@internal/secret', ...requestHeaders } })
    : response(ready);
  await assert.rejects(checkGatewayRuntime(origin, { fetchImpl }), error => {
    assert.equal(error.code, 'healthz_redirect');
    assert.equal(JSON.stringify(error.report).includes(secret), false);
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});

test('uses a bounded timeout configuration without network I/O for invalid values', async () => {
  let calls = 0;
  await assert.rejects(checkGatewayRuntime(origin, { timeoutMs: 0, fetchImpl: async () => { calls += 1; } }), /invalid_timeout/);
  assert.equal(calls, 0);
});
