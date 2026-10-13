import { z } from 'zod';
import { assistantPresetSchema, type AssistantPreset } from './assistantPresets';
import { utf8Bytes } from './conversationBackup';
import { createId } from './id';

export const MAX_ASSISTANT_BACKUP_BYTES = 10 * 1024 * 1024;
const portablePreset = assistantPresetSchema.omit({ id: true, importSourceId: true }).extend({ sourceId: z.string().min(1).max(160) });
export const assistantBackupSchema = z.object({
  format: z.literal('nova-chat-assistants'), version: z.literal(1),
  exportedAt: z.number().int().min(0).max(8_640_000_000_000_000),
  presets: z.array(portablePreset).max(100),
});
export type AssistantBackup = z.infer<typeof assistantBackupSchema>;

export function serializeAssistantBackup(presets: readonly AssistantPreset[], now = Date.now()): string {
  // Separate from conversation backups: instructions and starter text are private.
  const backup = assistantBackupSchema.parse({ format: 'nova-chat-assistants', version: 1, exportedAt: now,
    presets: presets.map((item) => ({ sourceId: item.importSourceId ?? item.id, name: item.name, description: item.description,
      instructions: item.instructions, starter: item.starter, updatedAt: item.updatedAt })),
  });
  const json = JSON.stringify(backup, null, 2);
  if (utf8Bytes(json) > MAX_ASSISTANT_BACKUP_BYTES) throw new Error('助手备份超过 10 MB，请减少模板内容后重试。');
  return json;
}
export function parseAssistantBackup(json: string): AssistantBackup {
  if (json.length > MAX_ASSISTANT_BACKUP_BYTES || utf8Bytes(json) > MAX_ASSISTANT_BACKUP_BYTES) throw new Error('助手备份不能超过 10 MB。');
  let value: unknown;
  try { value = JSON.parse(json.replace(/^\uFEFF/, '')); } catch { throw new Error('文件不是有效的 JSON 助手备份。'); }
  const result = assistantBackupSchema.safeParse(value);
  if (!result.success) throw new Error('请选择 Nova v1 助手备份；对话备份不能在这里导入。');
  const seen = new Set<string>();
  for (const item of result.data.presets) {
    if (seen.has(item.sourceId)) throw new Error('备份包含重复的助手来源标识，未导入任何模板。');
    seen.add(item.sourceId);
  }
  return result.data;
}
const contentKey = (item: Pick<AssistantPreset, 'name' | 'description' | 'instructions' | 'starter'>) => JSON.stringify([item.name, item.description, item.instructions, item.starter]);
export function previewAssistantImport(existing: readonly AssistantPreset[], backup: AssistantBackup) {
  const sources = new Set(existing.flatMap((item) => [item.id, ...(item.importSourceId ? [item.importSourceId] : [])]));
  const contents = new Set(existing.map(contentKey));
  const candidates: AssistantBackup['presets'] = [];
  let skipped = 0;
  for (const item of backup.presets) {
    const key = contentKey(item);
    if (sources.has(item.sourceId) || contents.has(key)) { skipped++; continue; }
    sources.add(item.sourceId); contents.add(key); candidates.push(item);
  }
  if (existing.length + candidates.length > 100) throw new Error('导入后将超过 100 个自定义助手。请先删除不再使用的模板；本次未导入任何内容。');
  return { candidates, imported: candidates.length, skipped };
}
export function mergeAssistantBackup(existing: readonly AssistantPreset[], backup: AssistantBackup) {
  const preview = previewAssistantImport(existing, backup);
  const imported = preview.candidates.map((item): AssistantPreset => ({
    id: createId(), importSourceId: item.sourceId, name: item.name, description: item.description,
    instructions: item.instructions, starter: item.starter, updatedAt: item.updatedAt,
  }));
  return { presets: [...imported, ...existing], imported: imported.length, skipped: preview.skipped };
}
