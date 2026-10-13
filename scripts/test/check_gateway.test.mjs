import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGateway, validateFriendGateway } from '../check_gateway.mjs';

test('rejects temporary, insecure and local addresses by default', () => {
  for (const url of ['https://old.trycloudflare.com', 'http://gateway.example.com', 'https://127.0.0.1', 'https://192.168.1.2', 'https://localhost', 'https://host.local', 'https://[::1]', 'https://user:password@gateway.example.com', 'https://gateway.example.com/path', 'https://gateway.example.com/?token=secret']) {
    assert.throws(() => validateFriendGateway(url));
  }
  assert.equal(validateFriendGateway('https://gateway.example.com/'), 'https://gateway.example.com');
  assert.equal(validateFriendGateway('https://preview.trycloudflare.com', { allowTemporary: true }), 'https://preview.trycloudflare.com');
});

const health = { ok: true, service: 'nova-chat-gateway' };
const ready = { needsBootstrap: false, registrationEnabled: true, providerConfigured: true };
function mocked(setup = ready, status = 200, body = health) {
  return async (url) => new Response(JSON.stringify(url.endsWith('/health') ? body : setup), { status });
}

test('requires a prepared, registration-enabled gateway', async () => {
  for (const setup of [{ ...ready, needsBootstrap: true }, { ...ready, registrationEnabled: false }, { ...ready, providerConfigured: false }, {}]) {
    await assert.rejects(checkGateway('https://gateway.example.com', { fetchImpl: mocked(setup) }));
  }
  const result = await checkGateway('https://gateway.example.com', { fetchImpl: mocked() });
  assert.equal(result.registrationEnabled, true);
});

test('blocks 530, wrong services and HTML success pages before packaging', async () => {
  await assert.rejects(checkGateway('https://gateway.example.com', { fetchImpl: mocked(ready, 530) }), /530/);
  await assert.rejects(checkGateway('https://gateway.example.com', { fetchImpl: mocked(ready, 200, { ok: true, service: 'other' }) }), /Nova/);
  await assert.rejects(checkGateway('https://gateway.example.com', { fetchImpl: async () => new Response('<html>Login</html>') }), /JSON/);
});

test('remote setup fields cannot overwrite verified release metadata or leak into output', async () => {
  const injected = {
    ...ready, gatewayUrl: 'https://unverified.attacker.com', checkedAt: 'forged', temporary: false,
    accessToken: 'private-remote-value', extra: { password: 'private' },
  };
  const result = await checkGateway('https://preview.trycloudflare.com:8443', { allowTemporary: true, fetchImpl: mocked(injected) });
  assert.equal(result.gatewayUrl, 'https://preview.trycloudflare.com:8443');
  assert.equal(result.temporary, true);
  assert.notEqual(result.checkedAt, 'forged');
  assert.equal(Object.hasOwn(result, 'accessToken'), false);
  assert.equal(Object.hasOwn(result, 'extra'), false);
});

test('temporary hostname classification ignores ports and cannot be overridden by setup', async () => {
  for (const host of ['trycloudflare.com', 'preview.trycloudflare.com', 'preview.trycloudflare.com:8443']) {
    const result = await checkGateway(`https://${host}`, { allowTemporary: true, fetchImpl: mocked({ ...ready, temporary: false }) });
    assert.equal(result.temporary, true);
  }
  assert.equal((await checkGateway('https://gateway.example.com', { fetchImpl: mocked({ ...ready, temporary: true }) })).temporary, false);
});

test('oversized health and setup bodies fail before release metadata is accepted', async () => {
  for (const oversizedRoute of ['/health', '/v1/setup/status']) {
    await assert.rejects(checkGateway('https://gateway.example.com', { fetchImpl: async url => {
      if (url.endsWith(oversizedRoute)) return new Response(JSON.stringify({ content: 'x'.repeat(256 * 1024) }));
      return mocked()(url);
    } }), /JSON/);
  }
});


test('accepts public HTTPS IPv4 while blocking reserved ranges and alternate loopback spellings', () => {
  assert.equal(validateFriendGateway('https://8.8.8.8/'), 'https://8.8.8.8');
  for (const host of ['0.0.0.0', '10.2.3.4', '100.64.1.2', '127.1', '0x7f000001', '169.254.169.254', '172.16.0.1', '192.0.2.1', '192.168.1.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255']) {
    assert.throws(() => validateFriendGateway(`https://${host}`));
  }
});

test('public IP support does not waive admin, registration, provider or normal TLS checks', async () => {
  const address = 'https://8.8.8.8';
  for (const setup of [{ ...ready, needsBootstrap: true }, { ...ready, registrationEnabled: false }, { ...ready, providerConfigured: false }]) {
    await assert.rejects(checkGateway(address, { fetchImpl: mocked(setup) }));
  }
  await assert.rejects(checkGateway(address, { fetchImpl: async () => { throw new Error('TLS certificate not trusted'); } }), /TLS/);
  assert.equal((await checkGateway(address, { fetchImpl: mocked() })).gatewayUrl, address);
});

test('explicit existing-account releases support closed signup while keeping readiness checks', async () => {
  const closed = { ...ready, registrationEnabled: false };
  const result = await checkGateway('https://gateway.example.com', { requireRegistration: false, fetchImpl: mocked(closed) });
  assert.equal(result.registrationEnabled, false);
  for (const setup of [{ ...closed, needsBootstrap: true }, { ...closed, providerConfigured: false }, { ...closed, registrationEnabled: undefined }]) {
    await assert.rejects(checkGateway('https://gateway.example.com', { requireRegistration: false, fetchImpl: mocked(setup) }));
  }
});
