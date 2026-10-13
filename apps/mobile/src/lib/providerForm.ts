import { DEFAULT_MODEL_ID } from '@nova-chat/protocol';
import type { ProviderAdminSettings, ProviderTestInput } from '../services/gatewayApiClient';

export type ProviderForm = {
  apiBaseUrl: string;
  apiKey: string;
  apiBaseUrlSet: boolean;
  apiKeySet: boolean;
  apiMode: 'responses' | 'chat-completions';
  authMode: 'bearer' | 'api-key' | 'none';
  defaultModel: string;
  allowedModels: string;
};

export const emptyProviderForm: ProviderForm = {
  apiBaseUrl: '', apiKey: '', apiBaseUrlSet: false, apiKeySet: false,
  apiMode: 'responses', authMode: 'bearer',
  defaultModel: DEFAULT_MODEL_ID, allowedModels: DEFAULT_MODEL_ID,
};

export function providerFormFrom(settings: ProviderAdminSettings): ProviderForm {
  // Explicit allowlist: never spread a server-owned object containing old secret fields into state.
  return {
    apiBaseUrl: '', apiKey: '', apiBaseUrlSet: settings.apiBaseUrlSet, apiKeySet: settings.apiKeySet,
    apiMode: settings.apiMode, authMode: settings.authMode, defaultModel: settings.defaultModel,
    allowedModels: settings.allowedModels.join(', '),
  };
}

export function providerFormInput(form: ProviderForm): ProviderTestInput {
  const apiBaseUrl = form.apiBaseUrl.trim();
  const apiKey = form.apiKey.trim();
  const defaultModel = form.defaultModel.trim();
  const allowedModels = form.allowedModels.split(',').map((item) => item.trim()).filter(Boolean);
  return {
    ...(apiBaseUrl ? { apiBaseUrl } : {}), ...(apiKey ? { apiKey } : {}),
    apiMode: form.apiMode, authMode: form.authMode, defaultModel,
    allowedModels: allowedModels.length ? allowedModels : [defaultModel],
  };
}
