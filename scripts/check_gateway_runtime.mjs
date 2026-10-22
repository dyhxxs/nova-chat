import { pathToFileURL } from 'node:url';

const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 120_000;
const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * A keyless, non-billable deployment probe. It only checks the process and
 * local database readiness endpoints; it never authenticates or calls a model.
 */
export class RuntimeCheckError extends Error {
  constructor(code, report) {
    super(code);
    this.name = 'RuntimeCheckError';
    this.code = code;
    this.report = report;
  }
}

export function validateRuntimeGateway(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('invalid_gateway_url');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('invalid_gateway_url'); }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('invalid_gateway_url');
  }
  return url.origin;
}

function validateTimeout(timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error('invalid_timeout');
  }
}

function requestIdPresent(response) {
  const value = response?.headers?.get?.('x-request-id');
  return typeof value === 'string' && requestIdPattern.test(value.trim());
}

async function readBoundedJson(response) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error('response_too_large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('empty_response');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('response_too_large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!chunks.length) throw new Error('empty_response');
  let parsed;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('invalid_json'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_json');
  return parsed;
}

function fail(code, report) {
  report.ok = false;
  throw new RuntimeCheckError(code, report);
}

async function probe(route, name, gatewayUrl, fetchImpl, timeoutMs, report) {
  let response;
  try {
    response = await fetchImpl(`${gatewayUrl}${route}`, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': 'nova-chat-runtime-smoke/1' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    report.checks.push({ name, ok: false, requestIdPresent: false });
    fail(`${name}_request_failed`, report);
  }

  const requestId = requestIdPresent(response);
  const check = { name, ok: false, status: response.status, requestIdPresent: requestId };
  report.checks.push(check);
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => {});
    fail(`${name}_redirect`, report);
  }
  let payload;
  try { payload = await readBoundedJson(response); } catch (error) {
    fail(`${name}_${error.message === 'response_too_large' ? 'response_too_large' : 'invalid_json'}`, report);
  }
  if (!requestId) fail(`${name}_missing_request_id`, report);
  if (response.status !== 200) fail(`${name}_http_${response.status}`, report);
  check.ok = true;
  return payload;
}

export async function checkGatewayRuntime(value, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  validateTimeout(timeoutMs);
  const gatewayUrl = validateRuntimeGateway(value);
  const report = {
    ok: false,
    gatewayUrl,
    checkedAt: new Date().toISOString(),
    checks: [],
  };

  const health = await probe('/healthz', 'healthz', gatewayUrl, fetchImpl, timeoutMs, report);
  if (health.ok !== true || health.service !== 'nova-chat-gateway' || health.status !== 'alive') {
    fail('healthz_invalid_payload', report);
  }

  const ready = await probe('/readyz', 'readyz', gatewayUrl, fetchImpl, timeoutMs, report);
  if (ready.ok !== true || ready.service !== 'nova-chat-gateway'
    || !ready.checks || typeof ready.checks !== 'object' || Array.isArray(ready.checks)
    || ready.checks.database !== 'ok'
    || !['configured', 'unconfigured'].includes(ready.checks.provider)) {
    fail('readyz_invalid_payload', report);
  }

  report.ok = true;
  report.provider = ready.checks.provider;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1) throw new Error('invalid_arguments');
    console.log(JSON.stringify(await checkGatewayRuntime(args[0]), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      code: error instanceof RuntimeCheckError ? error.code : (error?.message || 'runtime_check_configuration_failed'),
      ...(error instanceof RuntimeCheckError ? { report: error.report } : {}),
    }, null, 2));
    process.exitCode = 1;
  }
}
