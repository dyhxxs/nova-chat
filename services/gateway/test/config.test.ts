import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('uses safe defaults', () => {
    const config = loadConfig({ OPENAI_API_KEY: 'test' });
    expect(config.defaultModel).toBe('gpt-5.6-sol');
    expect(config.apiMode).toBe('responses');
    expect(config.port).toBe(8787);
    expect(config.allowedModels).toEqual(['gpt-5.6-sol']);
    expect(config.adminAutoCreate).toBe(false);
  });
  it('rejects an auto-created admin without an explicit password', () => {
    expect(() => loadConfig({ OPENAI_API_KEY: 'test', ADMIN_AUTO_CREATE: 'true' })).toThrow(/ADMIN_PASSWORD/);
  });

  it('requires a long app token in production', () => {
    expect(() => loadConfig({ OPENAI_API_KEY: 'test', NODE_ENV: 'production', APP_ACCESS_TOKEN: 'short' })).toThrow();
  });
});
