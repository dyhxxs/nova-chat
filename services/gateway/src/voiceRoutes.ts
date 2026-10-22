import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AppConfig } from './config.js';
import type { AppDatabase } from './database.js';
import { VoiceProvider, VoiceError, MAX_VOICE_BYTES, detectVoiceAudio, downloadVoiceAudio, mp3DurationMs } from './voiceProvider.js';

import { chatVoices, resolveChatVoice } from './voiceCatalog.js';
export { CHAT_VOICES } from './voiceCatalog.js';
const speechSchema = z.object({ requestId: z.string().uuid(), text: z.string().trim().min(1).max(2000), voiceId: z.string().max(120).optional() });
const idSchema = z.object({ requestId: z.string().uuid() });

export function registerVoiceRoutes(app: FastifyInstance, database: AppDatabase, config: AppConfig,
  requireUser: (request: FastifyRequest, reply: FastifyReply) => { id: string; sessionId: string } | undefined) {
  const active = new Map<string, Promise<any>>();
  const credentials = () => {
    const saved = database.getCompanionProviderSettings('chat');
    const baseUrl = config.voiceBaseUrl || saved.apiBaseUrl;
    const sameDestination = baseUrl.replace(/\/+$/, '') === saved.apiBaseUrl.replace(/\/+$/, '');
    return { baseUrl, key: config.voiceApiKey || (sameDestination ? saved.apiKey : '') };
  };
  const provider = (model = config.voiceTtsModel) => {
    const { baseUrl, key } = credentials();
    return new VoiceProvider(baseUrl, key, model, config.voiceAsrModel);
  };
  const execute = async (key: string, userId: string, work: () => Promise<any>) => {
    const existing = active.get(key); if (existing) return existing;
    if ([...active.keys()].filter(id => id.startsWith(userId + ':')).length >= 2) throw new VoiceError('voice_busy', '已有语音正在处理，请稍后再试。', 429);
    const pending = work(); active.set(key, pending);
    try { return await pending; } finally { active.delete(key); }
  };
  const errorReply = (reply: FastifyReply, error: unknown) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_voice_request', message: '语音参数无效。', retryable: false } });
    const known = error instanceof VoiceError ? error : new VoiceError('voice_failed', '语音处理失败，请检查网络后重试。');
    return reply.code(known.status).send({ error: { code: known.code, message: known.message, retryable: known.retryable } });
  };
  const account = (request: FastifyRequest, reply: FastifyReply) => {
    const user = requireUser(request, reply);
    if (user?.sessionId === 'legacy') { reply.code(403).send({ error: { code: 'account_required', message: '使用语音需要登录账户。', retryable: false } }); return; }
    return user;
  };
  async function storeAudio(userId: string, bytes: Buffer) {
    const format = detectVoiceAudio(bytes);
    if (!format) throw new VoiceError('voice_invalid_audio', '无法读取语音，请重新录制。', 415, false);
    const fileId = randomUUID(), storagePath = path.join(database.uploadsDir, fileId + format.extension);
    await writeFile(storagePath, bytes, { flag: 'wx' });
    try { database.createFile({ id: fileId, userId, name: '语音' + format.extension, mimeType: format.mimeType, size: bytes.length, kind: 'document', storagePath }); }
    catch (error) { await unlink(storagePath).catch(() => undefined); throw error; }
    return fileId;
  }
  app.get('/v1/voice/config', async (request, reply) => {
    if (!account(request, reply)) return;
    reply.header('cache-control', 'no-store');
    return { enabled: Boolean(credentials().key), maxDurationMs: 60_000, defaultVoiceId: resolveChatVoice(config)?.id ?? config.voiceDefaultId, voices: chatVoices(config) };
  });
  app.post('/v1/voice/messages/:requestId', async (request, reply) => {
    const user = account(request, reply); if (!user) return;
    try {
      const { requestId } = idSchema.parse(request.params);
      const durationMs = z.coerce.number().int().min(600).max(61_000).parse((request.query as { durationMs?: string }).durationMs);
      const cached = database.getVoiceJob(user.id, requestId);
      if (cached) { if (cached.kind !== 'recording') throw new VoiceError('voice_id_conflict', '语音标识冲突，请重新录制。', 409, false); return { voice: cached.voice, text: cached.text }; }
      const part = await request.file({ limits: { fileSize: MAX_VOICE_BYTES, files: 1 } });
      if (!part) throw new VoiceError('voice_required', '请先录制语音。', 400, false);
      const bytes = await part.toBuffer();
      const format = detectVoiceAudio(bytes);
      if (!format || !bytes.length || part.file.truncated) throw new VoiceError('voice_invalid_audio', '语音格式无效或文件过大，请重新录制。', 415, false);
      return await execute(user.id + ':record:' + requestId, user.id, async () => {
        const text = await provider().transcribe(bytes, format.mimeType);
        const fileId = await storeAudio(user.id, bytes);
        const voice = { fileId, durationMs, status: 'ready', requestId };
        database.saveVoiceJob(user.id, requestId, { kind: 'recording', text, voice });
        return { voice, text };
      });
    } catch (error) {
      if (error instanceof app.multipartErrors.RequestFileTooLargeError) return errorReply(reply, new VoiceError('voice_too_large', '语音不能超过 8 MB。', 413, false));
      return errorReply(reply, error);
    }
  });
  app.post('/v1/voice/speech', async (request, reply) => {
    const user = account(request, reply); if (!user) return;
    try {
      const input = speechSchema.parse(request.body);
      const selected = resolveChatVoice(config, input.voiceId);
      reply.code(202);
      return await execute(user.id + ':tts:' + input.requestId, user.id, async () => {
        const existing = database.getVoiceJob(user.id, input.requestId);
        if (existing) {
          if (existing.kind !== 'speech' || existing.text !== input.text || (input.voiceId && existing.voiceId !== input.voiceId && existing.requestedVoiceId !== input.voiceId && existing.voiceId !== selected?.id)) throw new VoiceError('voice_id_conflict', '语音标识冲突，请重试。', 409, false);
          return { voice: existing.voice };
        }
        if (!selected) throw new VoiceError('voice_invalid_id', '请选择可用的音色。', 400, false);
        const voiceId = selected.id;
        const voice = { status: 'pending', durationMs: 0, requestId: input.requestId, voiceId };
        const job = { kind: 'speech', text: input.text, voiceId, requestedVoiceId: input.voiceId || config.voiceDefaultId, model: selected.model, voice, createdAt: Date.now(), taskId: '' };
        // Persist before dispatch so a lost response never submits the paid task twice.
        database.saveVoiceJob(user.id, input.requestId, job);
        try { job.taskId = await provider(selected.model).submit(input.text, voiceId); database.saveVoiceJob(user.id, input.requestId, job); }
        catch (error) { database.saveVoiceJob(user.id, input.requestId, { ...job, voice: { ...voice, status: 'error', error: '语音合成未能启动，点按重试。' } }); throw error; }
        return { voice };
      });
    } catch (error) { return errorReply(reply, error); }
  });
  app.get('/v1/voice/speech/:requestId', async (request, reply) => {
    const user = account(request, reply); if (!user) return;
    reply.header('cache-control', 'no-store');
    try {
      const { requestId } = idSchema.parse(request.params);
      return await execute(user.id + ':tts:' + requestId, user.id, async () => {
        const job = database.getVoiceJob(user.id, requestId);
        if (!job || job.kind !== 'speech') throw new VoiceError('voice_not_found', '语音任务不存在。', 404, false);
        if (job.voice.status !== 'pending') return { voice: job.voice };
        if (!job.taskId || Date.now() - job.createdAt > 10 * 60_000) {
          job.voice = { ...job.voice, status: 'error', error: '语音生成超时，点按重试。' };
        } else {
          const status = await provider().status(job.taskId);
          if (status.state === 'ready') {
            const bytes = await downloadVoiceAudio(status.url!);
            if (detectVoiceAudio(bytes)?.mimeType !== 'audio/mpeg') throw new VoiceError('voice_invalid_audio', '语音服务返回了无效音频。');
            job.voice = { ...job.voice, status: 'ready', fileId: await storeAudio(user.id, bytes), durationMs: mp3DurationMs(bytes) };
          } else if (status.state === 'error') job.voice = { ...job.voice, status: 'error', error: '语音没有生成成功，点按重试。' };
        }
        database.saveVoiceJob(user.id, requestId, job);
        return { voice: job.voice };
      });
    } catch (error) { return errorReply(reply, error); }
  });
}
