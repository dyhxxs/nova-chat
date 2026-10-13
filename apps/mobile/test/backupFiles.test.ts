import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ available: vi.fn(), share: vi.fn(), pick: vi.fn(), write: vi.fn(), create: vi.fn(), remove: vi.fn(), files: [] as unknown[] }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: mock.available, shareAsync: mock.share }));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: mock.pick }));
vi.mock('../src/lib/id', () => ({ createId: () => 'test-file' }));
vi.mock('expo-file-system', () => {
  class Directory {
    uri = 'file:///cache/nova-text-exports'; create() { /* fake directory */ }
    list() { return mock.files; }
  }
  class File {
    uri: string; size = 10; modificationTime = Date.now();
    constructor(first: string | Directory, name?: string) { this.uri = typeof first === 'string' ? first : first.uri + '/' + name; }
    create() { mock.create(); } write(text: string) { mock.write(text); } delete() { mock.remove(this.uri); }
    async text() { return 'picked file'; }
  }
  return { Directory, File, Paths: { cache: { uri: 'file:///cache/' } } };
});
import { pickBackupText, shareTextFile } from '../src/services/backupFiles';
import { shareTextFile as shareWeb } from '../src/services/backupFiles.web';
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); mock.available.mockResolvedValue(true); mock.share.mockResolvedValue(undefined); mock.write.mockImplementation(() => undefined); mock.files = []; });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('native private export lifecycle', () => {
  it('does not create a private file for an already stale operation', async () => {
    await expect(shareTextFile('secret', 'json', 'assistants', () => false)).rejects.toThrow('已取消');
    expect(mock.create).not.toHaveBeenCalled(); expect(mock.share).not.toHaveBeenCalled();
  });
  it('checks account authority again after the async availability probe', async () => {
    let current = true; mock.available.mockImplementationOnce(async () => { current = false; return true; });
    await expect(shareTextFile('secret', 'json', 'assistants', () => current)).rejects.toThrow('已取消');
    expect(mock.create).not.toHaveBeenCalled(); expect(mock.share).not.toHaveBeenCalled();
  });
  it('cleans a partial private file immediately when writing fails', async () => {
    mock.write.mockImplementationOnce(() => { throw new Error('disk full'); });
    await expect(shareTextFile('secret', 'json')).rejects.toThrow('disk full');
    expect(mock.remove).toHaveBeenCalledTimes(1); expect(mock.share).not.toHaveBeenCalled();
  });
  it('retains a grace period for the receiving app, then removes only the export copy', async () => {
    await shareTextFile('private instructions', 'json', 'assistants');
    expect(mock.share).toHaveBeenCalledWith(expect.stringContaining('nova-assistants-'), expect.objectContaining({ mimeType: 'application/json' }));
    expect(mock.remove).not.toHaveBeenCalled(); vi.advanceTimersByTime(3_600_000);
    expect(mock.remove).toHaveBeenCalledTimes(1); expect(mock.remove.mock.calls[0]![0]).toContain('/cache/nova-text-exports/');
  });
  it('reports unavailable sharing without writing a private export', async () => {
    mock.available.mockResolvedValueOnce(false); await expect(shareTextFile('secret', 'json')).rejects.toThrow('无法打开');
    expect(mock.create).not.toHaveBeenCalled();
  });
  it('never deletes an original document outside the picker cache', async () => {
    mock.pick.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'content://documents/original', size: 10 }] });
    expect(await pickBackupText()).toBe('picked file'); expect(mock.remove).not.toHaveBeenCalled();
  });
  it('cleans the picker cache copy even when the declared file is too large', async () => {
    mock.pick.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///cache/picked', size: 100 }] });
    await expect(pickBackupText(20)).rejects.toThrow('不能超过'); expect(mock.remove).toHaveBeenCalledWith('file:///cache/picked');
  });
});
describe('browser download cleanup', () => {
  function browser(fail = false) {
    const revoke = vi.fn(); const create = vi.fn(() => 'blob:test'); const remove = vi.fn();
    const anchor = { href: '', download: '', remove, click: vi.fn(() => { if (fail) throw new Error('download blocked'); }) };
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: vi.fn() } });
    return { create, revoke, anchor };
  }
  it('does not create blob URLs for stale authority', async () => {
    const b = browser(); await expect(shareWeb('secret', 'json', 'recovery', () => false)).rejects.toThrow('已取消'); expect(b.create).not.toHaveBeenCalled();
  });
  it('revokes URLs and removes the element after a failed click', async () => {
    const b = browser(true); await expect(shareWeb('secret', 'json')).rejects.toThrow('download blocked');
    expect(b.revoke).toHaveBeenCalledWith('blob:test'); expect(b.anchor.remove).toHaveBeenCalledOnce();
  });
  it('uses a short grace period after a successful browser download request', async () => {
    const b = browser(); await shareWeb('body', 'md'); expect(b.anchor.download).toContain('nova-conversations-');
    expect(b.revoke).not.toHaveBeenCalled(); vi.advanceTimersByTime(60_000); expect(b.revoke).toHaveBeenCalledWith('blob:test');
  });
});
