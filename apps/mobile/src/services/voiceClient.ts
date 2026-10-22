import { Platform } from 'react-native';
import { File, UploadType } from 'expo-file-system';
import { GatewayApiError, parseUploadJson, requestJson } from './gatewayApiClient';
import { appVersionHeaders } from '../lib/appUpdate';
import { normalizeServerUrl, toRestUrl } from '../lib/connection';
import { voiceMessageSchema, type RecordedVoice, type VoiceMessage } from '../lib/voice';

export type VoiceConfig = { enabled: boolean; maxDurationMs: number; defaultVoiceId: string; voices: { id: string; name: string; aliases?: string[] }[] };

export function getVoiceConfig(serverUrl: string, accessToken: string, signal?: AbortSignal): Promise<VoiceConfig> {
  return requestJson(serverUrl, '/v1/voice/config', { accessToken, signal });
}

type VoiceUploadResponse = { text: string; voice: unknown };

function finishVoiceUpload(result: VoiceUploadResponse): { text: string; voice: VoiceMessage } {
  if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('没有识别到说话内容，请重新录制。');
  return { text: result.text, voice: voiceMessageSchema.parse(result.voice) };
}

async function uploadVoiceOnWeb(serverUrl: string, accessToken: string, recording: RecordedVoice, signal?: AbortSignal) {
  const form = new FormData();
  const source = await fetch(recording.uri, { signal });
  form.append('file', await source.blob(), 'voice.webm');
  const result = await requestJson<VoiceUploadResponse>(serverUrl,
    '/v1/voice/messages/' + recording.requestId + '?durationMs=' + recording.durationMs,
    { method: 'POST', body: form, accessToken, signal, timeoutMs: 120_000 });
  return finishVoiceUpload(result);
}

async function uploadVoiceOnNative(serverUrl: string, accessToken: string, recording: RecordedVoice, signal?: AbortSignal) {
  const base = normalizeServerUrl(serverUrl);
  if (!base) throw new GatewayApiError('invalid_server_url', '请先填写服务器地址。', false, 0);
  let localFile: File;
  try {
    localFile = new File(recording.uri);
    if (!localFile.exists) throw new Error('Local recording does not exist or cannot be read.');
  } catch {
    throw new GatewayApiError('local_file_unavailable', '无法读取录音文件，请重新录制。', false, 0);
  }

  const controller = new AbortController();
  const timeoutMs = 120_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    const result = await localFile.upload(toRestUrl(base, '/v1/voice/messages/' + recording.requestId + '?durationMs=' + recording.durationMs), {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'file',
      mimeType: recording.mimeType,
      headers: { ...appVersionHeaders, authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
      sessionType: 'foreground',
    });
    return finishVoiceUpload(parseUploadJson<VoiceUploadResponse>(base, result.status, result.body));
  } catch (error) {
    if (error instanceof GatewayApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      if (signal?.aborted) throw new GatewayApiError('aborted', '请求已取消。', false, 0);
      throw new GatewayApiError('upload_timeout', '语音上传超时，请保持应用在前台后重试。', true, 0);
    }
    throw new GatewayApiError('upload_network_error', '无法上传语音，请检查网络和服务器状态。', true, 0);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

export function uploadVoice(serverUrl: string, accessToken: string, recording: RecordedVoice, signal?: AbortSignal): Promise<{ text: string; voice: VoiceMessage }> {
  return Platform.OS === 'web'
    ? uploadVoiceOnWeb(serverUrl, accessToken, recording, signal)
    : uploadVoiceOnNative(serverUrl, accessToken, recording, signal);
}

export async function submitSpeech(serverUrl: string, accessToken: string, text: string, voice: VoiceMessage, signal?: AbortSignal): Promise<VoiceMessage> {
  const result = await requestJson<{ voice: unknown }>(serverUrl, '/v1/voice/speech', {
    method: 'POST', accessToken, signal, timeoutMs: 100_000,
    body: JSON.stringify({ requestId: voice.requestId, text, voiceId: voice.voiceId }),
  });
  return voiceMessageSchema.parse(result.voice);
}

export async function getSpeech(serverUrl: string, accessToken: string, requestId: string, signal?: AbortSignal): Promise<VoiceMessage> {
  const result = await requestJson<{ voice: unknown }>(serverUrl, '/v1/voice/speech/' + requestId, { accessToken, signal, timeoutMs: 45_000 });
  return voiceMessageSchema.parse(result.voice);
}