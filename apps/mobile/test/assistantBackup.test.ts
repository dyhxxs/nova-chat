import { describe, expect, it } from 'vitest';
import { parseAssistantBackup, previewAssistantImport, serializeAssistantBackup, mergeAssistantBackup } from '../src/lib/assistantBackup';
import { serializeConversationBackup } from '../src/lib/conversationBackup';
import { restoreLocalRecords } from '../src/lib/localSnapshot';
import type { AssistantPreset } from '../src/lib/assistantPresets';
const preset: AssistantPreset = { id: 'original-id', name: '写作', description: '说明', instructions: '私有指令', starter: '私有开场草稿', updatedAt: 1 };
const backup = () => parseAssistantBackup(serializeAssistantBackup([preset]));

describe('independent assistant backup format', () => {
  it('round-trips private instructions but explicitly excludes credentials and unrelated state', () => {
    const input = { ...preset, token: 'NEVER-token', userId: 'NEVER-user', serverUrl: 'NEVER-gateway', conversations: ['NEVER-chat'], draft: 'NEVER-draft', apiKey: 'NEVER-key' };
    const json = serializeAssistantBackup([input]); expect(json).not.toContain('NEVER');
    expect(parseAssistantBackup(json).presets[0]).toMatchObject({ instructions: preset.instructions, starter: preset.starter, sourceId: preset.id });
    expect(json).not.toContain('importSourceId');
  });
  it('does not weaken the existing promise that conversation backups exclude assistants and drafts', () => {
    const json = serializeConversationBackup([{ id: 'chat', title: 'title', createdAt: 1, updatedAt: 1, messages: [], assistant: { name: 'private-name', instructions: 'private-instructions' }, draft: 'private-draft' }]);
    expect(json).not.toContain('private'); expect(() => parseAssistantBackup(json)).toThrow('对话备份');
  });
  it('accepts UTF-8 BOM and strips unrecognized fields from imports', () => {
    const value = backup(); Object.assign(value, { accessToken: 'injected' }); Object.assign(value.presets[0]!, { command: 'run-me' });
    const parsed = parseAssistantBackup(String.fromCharCode(0xfeff) + JSON.stringify(value));
    expect(JSON.stringify(parsed)).not.toContain('injected'); expect(JSON.stringify(parsed)).not.toContain('run-me');
  });
  it('rejects malformed, wrong-version, empty-instruction and oversized files', () => {
    expect(() => parseAssistantBackup('not json')).toThrow('JSON');
    expect(() => parseAssistantBackup(JSON.stringify({ ...backup(), version: 2 }))).toThrow('v1');
    const value = backup(); value.presets[0]!.instructions = '   '; expect(() => parseAssistantBackup(JSON.stringify(value))).toThrow();
    expect(() => parseAssistantBackup('字'.repeat(3_500_000))).toThrow('10 MB');
  });
  it('rejects duplicate source IDs before any import can be applied', () => {
    const value = backup(); value.presets.push({ ...value.presets[0]!, name: 'another' });
    expect(() => parseAssistantBackup(JSON.stringify(value))).toThrow('重复');
  });
  it('uses new local IDs, retains source provenance, and skips a reimport', () => {
    const result = mergeAssistantBackup([], backup());
    expect(result.presets[0]?.id).not.toBe(preset.id); expect(result.presets[0]?.importSourceId).toBe(preset.id);
    expect(mergeAssistantBackup(result.presets, backup())).toMatchObject({ imported: 0, skipped: 1 });
    expect(parseAssistantBackup(serializeAssistantBackup(result.presets)).presets[0]?.sourceId).toBe(preset.id);
    expect(restoreLocalRecords([], result.presets).assistantPresets[0]?.importSourceId).toBe(preset.id);
  });
  it('does not overwrite local edits when an updated backup has the same source', () => {
    const imported = mergeAssistantBackup([], backup()).presets;
    imported[0]!.instructions = 'my local edits';
    const incoming = backup(); incoming.presets[0]!.instructions = 'remote edits';
    const result = mergeAssistantBackup(imported, incoming);
    expect(result).toMatchObject({ imported: 0, skipped: 1 }); expect(result.presets[0]?.instructions).toBe('my local edits');
  });
  it('deduplicates exact content despite differing IDs and timestamps, but keeps same-name different methods', () => {
    expect(mergeAssistantBackup([{ ...preset, id: 'different-id', updatedAt: 99 }], backup()).skipped).toBe(1);
    expect(mergeAssistantBackup([{ ...preset, id: 'different-id', instructions: 'different method' }], backup()).imported).toBe(1);
  });
  it('deduplicates content within a file without mutating inputs', () => {
    const incoming = backup(); incoming.presets.push({ ...incoming.presets[0]!, sourceId: 'other' });
    const before = JSON.stringify(incoming); const existing: AssistantPreset[] = [];
    expect(mergeAssistantBackup(existing, incoming)).toMatchObject({ imported: 1, skipped: 1 });
    expect(JSON.stringify(incoming)).toBe(before); expect(existing).toEqual([]);
  });
  it('enforces the 100-template cap atomically, accounting for duplicates first', () => {
    const existing = Array.from({ length: 100 }, (_, i) => ({ ...preset, id: 'id-' + i, instructions: 'method-' + i }));
    expect(() => previewAssistantImport(existing, backup())).toThrow('100'); expect(existing).toHaveLength(100);
    expect(previewAssistantImport([...existing.slice(0, 99), preset], backup())).toMatchObject({ imported: 0, skipped: 1 });
  });
});
