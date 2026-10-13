import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
import { readPublicPage } from '../src/tools/http.js';
const lookupMock = vi.mocked(lookup);
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('DNS-pinned public web reader', () => {
  it('rejects private DNS answers including mixed public/private results before connecting', async () => {
    lookupMock.mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] as never);
    const get = vi.spyOn(https, 'get');
    await expect(readPublicPage('https://rebind.example/', new AbortController().signal)).rejects.toMatchObject({ code: 'blocked_url' });
    expect(get).not.toHaveBeenCalled();
  });
  it('pins a public DNS answer in the connection and strips executable page content', async () => {
    lookupMock.mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
    const get = vi.spyOn(https, 'get').mockImplementation((...args: any[]) => {
      const options = args[1]; const callback = args[2];
      const pinned = vi.fn(); options.lookup('rebind.example', { all: true }, pinned);
      expect(pinned).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);
      expect(options.headers).not.toHaveProperty('authorization'); expect(options.agent).toBe(false);
      const response = Readable.from([Buffer.from('<html><script>steal()</script><style>bad</style><h1>正常标题</h1><p>正文</p></html>')]);
      Object.assign(response, { statusCode: 200, headers: { 'content-type': 'text/html' } });
      queueMicrotask(() => callback(response));
      return new EventEmitter() as any;
    });
    const result = await readPublicPage('https://rebind.example/', new AbortController().signal);
    expect(result.text).toBe('正常标题 正文'); expect(get).toHaveBeenCalledTimes(1); expect(lookupMock).toHaveBeenCalledTimes(1);
  });
  it('revalidates redirects to block metadata access', async () => {
    lookupMock.mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
    vi.spyOn(https, 'get').mockImplementation((...args: any[]) => {
      const response = Readable.from([]);
      Object.assign(response, { statusCode: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } });
      queueMicrotask(() => args[2](response));
      return new EventEmitter() as any;
    });
    await expect(readPublicPage('https://public.example/', new AbortController().signal)).rejects.toMatchObject({ code: 'blocked_url' });
  });
  it('cancels even while DNS lookup is stalled', async () => {
    lookupMock.mockImplementation(() => new Promise(() => undefined));
    const controller = new AbortController();
    const pending = readPublicPage('https://slow.example/', controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
