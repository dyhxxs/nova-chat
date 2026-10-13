import * as DocumentPicker from 'expo-document-picker';
import { MAX_BACKUP_BYTES } from '../lib/conversationBackup';

export async function pickBackupText(maxBytes = MAX_BACKUP_BYTES): Promise<string | undefined> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain'], multiple: false });
  if (result.canceled) return;
  const asset = result.assets[0];
  if (!asset?.file) return;
  if (asset.file.size > maxBytes) throw new Error(`备份不能超过 ${Math.floor(maxBytes / 1024 / 1024)} MB。`);
  return asset.file.text();
}

export async function shareTextFile(text: string, format: 'json' | 'md', kind: 'conversations' | 'assistants' | 'recovery' | 'knowledge' = 'conversations', isCurrent: () => boolean = () => true): Promise<void> {
  if (!isCurrent()) throw new Error('账号或页面已变化，已取消导出。');
  // Local-only browser download; nothing is uploaded to a server.
  const url = URL.createObjectURL(new Blob([text], { type: format === 'json' ? 'application/json' : 'text/markdown' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `nova-${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}.${format}`;
  let clicked = false;
  try {
    document.body.appendChild(anchor);
    if (!isCurrent()) throw new Error('账号或页面已变化，已取消导出。');
    anchor.click(); clicked = true;
  } finally {
    anchor.remove();
    if (clicked) setTimeout(() => URL.revokeObjectURL(url), 60_000); else URL.revokeObjectURL(url);
  }
}
