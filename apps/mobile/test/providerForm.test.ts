import { describe, expect, it } from 'vitest';
import { emptyProviderForm, providerFormFrom, providerFormInput } from '../src/lib/providerForm';

const summary = { apiBaseUrlSet: true, apiKeySet: true, apiMode: 'responses' as const, authMode: 'bearer' as const, defaultModel: 'model-a', allowedModels: ['model-a'] };
describe('write-only provider form', () => {
  it('starts without a built-in provider URL or saved secret', () => {
    expect(emptyProviderForm.apiBaseUrl).toBe(''); expect(emptyProviderForm.apiKey).toBe('');
  });
  it('discards every sensitive response field, including legacy URL and key previews', () => {
    const result = providerFormFrom({ ...summary, apiBaseUrl: 'https://private.example/v1', apiKey: 'secret', apiKeyPreview: 'tail' } as typeof summary);
    expect(result).toMatchObject({ apiBaseUrl: '', apiKey: '', apiBaseUrlSet: true, apiKeySet: true });
    for (const text of ['private.example', 'secret', 'tail', 'apiKeyPreview']) expect(JSON.stringify(result)).not.toContain(text);
  });
  it('omits blank credentials so saved settings remain usable for save and test', () => {
    const input = providerFormInput({ ...providerFormFrom(summary), apiBaseUrl: ' ', apiKey: ' ' });
    expect(input).not.toHaveProperty('apiBaseUrl'); expect(input).not.toHaveProperty('apiKey');
    expect(input).toMatchObject({ defaultModel: 'model-a', allowedModels: ['model-a'] });
  });
  it('sends explicit replacements only as write input', () => {
    const input = providerFormInput({ ...providerFormFrom(summary), apiBaseUrl: ' https://replacement.example/v1 ', apiKey: ' new-key ', allowedModels: ' ' });
    expect(input).toMatchObject({ apiBaseUrl: 'https://replacement.example/v1', apiKey: 'new-key', allowedModels: ['model-a'] });
    expect(input).not.toHaveProperty('apiKeySet'); expect(input).not.toHaveProperty('apiBaseUrlSet');
  });
});
