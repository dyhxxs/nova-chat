import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMPANION_PROFILE_VERSION_HEADER, companionProfileSchema } from '@nova-chat/protocol';
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-file-system', () => ({ File: class {}, UploadType: { MULTIPART: 0 } }));
import { createCompanion, getCompanion, listCompanions, updateCompanion } from '../src/services/gatewayApiClient';
const id = 'a34273f2-f30a-454e-9c10-cffb9fcf964d';
const profile = companionProfileSchema.parse({ id, templateVersion: 1, name: 'Lumi', appearance: 'Short hair', personaPrompt: 'You are Lumi. Reply naturally.', createdAt: 1, updatedAt: 2 });
afterEach(() => vi.unstubAllGlobals());
describe('companion profile capability negotiation', () => {
  it('opts all profile reads and writes into v3 so persona prompts and reference appearance are kept', async () => {
    const mock = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/companions') ? { companions: [profile], companion: profile } : { companion: profile })));
    vi.stubGlobal('fetch', mock);
    expect((await listCompanions('https://gateway.test', 'synthetic-token'))[0]?.appearance).toBe(profile.appearance);
    expect((await createCompanion('https://gateway.test', 'synthetic-token', { name: profile.name })).appearance).toBe(profile.appearance);
    expect((await updateCompanion('https://gateway.test', 'synthetic-token', id, { name: profile.name })).appearance).toBe(profile.appearance);
    expect((await getCompanion('https://gateway.test', 'synthetic-token', id)).appearance).toBe(profile.appearance);
    expect((await listCompanions('https://gateway.test', 'synthetic-token'))[0]?.personaPrompt).toBe(profile.personaPrompt);
    expect(mock).toHaveBeenCalledTimes(5);
    for (const call of mock.mock.calls) expect((call as unknown as [string, RequestInit])[1].headers).toMatchObject({ [COMPANION_PROFILE_VERSION_HEADER]: '3', authorization: 'Bearer synthetic-token' });
  });
  it('still reads the original profile shape from an older gateway', async () => {
    const old = { ...profile } as Record<string, unknown>; delete old.appearance; delete old.avatarFileId; delete old.personaPrompt;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ companions: [old] }))));
    const result = await listCompanions('https://gateway.test', 'synthetic-token');
    expect(result[0]).toMatchObject({ id, name: 'Lumi', appearance: '', avatarFileId: null, personaPrompt: '' });
  });
});
