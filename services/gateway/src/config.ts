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
  DATA_DIR: z.string().default('./data'),
  SERVER_MASTER_KEY: z.string().default(''),
  ADMIN_BOOTSTRAP_TOKEN: z.string().default(''),
  ADMIN_EMAIL: z.string().trim().email().default('admin@qq.com'),
  ADMIN_PASSWORD: z.string().max(200).default(''),
  ADMIN_DISPLAY_NAME: z.string().trim().min(1).max(80).default('管理员'),
  ADMIN_AUTO_CREATE: booleanFromEnv(false),
  REGISTRATION_ENABLED: booleanFromEnv(true),
  SESSION_DAYS: numberFromEnv(30),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  OPENAI_MODEL: z.string().min(1).default(DEFAULT_MODEL_ID),
  ALLOWED_MODELS: z.string().default(''),
  PROVIDER_API_MODE: z.enum(['responses', 'chat-completions']).default('responses'),
  PROVIDER_AUTH_MODE: z.enum(['bearer', 'api-key', 'none']).default('bearer'),
  APP_ACCESS_TOKEN: z.string().default(''),
  CORS_ORIGINS: z.string().default('*'),
  REQUESTS_PER_MINUTE: numberFromEnv(20),
  MAX_CONCURRENT_PER_DEVICE: numberFromEnv(2),
  MAX_CONCURRENT_IMAGE_REQUESTS: numberFromEnv(100),
  IMAGE_CONCURRENCY_RETRY_COUNT: nonNegativeNumberFromEnv(2),
  IMAGE_CONCURRENCY_RETRY_BASE_MS: nonNegativeNumberFromEnv(5_000),
  IMAGE_CONCURRENCY_RETRY_MAX_MS: numberFromEnv(20_000),
  MAX_HISTORY_CHARS: numberFromEnv(600_000),
  MAX_HISTORY_MESSAGES: numberFromEnv(DEFAULT_CONTEXT_MESSAGES),
  MAX_OUTPUT_TOKENS: numberFromEnv(32_768),
  MAX_FILE_BYTES: numberFromEnv(25 * 1024 * 1024),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = configSchema.parse(env);
  if (config.NODE_ENV !== 'test' && config.ADMIN_AUTO_CREATE && config.ADMIN_PASSWORD.length < 8) {
    throw new Error('ADMIN_PASSWORD must contain at least 8 characters when ADMIN_AUTO_CREATE is enabled');
  }
  const masterKey = config.SERVER_MASTER_KEY || config.APP_ACCESS_TOKEN || (config.NODE_ENV === 'test' ? 'test-master-key-not-for-production' : '');
  if (config.NODE_ENV === 'production' && masterKey.length < 32) {
    throw new Error('SERVER_MASTER_KEY must contain at least 32 characters in production');
  }
  if (config.NODE_ENV === 'production' && config.ADMIN_BOOTSTRAP_TOKEN.length < 24) {
    throw new Error('ADMIN_BOOTSTRAP_TOKEN must contain at least 24 characters in production');
  }
  return {
    nodeEnv: config.NODE_ENV,
    host: config.HOST,
    port: config.PORT,
    logLevel: config.LOG_LEVEL,
    dataDir: path.resolve(config.DATA_DIR),
    serverMasterKey: masterKey,
    adminBootstrapToken: config.ADMIN_BOOTSTRAP_TOKEN,
    adminEmail: config.ADMIN_EMAIL,
    adminPassword: config.ADMIN_PASSWORD,
    adminDisplayName: config.ADMIN_DISPLAY_NAME,
    adminAutoCreate: config.ADMIN_AUTO_CREATE,
    registrationEnabled: config.REGISTRATION_ENABLED,
    sessionDays: config.SESSION_DAYS,
    openAIKey: config.OPENAI_API_KEY,
    openAIBaseUrl: config.OPENAI_BASE_URL.replace(/\/$/, ''),
    defaultModel: config.OPENAI_MODEL,
    allowedModels: (config.ALLOWED_MODELS || config.OPENAI_MODEL).split(',').map((model) => model.trim()).filter(Boolean),
    apiMode: config.PROVIDER_API_MODE,
    providerAuthMode: config.PROVIDER_AUTH_MODE,
    appAccessToken: config.APP_ACCESS_TOKEN,
    corsOrigins: config.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
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
  } as const;
}
