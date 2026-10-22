import path from 'node:path';
import { z } from 'zod';
import { DEFAULT_CONTEXT_MESSAGES, DEFAULT_MODEL_ID } from '@nova-chat/protocol';

const numberFromEnv = (fallback: number) =>
  z.preprocess((value) => (value === undefined || value === '' ? fallback : Number(value)), z.number().int().positive());

const nonNegativeNumberFromEnv = (fallback: number) =>
  z.preprocess((value) => (value === undefined || value === '' ? fallback : Number(value)), z.number().int().nonnegative());

const booleanFromEnv = (fallback: boolean) => z.preprocess((value) => {
  if (value === undefined || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}, z.boolean());

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: numberFromEnv(8787),
  LOG_LEVEL: z.string().default('info'),
  TRUST_PROXY: booleanFromEnv(false),
  DATA_DIR: z.string().default('./data'),
  SERVER_MASTER_KEY: z.string().default(''),
  ADMIN_BOOTSTRAP_TOKEN: z.string().default(''),
  ADMIN_EMAIL: z.string().trim().email().default('admin@qq.com'),
  ADMIN_PASSWORD: z.string().max(200).default(''),
  ADMIN_DISPLAY_NAME: z.string().trim().min(1).max(80).default('管理员'),
  ADMIN_AUTO_CREATE: booleanFromEnv(false),
  REGISTRATION_ENABLED: booleanFromEnv(true),
  SESSION_DAYS: numberFromEnv(30),
  LOGIN_ATTEMPTS_PER_WINDOW: numberFromEnv(10),
  LOGIN_WINDOW_MS: numberFromEnv(15 * 60_000),
  VOICE_API_KEY: z.string().default(''),
  VOICE_BASE_URL: z.preprocess(value => value === '' ? undefined : value, z.string().url().optional()),
  VOICE_TTS_MODEL: z.string().default('doubao-tts-2.0'),
  VOICE_ASR_MODEL: z.string().default('gem-3.8-flash'),
  VOICE_DEFAULT_ID: z.string().default('zh_female_vv_uranus_bigtts'),
  VOICE_FEMALE_CLONE_ID: z.string().regex(/^(?:[A-Za-z0-9_.-]{1,120})?$/).default(''),
  VOICE_FEMALE_CLONE_NAME: z.string().trim().min(1).max(80).default('少女音 · 专属音色'),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  OPENAI_MODEL: z.string().min(1).default(DEFAULT_MODEL_ID),
  ALLOWED_MODELS: z.string().default(''),
  PROVIDER_API_MODE: z.enum(['responses', 'chat-completions']).default('responses'),
  PROVIDER_AUTH_MODE: z.enum(['bearer', 'api-key', 'none']).default('bearer'),
  KNOWLEDGE_RETRIEVAL_STRATEGY: z.enum(['lexical', 'bm25']).default('lexical'),
  APP_ACCESS_TOKEN: z.string().default(''),
  NOVA_MINIMUM_APP_VERSION_CODE: nonNegativeNumberFromEnv(0),
  NOVA_LATEST_APP_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/).default('1.1.31'),
  NOVA_LATEST_APP_VERSION_CODE: numberFromEnv(33),
  NOVA_APP_DOWNLOAD_URL: z.string().default(''),
  CORS_ORIGINS: z.string().default('*'),
  METRICS_ENABLED: booleanFromEnv(false),
  METRICS_TOKEN: z.string().max(4096).default(''),
  REQUESTS_PER_MINUTE: numberFromEnv(20),
  MAX_CONCURRENT_PER_DEVICE: numberFromEnv(2),
  MAX_CONCURRENT_IMAGE_REQUESTS: numberFromEnv(100),
  IMAGE_CONCURRENCY_RETRY_COUNT: nonNegativeNumberFromEnv(2),
  IMAGE_CONCURRENCY_RETRY_BASE_MS: nonNegativeNumberFromEnv(5_000),
  IMAGE_CONCURRENCY_RETRY_MAX_MS: numberFromEnv(20_000),
  MAX_HISTORY_CHARS: numberFromEnv(600_000),
  MAX_HISTORY_MESSAGES: numberFromEnv(DEFAULT_CONTEXT_MESSAGES),
  MAX_OUTPUT_TOKENS: numberFromEnv(32_768),
  BUILTIN_TOOLS_ENABLED: booleanFromEnv(true),
  DEFAULT_TIMEZONE: z.string().default('Asia/Shanghai').refine((value) => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; } catch { return false; }
  }, 'DEFAULT_TIMEZONE must be a valid IANA time zone'),
  TOOL_TIMEOUT_MS: numberFromEnv(12_000).refine((value) => value >= 100 && value <= 60_000, 'TOOL_TIMEOUT_MS must be between 100 and 60000'),
  BRAVE_SEARCH_API_KEY: z.string().default(''),
  MAX_FILE_BYTES: numberFromEnv(25 * 1024 * 1024),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = configSchema.parse(env);
  if (config.NOVA_MINIMUM_APP_VERSION_CODE > 0) {
    let downloadUrl: URL;
    try { downloadUrl = new URL(config.NOVA_APP_DOWNLOAD_URL); }
    catch { throw new Error('NOVA_APP_DOWNLOAD_URL must be an HTTPS URL when mandatory updates are enabled'); }
    if (downloadUrl.protocol !== 'https:' || downloadUrl.username || downloadUrl.password
        || config.NOVA_LATEST_APP_VERSION_CODE < config.NOVA_MINIMUM_APP_VERSION_CODE) {
      throw new Error('Mandatory update configuration requires an HTTPS download URL and a supported latest version');
    }
  }
  if (config.NODE_ENV !== 'test' && config.ADMIN_AUTO_CREATE && config.ADMIN_PASSWORD.length < 8) {
    throw new Error('ADMIN_PASSWORD must contain at least 8 characters when ADMIN_AUTO_CREATE is enabled');
  }
  if (config.NODE_ENV === 'production' && !config.SERVER_MASTER_KEY) {
    throw new Error('SERVER_MASTER_KEY must be set explicitly in production; APP_ACCESS_TOKEN cannot be used as the database encryption key');
  }
  const masterKey = config.SERVER_MASTER_KEY || config.APP_ACCESS_TOKEN || (config.NODE_ENV === 'test' ? 'test-master-key-not-for-production' : '');
  if (config.NODE_ENV === 'production' && masterKey.length < 32) {
    throw new Error('SERVER_MASTER_KEY must contain at least 32 characters in production');
  }
  if (config.NODE_ENV === 'production' && config.ADMIN_BOOTSTRAP_TOKEN.length < 24) {
    throw new Error('ADMIN_BOOTSTRAP_TOKEN must contain at least 24 characters in production');
  }
  if (config.NODE_ENV === 'production' && config.METRICS_ENABLED && config.METRICS_TOKEN.length < 24) {
    throw new Error('METRICS_TOKEN must contain at least 24 characters when metrics are enabled in production');
  }
  return {
    nodeEnv: config.NODE_ENV,
    host: config.HOST,
    port: config.PORT,
    logLevel: config.LOG_LEVEL,
    trustProxy: config.TRUST_PROXY,
    dataDir: path.resolve(config.DATA_DIR),
    serverMasterKey: masterKey,
    adminBootstrapToken: config.ADMIN_BOOTSTRAP_TOKEN,
    adminEmail: config.ADMIN_EMAIL,
    adminPassword: config.ADMIN_PASSWORD,
    adminDisplayName: config.ADMIN_DISPLAY_NAME,
    adminAutoCreate: config.ADMIN_AUTO_CREATE,
    registrationEnabled: config.REGISTRATION_ENABLED,
    sessionDays: config.SESSION_DAYS,
    loginAttemptsPerWindow: config.LOGIN_ATTEMPTS_PER_WINDOW,
    loginWindowMs: config.LOGIN_WINDOW_MS,
    openAIKey: config.OPENAI_API_KEY,
    openAIBaseUrl: config.OPENAI_BASE_URL.replace(/\/$/, ''),
    defaultModel: config.OPENAI_MODEL,
    allowedModels: (config.ALLOWED_MODELS || config.OPENAI_MODEL).split(',').map((model) => model.trim()).filter(Boolean),
    apiMode: config.PROVIDER_API_MODE,
    providerAuthMode: config.PROVIDER_AUTH_MODE,
    knowledgeRetrievalStrategy: config.KNOWLEDGE_RETRIEVAL_STRATEGY,
    appAccessToken: config.APP_ACCESS_TOKEN,
    minimumAppVersionCode: config.NOVA_MINIMUM_APP_VERSION_CODE,
    latestAppVersion: config.NOVA_LATEST_APP_VERSION,
    latestAppVersionCode: config.NOVA_LATEST_APP_VERSION_CODE,
    appDownloadUrl: config.NOVA_APP_DOWNLOAD_URL,
    corsOrigins: config.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
    metricsEnabled: config.METRICS_ENABLED,
    metricsToken: config.METRICS_TOKEN,
    requestsPerMinute: config.REQUESTS_PER_MINUTE,
    maxConcurrentPerDevice: config.MAX_CONCURRENT_PER_DEVICE,
    maxConcurrentImageRequests: config.MAX_CONCURRENT_IMAGE_REQUESTS,
    imageConcurrencyRetryCount: config.IMAGE_CONCURRENCY_RETRY_COUNT,
    imageConcurrencyRetryBaseMs: config.IMAGE_CONCURRENCY_RETRY_BASE_MS,
    imageConcurrencyRetryMaxMs: config.IMAGE_CONCURRENCY_RETRY_MAX_MS,
    maxHistoryChars: config.MAX_HISTORY_CHARS,
    maxHistoryMessages: config.MAX_HISTORY_MESSAGES,
    maxOutputTokens: config.MAX_OUTPUT_TOKENS,
    maxFileBytes: config.MAX_FILE_BYTES,
    voiceApiKey: config.VOICE_API_KEY,
    voiceBaseUrl: config.VOICE_BASE_URL,
    voiceTtsModel: config.VOICE_TTS_MODEL,
    voiceAsrModel: config.VOICE_ASR_MODEL,
    voiceDefaultId: config.VOICE_DEFAULT_ID,
    voiceFemaleCloneId: config.VOICE_FEMALE_CLONE_ID,
    voiceFemaleCloneName: config.VOICE_FEMALE_CLONE_NAME,
    builtinToolsEnabled: config.BUILTIN_TOOLS_ENABLED,
    defaultTimezone: config.DEFAULT_TIMEZONE,
    toolTimeoutMs: config.TOOL_TIMEOUT_MS,
    braveSearchApiKey: config.BRAVE_SEARCH_API_KEY,
  } as const;
}
