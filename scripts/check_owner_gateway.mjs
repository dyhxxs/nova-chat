import { pathToFileURL } from 'node:url';
import { readGatewayJson, validateFriendGateway } from './check_gateway.mjs';

/** Owner-only installation test; deliberately NOT the authenticated friend release gate. */
export async function checkOwnerGateway(value, { fetchImpl = fetch } = {}) {
  const gatewayUrl = validateFriendGateway(value);
  async function get(route) {
    const response = await fetchImpl(gatewayUrl + route, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
    if (!response.ok) throw new Error(`${route} HTTP ${response.status}`);
    return readGatewayJson(response);
  }
  const health = await get('/health');
  if (health?.ok !== true || health?.service !== 'nova-chat-gateway') throw new Error('Target is not a healthy Nova Gateway.');
  const setup = await get('/v1/setup/status');
  for (const name of ['needsBootstrap', 'bootstrapTokenRequired', 'registrationEnabled', 'providerConfigured']) {
    if (typeof setup?.[name] !== 'boolean') throw new Error('Invalid setup status.');
  }
  if (setup.needsBootstrap && !setup.bootstrapTokenRequired) throw new Error('Public server bootstrap must require a secret token.');
  const protectedRoute = await fetchImpl(gatewayUrl + '/v1/tools', { signal: AbortSignal.timeout(15_000), redirect: 'error' });
  await protectedRoute.body?.cancel();
  if (protectedRoute.status !== 401) throw new Error('Anonymous access is not rejected as expected.');
  return {
    gatewayUrl, checkedAt: new Date().toISOString(), audience: 'server-owner-test', chatVerified: false,
    needsBootstrap: setup.needsBootstrap, bootstrapTokenRequired: setup.bootstrapTokenRequired,
    registrationEnabled: setup.registrationEnabled, providerConfigured: setup.providerConfigured,
    anonymousProtectedRouteRejected: true,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await checkOwnerGateway(process.argv[2]), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
