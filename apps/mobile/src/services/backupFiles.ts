import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { MAX_BACKUP_BYTES } from '../lib/conversationBackup';
import { createId } from '../lib/id';

export async function pickBackupText(maxBytes = MAX_BACKUP_BYTES): Promise<string | undefined> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', 'application/octet-stream'], copyToCacheDirectory: true, multiple: false });
  if (result.canceled) return;
  const asset = result.assets[0];
  if (!asset) return;
  const file = new File(asset.uri);
  try {
    if ((asset.size ?? file.size) > maxBytes) throw new Error(`备份不能超过 ${Math.floor(maxBytes / 1024 / 1024)} MB。`);
    return await file.text();
  } finally {
    // Only clean the picker-owned cache copy, never the user's original document.
    if (file.uri.startsWith(`${Paths.cache.uri.replace(/\/$/, '')}/`)) {
      try { file.delete(); } catch { /* OS cache cleanup remains available. */ }
    }
  }
}

export async function shareTextFile(text: string, format: 'json' | 'md', kind: 'conversations' | 'assistants' | 'recovery' | 'knowledge' = 'conversations', isCurrent: () => boolean = () => true): Promise<void> {
  if (!isCurrent()) throw new Error('账号或页面已变化，已取消导出。');
  if (!await Sharing.isAvailableAsync()) throw new Error('当前设备无法打开系统分享，请使用支持文件分享的设备。');
  if (!isCurrent()) throw new Error('账号或页面已变化，已取消导出。');
  const directory = new Directory(Paths.cache, 'nova-text-exports');
  directory.create({ idempotent: true, intermediates: true });
  // Retain a short grace period: on Android the chosen app may read after the
  // chooser closes. These are our own cache files, not the user's documents.
  for (const entry of directory.list()) {
    if (entry instanceof File && entry.modificationTime !== null && Date.now() - entry.modificationTime > 3_600_000) {
      try { entry.delete(); } catch { /* Best-effort removal of old exports. */ }
    }
  }
  const file = new File(directory, `nova-${kind}-${Date.now()}-${createId()}.${format}`);
  let shareStarted = false;
  try {
    file.create();
    file.write(text);
    if (!isCurrent()) throw new Error('账号或页面已变化，已取消导出。');
    shareStarted = true;
    await Sharing.shareAsync(file.uri, {
      mimeType: format === 'json' ? 'application/json' : 'text/markdown',
      UTI: format === 'json' ? 'public.json' : 'public.plain-text', dialogTitle: '保存或分享 Nova 文件',
    });
  } finally {
    const remove = () => { try { file.delete(); } catch { /* App shutdown / OS cache eviction. */ } };
    if (shareStarted) setTimeout(remove, 3_600_000); else remove();
  }
}
