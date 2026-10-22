import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOwnerGateway } from '../check_owner_gateway.mjs';
const address = 'https://8.8.8.8';
const setup = { needsBootstrap: true, bootstrapTokenRequired: true, registrationEnabled: false, providerConfigured: false };
const mocked = (status = setup, protectedCode = 401) => async url => url.endsWith('/v1/tools')
  ? new Response('{}', { status: protectedCode })
  : new Response(JSON.stringify(url.endsWith('/health') ? { ok: true, service: 'nova-chat-gateway' } : status));
test('owner test packages can reach token-protected initial setup without claiming working chat', async () => {
  const result = await checkOwnerGateway(address, { fetchImpl: mocked() });
  assert.equal(result.needsBootstrap, true); assert.equal(result.chatVerified, false);
  assert.equal(result.audience, 'server-owner-test'); assert.equal(result.registrationEnabled, false);
});
test('owner checks reject tokenless bootstrap and missing authentication', async () => {
  await assert.rejects(checkOwnerGateway(address, { fetchImpl: mocked({ ...setup, bootstrapTokenRequired: false }) }));
  await assert.rejects(checkOwnerGateway(address, { fetchImpl: mocked(setup, 200) }));
  await assert.rejects(checkOwnerGateway(address, { fetchImpl: mocked({}) }));
});
test('owner test does not trust remote metadata or suppress TLS failures', async () => {
  const result = await checkOwnerGateway(address, { fetchImpl: mocked({ ...setup, gatewayUrl: 'https://attacker.example.com', chatVerified: true, accessToken: 'private' }) });
  assert.equal(result.gatewayUrl, address); assert.equal(result.chatVerified, false); assert.equal(Object.hasOwn(result, 'accessToken'), false);
  await assert.rejects(checkOwnerGateway(address, { fetchImpl: async () => { throw new Error('TLS rejected'); } }), /TLS/);
});

test('owner checks send the current client version through the app upgrade gate', async () => {
  const result = await checkOwnerGateway(address, { fetchImpl: async (url, options) => {
    assert.equal(options.headers['x-nova-app-version'], '1.1.31');
    assert.equal(options.headers['x-nova-app-version-code'], '33');
    return mocked()(url);
  } });
  assert.equal(result.audience, 'server-owner-test');
});
