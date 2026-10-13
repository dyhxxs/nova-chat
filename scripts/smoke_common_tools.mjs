// Live, keyless integration smoke test. --provider also makes three small billable model requests
// using the gateway's existing administrator configuration; no credentials are printed.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parse } from 'dotenv';
import { generateRequestSchema } from '@nova-chat/protocol';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../services/gateway/dist/config.js';
import { ToolRuntime } from '../services/gateway/dist/tools/index.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const gatewayDir = path.join(root, 'services', 'gateway');
process.chdir(gatewayDir);
let savedEnv = {};
try { savedEnv = parse(await readFile(path.join(gatewayDir, '.env'))); } catch { /* Keyless smoke works without a .env. */ }
const config = loadConfig({ ...savedEnv, ...process.env });
const makeRequest = (content) => generateRequestSchema.parse({ requestId: randomUUID(), conversationId: randomUUID(), deviceId: 'common-tools-smoke-test', messages: [{ role: 'user', content }], options: { reasoningEffort: 'low', maxOutputTokens: 2048 }, context: { timezone: 'Asia/Shanghai' } });
const report = { testedAt: new Date().toISOString(), tools: [], model: [] };
for (const [name, args] of [
  ['get_current_time', { timezone: 'Asia/Shanghai' }], ['get_weather', { location: '长沙', days: 7 }],
  ['calculate', { expression: '(128+36)*2' }], ['convert_units', { value: 2, from: 'kg', to: '斤' }],
  ['date_calculate', { date: '2026-09-09', endDate: '2026-10-01' }],
  ['get_exchange_rate', { from: 'USD', to: 'CNY', amount: 100 }], ['search_web', { query: 'Open-Meteo' }],
  ['read_webpage', { url: 'https://example.com/' }],
]) {
  const runtime = new ToolRuntime(config, makeRequest('验证常用工具'), AbortSignal.timeout(30_000));
  const result = await runtime.execute({ id: name, name, arguments: JSON.stringify(args) });
  const relevant = name !== 'search_web' || result.data?.results?.some((item) => /^https:\/\/(?:www\.)?open-meteo\.com(?:\/|$)/i.test(item.url));
  if (result.ok && !relevant) { result.ok = false; result.error = { code: 'irrelevant_search_results', message: 'Expected official Open-Meteo result, but the search results did not match the query.' }; }
  report.tools.push({ name, ...result });
  console.log(JSON.stringify({ tool: name, ok: result.ok, data: name === 'read_webpage' ? result.data?.text?.slice(0, 150) : name === 'get_weather' ? { location: result.data?.location, current: result.data?.current, source: result.data?.source?.name } : result.data, error: result.error }));
}
if (process.argv.includes('--provider')) {
  const { AppDatabase } = await import('../services/gateway/dist/database.js');
  const { ModelProvider } = await import('../services/gateway/dist/provider.js');
  const database = new AppDatabase(config);
  try {
    const provider = new ModelProvider(config, database);
    for (const content of ['现在是几月几号星期几？北京时间几点？简短回答。', '长沙天气怎么样？明天需要带伞吗？请说明数据时间和来源。', '帮我计算 (128+36)*2，再将2公斤换算成斤。']) {
      const startedAt = Date.now();
      try {
        const result = await provider.generate(makeRequest(content), { id: 'common-tools-smoke-test' }, AbortSignal.timeout(120_000), () => undefined);
        const item = { prompt: content, ok: Boolean(result.text.trim()), durationMs: Date.now() - startedAt, ...result };
        report.model.push(item); console.log(JSON.stringify(item));
      } catch (error) {
        const item = { prompt: content, ok: false, code: error.code ?? 'smoke_failed', durationMs: Date.now() - startedAt };
        report.model.push(item); console.log(JSON.stringify(item));
      }
    }
  } finally { database.close(); }
}
const destination = path.join(root, 'artifacts', process.argv.includes('--provider') ? 'common-tools-live-provider.json' : 'common-tools-live-keyless.json');
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, JSON.stringify(report, null, 2));
if (report.tools.some((item) => !item.ok) || report.model.some((item) => !item.ok)) process.exitCode = 1;
console.log(`Smoke report: ${destination}`);
