import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { GatewayApiError, requestJson } from './gatewayApiClient';
import { appVersionHeaders } from '../lib/appUpdate';
import { normalizeServerUrl, toRestUrl } from '../lib/connection';
import { voiceMessageSchema, type RecordedVoice, type VoiceMessage } from '../lib/voice';

export type VoiceConfig = { enabled: boolean; maxDurationMs: number; defaultVoiceId: string; voices: { id: string; name: string; aliases?: string[] }[] };

export function getVoiceConfig(serverUrl: string, accessToken: string, signal?: AbortSignal): Promise<VoiceConfig> {
  return requestJson(serverUrl, '/v1/voice/config', { accessToken, signal });
}

type VoiceUploadResponse = { text: string; voice: unknown };
export type VoiceLanguageId = 'cantonese' | 'english';

function voiceUploadPath(recording: RecordedVoice, languageId?: VoiceLanguageId): string {
  const language = languageId ? '&languageId=' + encodeURIComponent(languageId) : '';
  return '/v1/voice/messages/' + recording.requestId + '?durationMs=' + recording.durationMs + language;
}

function finishVoiceUpload(result: VoiceUploadResponse): { text: string; voice: VoiceMessage } {
  if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('没有识别到说话内容，请重新录制。');
  return { text: result.text, voice: voiceMessageSchema.parse(result.voice) };
}

async function uploadVoiceOnWeb(serverUrl: string, accessToken: string, recording: RecordedVoice, signal?: AbortSignal, languageId?: VoiceLanguageId) {
  const form = new FormData();
  const source = await fetch(recording.uri, { signal });
  form.append('file', await source.blob(), 'voice.webm');
  const result = await requestJson<VoiceUploadResponse>(serverUrl,
    voiceUploadPath(recording, languageId),
    { method: 'POST', body: form, accessToken, signal, timeoutMs: 120_000 });
  return finishVoiceUpload(result);
}

async function uploadVoiceOnNative(serverUrl: string, accessToken: string, recording: RecordedVoice, signal?: AbortSignal, languageId?: VoiceLanguageId) {
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
    // Expo's native file uploader is not reliable for this protected HTTPS
    // endpoint on all Android builds. Build the same multipart payload used by
    // the web client from a real Blob so fetch can send it consistently.
    const form = new FormData();
    form.append('file', new Blob([await localFile.bytes()], { type: recording.mimeType }), 'voice.m4a');
    const result = await requestJson<VoiceUploadResponse>(base, voiceUploadPath(recording, languageId), {
      method: 'POST', body: form, accessToken, signal: controller.signal, timeoutMs,
    });
    return finishVoiceUpload(result);
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

export function uploadVoice(serverUrl: string, accessToken: string, recording: RecordedVoice, signal?: AbortSignal, languageId?: VoiceLanguageId): Promise<{ text: string; voice: VoiceMessage }> {
  return Platform.OS === 'web'
    ? uploadVoiceOnWeb(serverUrl, accessToken, recording, signal, languageId)
    : uploadVoiceOnNative(serverUrl, accessToken, recording, signal, languageId);
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

export type SpeechPlaybackFile = { uri: string; revoke: () => void };

const SPEECH_CACHE_DIRECTORY = 'nova-chat-voices';
const SPEECH_CACHE_VERSION = 'v2';
const SPEECH_DOWNLOAD_TIMEOUT_MS = 60_000;

function speechCacheFile(serverUrl: string, fileId: string, extension: string): File {
  const directory = new Directory(Paths.cache, SPEECH_CACHE_DIRECTORY);
  if (!directory.exists) directory.create({ idempotent: true, intermediates: true });
  return new File(directory, `${SPEECH_CACHE_VERSION}-${fileId}${extension}`);
}

function audioExtension(mimeType: string): string {
  const mime = mimeType.toLowerCase().split(';', 1)[0]?.trim();
  if (mime === 'audio/mp4' || mime === 'audio/m4a' || mime === 'audio/x-m4a') return '.m4a';
  if (mime === 'audio/webm') return '.webm';
  if (mime === 'audio/ogg' || mime === 'audio/opus') return '.ogg';
  if (mime === 'audio/wav' || mime === 'audio/x-wav') return '.wav';
  return '.mp3';
}

function removeSpeechCacheFile(file: File): void {
  try { if (file.exists) file.delete(); } catch { /* Cache cleanup must not block playback. */ }
}

/** Download protected speech before playback so Android media players never need to carry an Authorization header. */
export async function downloadSpeechAudio(serverUrl: string, accessToken: string, fileId: string): Promise<SpeechPlaybackFile> {
  const base = normalizeServerUrl(serverUrl);
  if (!base || !accessToken || !fileId) throw new GatewayApiError('voice_download_invalid', '语音地址无效，请重新登录后重试。', false, 0);
  const url = toRestUrl(base, '/v1/files/' + encodeURIComponent(fileId));
  const headers = { ...appVersionHeaders, authorization: 'Bearer ' + accessToken };
  if (Platform.OS === 'web') {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new GatewayApiError('voice_download_failed', '语音下载失败，请稍后重试。', response.status >= 500, response.status);
    const blob = await response.blob();
    if (!blob.size) throw new GatewayApiError('voice_download_empty', '语音文件为空，请重新生成。', true, response.status);
    const uri = URL.createObjectURL(blob);
    return { uri, revoke: () => URL.revokeObjectURL(uri) };
  }

  const cached = ['.mp3', '.m4a', '.webm', '.ogg', '.wav']
    .map((extension) => speechCacheFile(base, fileId, extension))
    .find((candidate) => candidate.exists && candidate.size > 0);
  if (cached) return { uri: cached.uri, revoke: () => undefined };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SPEECH_DOWNLOAD_TIMEOUT_MS);
  let destination: File | undefined;
  try {
    // Download with fetch and write the bytes ourselves. Android's native download
    // manager has differed across Expo SDK releases in how it forwards custom
    // Authorization headers; the media player then receives a valid local file.
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new GatewayApiError('voice_download_failed', '语音下载失败，请稍后重试。', response.status >= 500, response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength) throw new GatewayApiError('voice_download_empty', '语音文件为空，请重新生成。', true, response.status);
    destination = speechCacheFile(base, fileId, audioExtension(response.headers.get('content-type') ?? ''));
    removeSpeechCacheFile(destination);
    destination.write(bytes);
    if (!destination.exists || !destination.size) {
      removeSpeechCacheFile(destination);
      throw new GatewayApiError('voice_download_empty', '语音文件保存失败，请重新生成。', true, response.status);
    }
    return { uri: destination.uri, revoke: () => undefined };
  } catch (error) {
    if (destination) removeSpeechCacheFile(destination);
    if (error instanceof GatewayApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new GatewayApiError('voice_download_timeout', '语音下载超时，请检查网络后重试。', true, 0);
    throw new GatewayApiError('voice_download_failed', '语音下载失败，请检查网络后重试。', true, 0);
  } finally {
    clearTimeout(timer);
  }
}
