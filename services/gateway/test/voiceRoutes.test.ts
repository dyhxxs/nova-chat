import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { VoiceProvider } from '../src/voiceProvider.js';
const apps: FastifyInstance[] = [], directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const app of apps.splice(0)) await app.close(); for (const directory of directories.splice(0)) await rm(directory, {recursive:true,force:true}); });
async function setup(overrides: Record<string, string> = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'nova-voice-test-')); directories.push(dataDir);
  const config = loadConfig({ NODE_ENV:'test', DATA_DIR:dataDir, LOG_LEVEL:'silent', REQUESTS_PER_MINUTE:'1000', VOICE_API_KEY:'synthetic-key', VOICE_BASE_URL:'https://relay.test/v1', ...overrides });
  const app = await buildServer(config); apps.push(app);
  const auth = await app.inject({method:'POST',url:'/v1/auth/bootstrap',payload:{email:'voice@test.example',password:'test-password-123',displayName:'语音测试',deviceId:'voice-test-device'}});
  const headers = {authorization:'Bearer '+auth.json().accessToken};
  return {app,config,headers};
}
describe('voice endpoints', () => {
  it('replaces all saved female presets with the configured clone and preserves male choices', async () => {
    const {app,headers}=await setup({VOICE_FEMALE_CLONE_ID:'LK_test',VOICE_FEMALE_CLONE_NAME:'少女音'});
    const submit=vi.spyOn(VoiceProvider.prototype,'submit').mockResolvedValue('clone-task');
    const config=(await app.inject({url:'/v1/voice/config',headers})).json();
    expect(config.defaultVoiceId).toBe('LK_test');
    expect(config.voices.map((voice: {id:string})=>voice.id)).toEqual(['LK_test','zh_male_taocheng_uranus_bigtts','zh_male_liufei_uranus_bigtts']);
    for(const voiceId of [undefined,'zh_female_vv_uranus_bigtts','zh_female_xiaohe_uranus_bigtts','zh_female_linjianvhai_uranus_bigtts','LK_test']) {
      const payload={requestId:randomUUID(),text:'今天怎么样？',voiceId};
      const result=await app.inject({method:'POST',url:'/v1/voice/speech',headers,payload});
      expect(result.statusCode).toBe(202); expect(result.json().voice.voiceId).toBe('LK_test');
      await app.inject({method:'POST',url:'/v1/voice/speech',headers,payload});
    }
    expect(submit).toHaveBeenCalledTimes(5);
    const male=await app.inject({method:'POST',url:'/v1/voice/speech',headers,payload:{requestId:randomUUID(),text:'hello',voiceId:'zh_male_liufei_uranus_bigtts'}});
    expect(male.json().voice.voiceId).toBe('zh_male_liufei_uranus_bigtts');
  });
  it('recovers a persisted preset task after enabling the clone without paying again', async () => {
    const {app,config,headers}=await setup();
    const submit=vi.spyOn(VoiceProvider.prototype,'submit').mockResolvedValue('old-task');
    const payload={requestId:randomUUID(),text:'hello',voiceId:'zh_female_vv_uranus_bigtts'};
    await app.inject({method:'POST',url:'/v1/voice/speech',headers,payload});
    await app.close(); apps.splice(apps.indexOf(app),1);
    const upgraded=await buildServer({...config,voiceFemaleCloneId:'LK_test'}); apps.push(upgraded);
    const recovered=await upgraded.inject({method:'POST',url:'/v1/voice/speech',headers,payload});
    expect(recovered.statusCode).toBe(202); expect(submit).toHaveBeenCalledOnce();
    expect(recovered.json().voice.voiceId).toBe('zh_female_vv_uranus_bigtts');
  });
  it('does not forward an existing chat key to a changed voice destination', async () => {
    const {app,headers}=await setup({VOICE_API_KEY:'',VOICE_BASE_URL:'https://different-relay.test/v1',OPENAI_API_KEY:'saved-chat-secret',OPENAI_BASE_URL:'https://chat-relay.test/v1'});
    expect((await app.inject({url:'/v1/voice/config',headers})).json().enabled).toBe(false);
    const result=await app.inject({method:'POST',url:'/v1/voice/speech',headers,payload:{requestId:randomUUID(),text:'hello'}});
    expect(result.statusCode).toBe(503); expect(result.body).not.toContain('saved-chat-secret');
  });
  it('accepts original audio, preserves its transcript and deduplicates retries', async () => {
    const {app,headers}=await setup(); const transcribe=vi.spyOn(VoiceProvider.prototype,'transcribe').mockResolvedValue('今天想聊聊');
    const audio=Buffer.alloc(64);audio.write('RIFF',0);audio.write('WAVE',8);
    const boundary='voice-test', requestId=randomUUID();
    const payload=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="voice.wav"\r\nContent-Type: audio/wav\r\n\r\n'),audio,Buffer.from('\r\n--'+boundary+'--\r\n')]);
    const result=await app.inject({method:'POST',url:'/v1/voice/messages/'+requestId+'?durationMs=1200',headers:{...headers,'content-type':'multipart/form-data; boundary='+boundary},payload});
    expect(result.statusCode).toBe(200);expect(result.json().text).toBe('今天想聊聊');
    const duplicate=await app.inject({method:'POST',url:'/v1/voice/messages/'+requestId+'?durationMs=1200',headers});
    expect(duplicate.json().voice.fileId).toBe(result.json().voice.fileId);expect(transcribe).toHaveBeenCalledOnce();
    const download=await app.inject({url:'/v1/files/'+result.json().voice.fileId,headers});expect(download.rawPayload).toEqual(audio);
    expect((await app.inject({url:'/v1/files/'+result.json().voice.fileId})).statusCode).toBe(401);
  });

  it('requires an account and exposes no relay credentials', async () => {
    const {app,headers} = await setup();
    expect((await app.inject({url:'/v1/voice/config'})).statusCode).toBe(401);
    const config = await app.inject({url:'/v1/voice/config',headers});
    expect(config.json()).toMatchObject({enabled:true,maxDurationMs:60000});
    expect(config.body).not.toContain('synthetic-key'); expect(config.body).not.toContain('relay.test');
  });
  it('persists task identity across server restart and never resubmits a paid task', async () => {
    const {app,config,headers} = await setup();
    const submit = vi.spyOn(VoiceProvider.prototype,'submit').mockResolvedValue('task-123');
    const status = vi.spyOn(VoiceProvider.prototype,'status').mockResolvedValue({state:'pending'});
    const requestId = randomUUID(), payload = {requestId,text:'今天过得怎么样？'};
    expect((await app.inject({method:'POST',url:'/v1/voice/speech',headers,payload})).statusCode).toBe(202);
    await app.inject({method:'POST',url:'/v1/voice/speech',headers,payload}); expect(submit).toHaveBeenCalledOnce();
    await app.close(); apps.splice(apps.indexOf(app),1);
    const restored = await buildServer(config); apps.push(restored);
    await restored.inject({method:'POST',url:'/v1/voice/speech',headers,payload}); expect(submit).toHaveBeenCalledOnce();
    const poll = await restored.inject({url:'/v1/voice/speech/'+requestId,headers}); expect(poll.json().voice.status).toBe('pending'); expect(status).toHaveBeenCalledWith('task-123');
    const collision = await restored.inject({method:'POST',url:'/v1/voice/speech',headers,payload:{...payload,text:'different'}}); expect(collision.statusCode).toBe(409);
  });
  it('isolates another user’s tasks and rejects unsupported voices', async () => {
    const {app,headers} = await setup(); vi.spyOn(VoiceProvider.prototype,'submit').mockResolvedValue('task');
    const requestId=randomUUID(); await app.inject({method:'POST',url:'/v1/voice/speech',headers,payload:{requestId,text:'hello'}});
    const second=await app.inject({method:'POST',url:'/v1/auth/register',payload:{email:'second@test.example',password:'test-password-123',displayName:'第二人',deviceId:'voice-test-second'}});
    const res=await app.inject({url:'/v1/voice/speech/'+requestId,headers:{authorization:'Bearer '+second.json().accessToken}}); expect(res.statusCode).toBe(404);
    expect((await app.inject({method:'POST',url:'/v1/voice/speech',headers,payload:{requestId:randomUUID(),text:'hello',voiceId:'invalid'}})).statusCode).toBe(400);
  });
  it('records terminal synthesis failure without returning upstream details', async () => {
    const {app,headers}=await setup();vi.spyOn(VoiceProvider.prototype,'submit').mockResolvedValue('task');vi.spyOn(VoiceProvider.prototype,'status').mockResolvedValue({state:'error'});
    const requestId=randomUUID();await app.inject({method:'POST',url:'/v1/voice/speech',headers,payload:{requestId,text:'hello'}});
    const result=await app.inject({url:'/v1/voice/speech/'+requestId,headers});expect(result.json().voice.status).toBe('error');
  });
});
