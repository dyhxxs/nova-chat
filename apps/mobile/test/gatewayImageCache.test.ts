import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFs = vi.hoisted(() => ({
  directories: new Set<string>(),
  files: new Map<string, number>(),
  downloadFileAsync: vi.fn(),
}));

vi.mock('expo-file-system', () => {
  const uriFor = (parts: unknown[]) => {
    const values = parts.map((part) => (typeof part === 'string' ? part : (part as { uri: string }).uri));
    const [first = '', ...rest] = values;
    return [first.replace(/\/+$/, ''), ...rest.map((part) => part.replace(/^\/+|\/+$/g, ''))].join('/');
  };

  class Directory {
    readonly uri: string;
    constructor(...parts: unknown[]) { this.uri = uriFor(parts); }
    get exists() { return mockFs.directories.has(this.uri); }
    create() { mockFs.directories.add(this.uri); }
  }

  class File {
    readonly uri: string;
    constructor(...parts: unknown[]) { this.uri = uriFor(parts); }
    get exists() { return mockFs.files.has(this.uri); }
    get size() { return mockFs.files.get(this.uri) ?? 0; }
    delete() { mockFs.files.delete(this.uri); }
    static downloadFileAsync = mockFs.downloadFileAsync;
  }

  return { Directory, File, Paths: { cache: { uri: 'file:///cache' } } };
});

import { gatewayImageRequest, loadGatewayImage } from '../src/services/gatewayImageCache';

const attachment = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  mimeType: 'image/jpeg',
  size: 700,
};

describe('gateway image cache', () => {
  beforeEach(() => {
    mockFs.directories.clear();
    mockFs.files.clear();
    mockFs.downloadFileAsync.mockReset();
    mockFs.downloadFileAsync.mockImplementation(async (_url: string, destination: { uri: string }) => {
      mockFs.files.set(destination.uri, attachment.size);
      return destination;
    });
  });

  it('keeps the session token in an authorization header instead of the image URL', () => {
    const request = gatewayImageRequest('http://192.168.0.113:8787', 'session-secret', attachment);
    expect(request.url).toBe(`http://192.168.0.113:8787/v1/files/${attachment.id}`);
    expect(request.url).not.toContain('session-secret');
    expect(request.headers).toEqual({ authorization: 'Bearer session-secret' });
    expect(request.cacheFileName).toMatch(/^[a-f0-9]{8}-123e4567-e89b-12d3-a456-426614174000\.jpg$/);
  });

  it('downloads through the authenticated native file API and reuses a complete cache file', async () => {
    const firstUri = await loadGatewayImage('http://192.168.0.113:8787', 'session-secret', attachment);
    const secondUri = await loadGatewayImage('http://192.168.0.113:8787', 'session-secret', attachment);

    expect(firstUri).toBe(secondUri);
    expect(firstUri).toMatch(/^file:\/\/\/cache\/nova-chat-images\//);
    expect(mockFs.downloadFileAsync).toHaveBeenCalledTimes(1);
    expect(mockFs.downloadFileAsync).toHaveBeenCalledWith(
      `http://192.168.0.113:8787/v1/files/${attachment.id}`,
      expect.objectContaining({ uri: firstUri }),
      expect.objectContaining({
        headers: { authorization: 'Bearer session-secret' },
        idempotent: true,
      }),
    );
  });

  it('supports avatar files without a server-provided size', async () => {
    const avatar = {
      id: '123e4567-e89b-12d3-a456-426614174002',
      mimeType: 'image/jpeg',
    };
    const firstUri = await loadGatewayImage('http://192.168.0.113:8787', 'session-secret', avatar);
    const secondUri = await loadGatewayImage('http://192.168.0.113:8787', 'session-secret', avatar);

    expect(firstUri).toBe(secondUri);
    expect(firstUri).toMatch(/^file:\/\/\/cache\/nova-chat-images\//);
    expect(mockFs.downloadFileAsync).toHaveBeenCalledTimes(1);
  });

  it('deletes an incomplete native download instead of rendering a corrupt image', async () => {
    mockFs.downloadFileAsync.mockImplementationOnce(async (_url: string, destination: { uri: string }) => {
      mockFs.files.set(destination.uri, 12);
      return destination;
    });

    await expect(loadGatewayImage('http://192.168.0.113:8787', 'session-secret', {
      ...attachment,
      id: '123e4567-e89b-12d3-a456-426614174001',
    })).rejects.toThrow('图片下载不完整');
    expect([...mockFs.files.keys()]).toHaveLength(0);
  });
});
