import { describe, expect, it } from 'vitest';
import { emptyProviderForm, providerFormFrom, providerFormInput } from '../src/lib/providerForm';

const summary = {
  apiBaseUrl: 'https://saved.example/v1', apiBaseUrlSet: true, apiKeySet: true, apiKeyHint: 'sk-sav…2345',
  apiMode: 'responses' as const, authMode: 'bearer' as const, defaultModel: 'model-a', allowedModels: ['model-a'],
};

describe('provider form', () => {
  it('starts with empty URL, key and hint', () => {
    expect(emptyProviderForm.apiBaseUrl).toBe('');
    expect(emptyProviderForm.apiKey).toBe('');
    expect(emptyProviderForm.apiKeyHint).toBe('');
  });
  it('shows the saved URL and masked key hint, keeping the full key write-only', () => {
    const result = providerFormFrom({ ...summary, apiKeyHint: 'sk-new…abcd' });
    expect(result).toMatchObject({ apiBaseUrl: 'https://saved.example/v1', apiKey: '', apiKeyHint: 'sk-new…abcd', apiBaseUrlSet: true, apiKeySet: true });
  });
  it('omits blank credentials so saved settings remain usable for save and test', () => {
    const input = providerFormInput({ ...providerFormFrom(summary), apiBaseUrl: ' ', apiKey: ' ' });
    expect(input).not.toHaveProperty('apiBaseUrl');
    expect(input).not.toHaveProperty('apiKey');
    expect(input).toMatchObject({ defaultModel: 'model-a', allowedModels: ['model-a'] });
  });
  it('sends explicit replacements only as write input', () => {
    const input = providerFormInput({ ...providerFormFrom(summary), apiBaseUrl: ' https://replacement.example/v1 ', apiKey: ' new-key ', allowedModels: ' ' });
    expect(input).toMatchObject({ apiBaseUrl: 'https://replacement.example/v1', apiKey: 'new-key', allowedModels: ['model-a'] });
    expect(input).not.toHaveProperty('apiKeySet');
    expect(input).not.toHaveProperty('apiBaseUrlSet');
  });
});
