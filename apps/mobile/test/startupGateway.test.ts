import { describe, expect, it } from 'vitest';
import { resolveStartupGateway } from '../src/lib/startupGateway';
import { toWebSocketUrl } from '../src/lib/connection';

const current = 'https://8.8.8.8';
const old = 'https://old-gateway.example.com';
describe('bundled server upgrades', () => {
  it('uses the public HTTPS IP on fresh installs and derives WSS', () => {
    expect(resolveStartupGateway({ builtInUrl: current })).toEqual({ serverUrl: current, accessToken: '', changedGateway: false, discardCredential: false });
    expect(toWebSocketUrl(current)).toBe('wss://8.8.8.8/v1/chat/stream');
  });
  it('replaces an old saved address without forwarding its session', () => {
    expect(resolveStartupGateway({ builtInUrl: current, savedUrl: old, credentialUrl: old, token: 'old-session' })).toEqual({ serverUrl: current, accessToken: '', changedGateway: true, discardCredential: true });
  });
  it('uses the credential origin even when ordinary settings claim a new server', () => {
    expect(resolveStartupGateway({ builtInUrl: current, savedUrl: current, credentialUrl: old, token: 'old-session' }).accessToken).toBe('');
  });
  it('keeps a correctly bound session despite stale ordinary settings', () => {
    expect(resolveStartupGateway({ builtInUrl: current, savedUrl: old, credentialUrl: current, token: 'current-session' }).accessToken).toBe('current-session');
  });
  it('never forwards a legacy token based only on mutable saved settings', () => {
    expect(resolveStartupGateway({ builtInUrl: current, savedUrl: old, token: 'legacy' }).discardCredential).toBe(true);
    expect(resolveStartupGateway({ builtInUrl: current, token: 'legacy' }).discardCredential).toBe(true);
    expect(resolveStartupGateway({ builtInUrl: current, savedUrl: current, token: 'legacy' }).discardCredential).toBe(true);
  });
  it('normalizes trailing slashes before deciding a session changed origin', () => {
    expect(resolveStartupGateway({ builtInUrl: ` ${current}/ `, credentialUrl: `${current}/`, token: 'same-session' }).discardCredential).toBe(false);
  });
  it('keeps custom gateways when no gateway is bundled', () => {
    expect(resolveStartupGateway({ savedUrl: current, credentialUrl: old, token: 'custom' })).toEqual({ serverUrl: old, accessToken: 'custom', changedGateway: false, discardCredential: false });
  });
  it('switches logged-out installations without attempting credential deletion', () => {
    expect(resolveStartupGateway({ builtInUrl: current, savedUrl: old })).toEqual({ serverUrl: current, accessToken: '', changedGateway: true, discardCredential: false });
  });
});
