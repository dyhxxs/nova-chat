import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import process from 'node:process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const gatewayDir = path.join(projectRoot, 'services', 'gateway');
const ccSwitchDbPath = path.join(process.env.USERPROFILE ?? '', '.cc-switch', 'cc-switch.db');

function parseTomlString(config, key) {
  const match = config.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm'));
  return match?.[1]?.trim() ?? '';
}

function parseAuth(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const ccDb = new DatabaseSync(ccSwitchDbPath, { readOnly: true });
const current = ccDb.prepare(`
  SELECT id, name, settings_config, meta
  FROM providers
  WHERE app_type = 'codex' AND is_current = 1
  ORDER BY sort_index ASC
  LIMIT 1
`).get();
ccDb.close();

if (!current) throw new Error('CC Switch 中没有当前生效的 Codex 服务商。');
const settings = JSON.parse(String(current.settings_config));
const auth = parseAuth(settings.auth);
const apiKey = String(auth.OPENAI_API_KEY ?? auth.api_key ?? auth.apiKey ?? '').trim();
const configText = String(settings.config ?? '');
const apiBaseUrl = parseTomlString(configText, 'base_url').replace(/\/$/, '');
const defaultModel = parseTomlString(configText, 'model');
const wireApi = parseTomlString(configText, 'wire_api');
const apiMode = wireApi === 'chat' || wireApi === 'chat-completions' ? 'chat-completions' : 'responses';
const catalogModels = Array.isArray(settings.modelCatalog?.models)
  ? settings.modelCatalog.models.map((entry) => String(entry?.model ?? '').trim()).filter(Boolean)
  : [];
const allowedModels = [...new Set([defaultModel, ...catalogModels].filter(Boolean))];

if (!apiBaseUrl || !/^https?:\/\//i.test(apiBaseUrl)) throw new Error('CC Switch 当前服务商缺少有效的 base_url。');
if (!apiKey) throw new Error('CC Switch 当前服务商没有 OPENAI_API_KEY。');
if (!defaultModel) throw new Error('CC Switch 当前服务商没有默认模型。');

process.chdir(gatewayDir);
await import('dotenv/config');
const [{ loadConfig }, { AppDatabase }] = await Promise.all([
  import(pathToFileURL(path.join(gatewayDir, 'dist', 'config.js')).href),
  import(pathToFileURL(path.join(gatewayDir, 'dist', 'database.js')).href),
]);
const appConfig = loadConfig(process.env);
const appDb = new AppDatabase(appConfig);
const rawDb = new DatabaseSync(path.join(appConfig.dataDir, 'nova-chat.sqlite'), { readOnly: true });
const admin = rawDb.prepare("SELECT id, email FROM users WHERE role='admin' AND disabled=0 ORDER BY created_at ASC LIMIT 1").get();
rawDb.close();
if (!admin) throw new Error('Nova Chat LAN 尚未创建可用管理员。');

const saved = appDb.updateProviderSettings({
  apiBaseUrl,
  apiKey,
  apiMode,
  authMode: 'bearer',
  defaultModel,
  allowedModels,
}, String(admin.id));

console.log(JSON.stringify({
  imported: true,
  providerName: current.name,
  apiBaseUrl: saved.apiBaseUrl,
  apiMode: saved.apiMode,
  authMode: saved.authMode,
  defaultModel: saved.defaultModel,
  allowedModels: saved.allowedModels,
  apiKeySet: saved.apiKeySet,
  apiKeyPreview: saved.apiKeyPreview,
  adminEmail: admin.email,
}, null, 2));

