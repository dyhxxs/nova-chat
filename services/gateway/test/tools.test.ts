import { mentionedCities } from '../src/tools/locations.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateRequestSchema } from '@nova-chat/protocol';
import { loadConfig } from '../src/config.js';
import { calculate, convertUnit, dateMath } from '../src/tools/calculator.js';
import { fetchToolText, isPublicAddress, publicUrl } from '../src/tools/http.js';
import { currentTime, ToolRuntime, toolDefinitions } from '../src/tools/index.js';

function request(content = 'hello', options = {}, history: string[] = []) {
  return generateRequestSchema.parse({ requestId: '11111111-1111-4111-8111-111111111111', conversationId: '22222222-2222-4222-8222-222222222222', deviceId: 'tool-test-device', messages: [...history, content].map((value) => ({ role: 'user', content: value })), options });
}
function runtime(content = 'hello', options = {}, history: string[] = [], signal = new AbortController().signal) {
  return new ToolRuntime(loadConfig({ NODE_ENV: 'test' }), request(content, options, history), signal);
}
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
function forecast() {
  return { timezone: 'Asia/Shanghai', utc_offset_seconds: 28800, current: { temperature_2m: 28, weather_code: 3, time: '2026-09-09T10:00' }, daily: { time: ['2026-09-09', '2026-09-10'], weather_code: [3, 61], temperature_2m_max: [30, 29], temperature_2m_min: [25, 24], precipitation_probability_max: [20, 80] } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('safe local everyday tools', () => {
  it.each([['2+3*4', 14], ['2^3^2', 512], ['-2^2', -4], ['2^-2', 0.25], ['(1+2)×4', 12], ['200*15%', 30], ['sqrt(81)+abs(-2)', 11], ['0.1+0.2', 0.3], ['1e3/2', 500]])('calculates %s', (input, expected) => expect(calculate(input)).toBe(expected));
  it.each(['process.exit()', '1/0', 'sqrt(-1)', '2 + undefined', '1;fetch("x")', '2(3)', '(', '2^9999', ' '.repeat(2), '('.repeat(40) + '1' + ')'.repeat(40)])('rejects unsafe/invalid arithmetic %s', (value) => expect(() => calculate(value)).toThrow());
  it('converts dimensions without confusing mass and length', () => {
    expect(convertUnit(2, 'kg', '斤').result).toBe(4);
    expect(convertUnit(32, '°F', '°C').result).toBeCloseTo(0);
    expect(convertUnit(1, 'mile', 'km').result).toBe(1.609344);
    expect(convertUnit(36, 'km/h', 'm/s').result).toBe(10);
    expect(() => convertUnit(2, 'kg', 'm')).toThrow();
    expect(() => convertUnit(-300, '°C', 'K')).toThrow();
  });
  it('handles leap days, negative date offsets and rejects impossible dates', () => {
    expect(dateMath('2024-02-28', 1).result).toBe('2024-02-29');
    expect(dateMath('2026-01-01', -1).result).toBe('2025-12-31');
    expect(dateMath('2026-09-09', undefined, '2026-10-01').days).toBe(22);
    expect(() => dateMath('2026-02-29', 1)).toThrow();
    expect(() => dateMath('2026-02-31', 1)).toThrow();
  });
  it('provides current time with daylight saving and never infers GPS', async () => {
    const now = new Date('2026-07-01T00:00:00Z');
    expect(currentTime('America/New_York', now).local).toContain('20:00:00');
    const tool = runtime();
    const result = await tool.execute({ id: 'time', name: 'get_current_time', arguments: '{"timezone":"Mars/Olympus"}' });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_timezone' } });
    expect(tool.instructions()).toContain('不是用户位置');
  });
  it('validates every argument and disallows unknown tools and prototype keys', async () => {
    const tool = runtime();
    for (const args of ['null', '{}', '{"expression":"1+2","cmd":"delete"}', '{broken']) {
      expect(await tool.execute({ id: 'calc', name: 'calculate', arguments: args })).toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
    }
    expect(await tool.execute({ id: 'x', name: '__proto__', arguments: '{}' })).toMatchObject({ ok: false, error: { code: 'unknown_tool' } });
    expect(await tool.execute({ id: 'x', name: 'shell', arguments: '{}' })).toMatchObject({ ok: false });
  });
  it('enforces the call budget and disabled option', async () => {
    const tool = runtime();
    for (let i = 0; i < 12; i++) expect((await tool.execute({ id: String(i), name: 'calculate', arguments: '{"expression":"1+2"}' })).ok).toBe(true);
    expect((await tool.execute({ id: '13', name: 'calculate', arguments: '{"expression":"1+2"}' })).error.code).toBe('tool_limit');
    expect((await runtime('长沙天气', { autoTools: false }).execute({ id: 'w', name: 'get_weather', arguments: '{"location":"长沙"}' })).error.code).toBe('tools_disabled');
  });
  it('creates compatible schemas for both APIs and accepts missing old-client options', () => {
    expect(runtime().enabled).toBe(true);
    expect(toolDefinitions('responses')).toHaveLength(8);
    expect(toolDefinitions('responses')[0]).toMatchObject({ type: 'function', name: 'get_current_time' });
    expect(toolDefinitions('chat-completions')[0]).toMatchObject({ type: 'function', function: { name: 'get_current_time' } });
    expect((toolDefinitions('responses')[1] as any).parameters.required).toEqual(['location']);
    expect(() => loadConfig({ NODE_ENV: 'test', DEFAULT_TIMEZONE: 'invalid' })).toThrow();
  });
});

describe('weather and search reliability', () => {
  it.each(['长沙天气怎么样', '查一下长沙明天天气', '长沙会下雨吗', 'Changsha weather'])('prefetches %s without needing upstream tools', async (content) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-09T02:10:00Z'));
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json(forecast()))); vi.stubGlobal('fetch', fetchMock);
    const tool = runtime(content); await tool.prepare();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('latitude=28.2282');
    expect(tool.results[0]?.result.data.current.temperature_2m).toBe(28);
    expect(tool.results[0]?.result.data.daily[1].precipitationProbability).toBe(80);
    await tool.execute({ id: 'again', name: 'get_weather', arguments: '{"location":"长沙","days":7}' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tool.activities.at(-1)?.status).toBe('completed');
  });
  it('follows tomorrow weather but does not use unrelated locations', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-09T02:10:00Z'));
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json(forecast()))); vi.stubGlobal('fetch', fetchMock);
    const tool = runtime('那明天呢', {}, ['长沙天气怎么样']); await tool.prepare();
    expect(tool.results[0]?.result.data.location).toBe('长沙');
    const local = runtime('今天天气怎么样', {}, ['我在看关于长沙的历史书']); await local.prepare();
    expect(local.results).toHaveLength(0);
  });
  it.each(['今天天气怎么样', '翻译“长沙天气怎么样”', '写一首长沙天气的诗', '你知道长沙吗'])('does not fetch when location/intent is absent: %s', async (content) => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await runtime(content).prepare(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('uses geocoding for an explicit new city instead of the previous city', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ results: [] })); vi.stubGlobal('fetch', fetchMock);
    const tool = runtime('株洲天气怎么样', {}, ['长沙天气怎么样']); await tool.prepare();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('geocoding');
    expect(tool.results[0]?.result.error.code).toBe('location_not_found');
  });
  it('reports ambiguous places instead of inventing the intended city', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ results: [{ name: 'Springfield', latitude: 40, longitude: -90, admin1: 'Illinois' }, { name: 'Springfield', latitude: 42, longitude: -72, admin1: 'Massachusetts' }] })));
    const result = await runtime().execute({ id: 'w', name: 'get_weather', arguments: '{"location":"Springfield"}' });
    expect(result.data.needsClarification).toBe(true);
  });
  it('marks stale, malformed and failed weather as failure, never zero degrees', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ ...forecast(), current: { temperature_2m: 28, time: '2000-01-01T00:00' } }))
      .mockResolvedValueOnce(json({ current: { temperature_2m: null } })).mockRejectedValueOnce(new Error('secret backend token must not escape'));
    vi.stubGlobal('fetch', fetchMock);
    for (const code of ['stale_weather', 'invalid_weather', 'tool_unavailable']) {
      const tool = runtime(); const result = await tool.execute({ id: 'w', name: 'get_weather', arguments: '{"location":"长沙"}' });
      expect(result).toMatchObject({ ok: false, error: { code } });
      expect(JSON.stringify(result)).not.toContain('secret');
      expect(tool.activities[0]?.status).toBe('failed');
    }
  });
  it('returns exchange date and reference price caveat with no API-key requirement', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ date: '2026-09-08', rates: { CNY: 7 } })));
    const result = await runtime().execute({ id: 'fx', name: 'get_exchange_rate', arguments: '{"from":"usd","to":"cny","amount":100}' });
    expect(result.data).toMatchObject({ result: 700, rate: 7, date: '2026-09-08' });
    expect(result.data.note).toContain('不是实时成交价');
  });
  it.each([
    ['Open-Meteo weather API', '"Open-Meteo" weather API'],
    ['"Open-Meteo" site:open-meteo.com https://open-meteo.com GPT-5.6-sol -other-term', '"Open-Meteo" site:open-meteo.com https://open-meteo.com "GPT-5.6-sol" -other-term'],
  ])('keeps compound search names intact without changing explicit search operators: %s', async (query, expected) => {
    const mock = vi.fn().mockResolvedValue(new Response('<rss><channel><item><title>Open-Meteo Weather API</title><link>https://open-meteo.com/</link><description>Free weather forecasts</description></item></channel></rss>'));
    vi.stubGlobal('fetch', mock);
    const result = await runtime().execute({ id: 'compound-search', name: 'search_web', arguments: JSON.stringify({ query }) });
    expect(result.ok).toBe(true); expect(result.data.query).toBe(query);
    expect(new URL(String(mock.mock.calls[0]?.[0])).searchParams.get('q')).toBe(expected);
    expect(result.data.results[0].url).toBe('https://open-meteo.com/');
  });
  it('retries a mixed-language named search once and discards unrelated RSS hits', async () => {
    const unrelated = '<item><title>Wuhan College</title><link>https://example.com/college</link><description>Admissions</description></item>';
    const relevant = '<item><title>Open-Meteo Weather API</title><link>https://open-meteo.com/</link><description>Weather forecasts</description></item>';
    const mock = vi.fn().mockResolvedValueOnce(new Response('<rss><channel>' + unrelated + '</channel></rss>'))
      .mockResolvedValueOnce(new Response('<rss><channel>' + unrelated + relevant + '</channel></rss>'));
    vi.stubGlobal('fetch', mock);
    const result = await runtime().execute({ id: 'mixed-search', name: 'search_web', arguments: JSON.stringify({ query: 'Open-Meteo 天气 API 官网' }) });
    expect(result).toMatchObject({ ok: true, data: { query: 'Open-Meteo 天气 API 官网', searchQuery: 'Open-Meteo', results: [{ url: 'https://open-meteo.com/' }] } });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(new URL(String(mock.mock.calls[1]?.[0])).searchParams.get('q')).toBe('"Open-Meteo"');
    expect(result.data.results).toHaveLength(1);
  });
  it('fails rather than returning unrelated sources after the single search retry', async () => {
    const mock = vi.fn().mockImplementation(() => Promise.resolve(new Response('<rss><channel><item><title>College</title><link>https://example.com/college</link></item></channel></rss>')));
    vi.stubGlobal('fetch', mock);
    const tool = runtime();
    const result = await tool.execute({ id: 'irrelevant-search', name: 'search_web', arguments: JSON.stringify({ query: 'Open-Meteo 天气 API' }) });
    expect(result).toMatchObject({ ok: false, error: { code: 'no_relevant_results' } });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(tool.activities[0]?.status).toBe('failed');
  });
  it('preserves explicit site and exclusion constraints when retrying a named search', async () => {
    const mock = vi.fn().mockResolvedValueOnce(new Response('<rss><item><title>Unrelated</title><link>https://example.com/</link></item></rss>'))
      .mockResolvedValueOnce(new Response('<rss><item><title>Open-Meteo Docs</title><link>https://open-meteo.com/en/docs</link></item></rss>'));
    vi.stubGlobal('fetch', mock);
    const result = await runtime().execute({ id: 'constrained-search', name: 'search_web', arguments: JSON.stringify({ query: 'Open-Meteo 天气 site:open-meteo.com -other-term' }) });
    expect(result.ok).toBe(true);
    expect(new URL(String(mock.mock.calls[1]?.[0])).searchParams.get('q')).toBe('"Open-Meteo" site:open-meteo.com -other-term');
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it('parses search sources and treats an HTML proxy response as a failed search', async () => {
    const mock = vi.fn().mockResolvedValueOnce(new Response('<rss><channel><item><title>测试 &amp; 信息</title><link>https://example.com/news</link><description><![CDATA[<b>摘要</b>]]></description></item></channel></rss>'))
      .mockResolvedValueOnce(new Response('<html>captcha</html>'));
    vi.stubGlobal('fetch', mock);
    const first = await runtime().execute({ id: 'search', name: 'search_web', arguments: '{"query":"今天的新闻"}' });
    expect(first.data.results[0]).toEqual({ title: '测试 & 信息', url: 'https://example.com/news', snippet: '摘要' });
    expect((await runtime().execute({ id: 'search', name: 'search_web', arguments: '{"query":"今天的新闻"}' })).error.code).toBe('search_unavailable');
  });
  it('allows only known regional search redirects and never forwards keys across hosts', async () => {
    const mock = vi.fn().mockResolvedValueOnce(new Response('', { status: 302, headers: { location: 'https://cn.bing.com/search?q=test&format=rss' } }))
      .mockResolvedValueOnce(new Response('<rss></rss>'));
    vi.stubGlobal('fetch', mock);
    expect(await fetchToolText(new URL('https://www.bing.com/search?q=test'), new AbortController().signal, { authorization: 'sensitive' })).toBe('<rss></rss>');
    expect(mock.mock.calls[1]?.[1].headers).not.toHaveProperty('authorization');
    mock.mockResolvedValueOnce(new Response('', { status: 302, headers: { location: 'https://127.0.0.1/' } }));
    await expect(fetchToolText(new URL('https://www.bing.com/search'), new AbortController().signal)).rejects.toMatchObject({ code: 'blocked_redirect' });
  });
  it('propagates cancellation rather than reporting a tool failure or starting a lookup', async () => {
    const controller = new AbortController(); controller.abort(); const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(runtime('长沙天气', {}, [], controller.signal).prepare()).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('public-page SSRF boundary', () => {
  it.each(['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.1', '172.31.1.1', '100.100.100.200', '0.0.0.0', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2002:7f00:1::', '2001:db8::1', '64:ff9b::7f00:1'])('blocks nonpublic address %s', (address) => expect(isPublicAddress(address)).toBe(false));
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('allows public IP %s', (address) => expect(isPublicAddress(address)).toBe(true));
  it.each(['file:///etc/passwd', 'http://localhost', 'http://127.1', 'http://2130706433', 'http://0x7f000001', 'http://user:pass@example.com', 'http://example.com:8787', 'http://[::ffff:127.0.0.1]', 'http://metadata.local'])('rejects dangerous URL %s', (url) => expect(() => publicUrl(url)).toThrow());
});

// Mixed everyday requests must not turn a timezone name into a second weather lookup.
it('does not treat Beijing time as a weather location', () => {
  expect(mentionedCities('长沙天气怎么样？北京时间几点？').map((city) => city.name)).toEqual(['长沙']);
  expect(mentionedCities('天气怎么样，北京时间几点？')).toEqual([]);
  expect(mentionedCities('长沙和北京的天气').map((city) => city.name)).toContain('北京');
});
