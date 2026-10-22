import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('uses safe defaults', () => {
    const config = loadConfig({ OPENAI_API_KEY: 'test' });
    expect(config.defaultModel).toBe('gpt-5.6-sol');
    expect(config.apiMode).toBe('responses');
    expect(config.knowledgeRetrievalStrategy).toBe('lexical');
    expect(config.port).toBe(8787);
    expect(config.allowedModels).toEqual(['gpt-5.6-sol']);
    expect(config.adminAutoCreate).toBe(false);
    expect(config.maxConcurrentImageRequests).toBe(100);
    expect(config.imageConcurrencyRetryCount).toBe(2);
  });
  it('accepts the BM25 retrieval strategy as an explicit rollout setting', () => {
    expect(loadConfig({ OPENAI_API_KEY: 'test', KNOWLEDGE_RETRIEVAL_STRATEGY: 'bm25' }).knowledgeRetrievalStrategy).toBe('bm25');
  });
  it('rejects an auto-created admin without an explicit password', () => {
    expect(() => loadConfig({ OPENAI_API_KEY: 'test', ADMIN_AUTO_CREATE: 'true' })).toThrow(/ADMIN_PASSWORD/);
  });

  it('requires an explicit server master key in production', () => {
    expect(() => loadConfig({
      OPENAI_API_KEY: 'test',
      NODE_ENV: 'production',
      APP_ACCESS_TOKEN: 'legacy-shared-token-that-is-long-enough-for-old-deployments',
      ADMIN_BOOTSTRAP_TOKEN: 'test-bootstrap-token-with-more-than-24-characters',
    })).toThrow(/SERVER_MASTER_KEY.*explicitly/);
    expect(() => loadConfig({
      OPENAI_API_KEY: 'test',
      NODE_ENV: 'production',
      SERVER_MASTER_KEY: 'short',
      ADMIN_BOOTSTRAP_TOKEN: 'test-bootstrap-token-with-more-than-24-characters',
    })).toThrow(/SERVER_MASTER_KEY/);
  });

  it('requires a metrics token when production metrics are enabled', () => {
    expect(() => loadConfig({
      OPENAI_API_KEY: 'test',
      NODE_ENV: 'production',
      SERVER_MASTER_KEY: 'server-test-master-key-with-more-than-thirty-two-characters',
      ADMIN_BOOTSTRAP_TOKEN: 'test-bootstrap-token-with-more-than-24-characters',
      METRICS_ENABLED: 'true',
    })).toThrow(/METRICS_TOKEN/);
  });
});
