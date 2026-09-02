import type { AttachmentRef } from '@nova-chat/protocol';
import { Directory, File, Paths } from 'expo-file-system';
import { normalizeServerUrl, toRestUrl } from '../lib/connection';

const CACHE_DIRECTORY_NAME = 'nova-chat-images';
const DOWNLOAD_TIMEOUT_MS = 60_000;
const inFlightDownloads = new Map<string, Promise<string>>();

type GatewayImageAttachment = Pick<AttachmentRef, 'id' | 'mimeType'> & { size?: number };

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function serverFingerprint(serverUrl: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < serverUrl.length; index += 1) {
    hash ^= serverUrl.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function gatewayImageCacheFileName(serverUrl: string, attachment: Pick<AttachmentRef, 'id' | 'mimeType'>): string {
  const base = normalizeServerUrl(serverUrl);
  const extension = MIME_EXTENSIONS[attachment.mimeType.toLowerCase()] ?? '.img';
  return `${serverFingerprint(base)}-${attachment.id}${extension}`;
}

export function gatewayImageRequest(
  serverUrl: string,
  accessToken: string,
  attachment: Pick<AttachmentRef, 'id' | 'mimeType'>,
): { url: string; headers: Record<string, string>; cacheFileName: string } {
  const base = normalizeServerUrl(serverUrl);
  if (!base) throw new Error('服务器地址无效。');
  if (!accessToken) throw new Error('登录已失效。');
  return {
    url: toRestUrl(base, `/v1/files/${encodeURIComponent(attachment.id)}`),
    headers: { authorization: `Bearer ${accessToken}` },
    cacheFileName: gatewayImageCacheFileName(base, attachment),
  };
}

function cacheFile(serverUrl: string, attachment: Pick<AttachmentRef, 'id' | 'mimeType'>): File {
  const cacheDirectory = new Directory(Paths.cache, CACHE_DIRECTORY_NAME);
  if (!cacheDirectory.exists) cacheDirectory.create({ idempotent: true, intermediates: true });
  return new File(cacheDirectory, gatewayImageCacheFileName(serverUrl, attachment));
}

function removeIfPresent(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // Cache cleanup failure must not crash the conversation screen.
  }
}

async function downloadGatewayImage(
  serverUrl: string,
  accessToken: string,
  attachment: GatewayImageAttachment,
): Promise<string> {
  const request = gatewayImageRequest(serverUrl, accessToken, attachment);
  const destination = cacheFile(serverUrl, attachment);
  if (destination.exists && (attachment.size === undefined ? destination.size > 0 : destination.size === attachment.size)) return destination.uri;
  removeIfPresent(destination);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const downloaded = await File.downloadFileAsync(request.url, destination, {
      headers: request.headers,
      idempotent: true,
      signal: controller.signal,
    });
    if (!downloaded.exists || downloaded.size <= 0 || (attachment.size !== undefined && downloaded.size !== attachment.size)) {
      removeIfPresent(downloaded);
      throw new Error('图片下载不完整。');
    }
    return downloaded.uri;
  } catch (error) {
    removeIfPresent(destination);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function loadGatewayImage(
  serverUrl: string,
  accessToken: string,
  attachment: GatewayImageAttachment,
): Promise<string> {
  const base = normalizeServerUrl(serverUrl);
  const key = `${base}|${attachment.id}`;
  const existing = inFlightDownloads.get(key);
  if (existing) return existing;

  const pending = downloadGatewayImage(base, accessToken, attachment).finally(() => {
    inFlightDownloads.delete(key);
  });
  inFlightDownloads.set(key, pending);
  return pending;
}

export function invalidateGatewayImage(
  serverUrl: string,
  attachment: Pick<AttachmentRef, 'id' | 'mimeType'>,
): void {
  removeIfPresent(cacheFile(serverUrl, attachment));
}
