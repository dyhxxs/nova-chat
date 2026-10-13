import type { ProviderSettings } from './database.js';

export type ProviderSettingsInput = Omit<ProviderSettings, 'apiBaseUrl' | 'apiKey' | 'updatedAt'> & {
  apiBaseUrl?: string;
  apiKey?: string;
};

export class ProviderSettingsUpdateError extends Error {
  readonly code = 'provider_credentials_required';
}

/** Blank write-only fields retain the saved value, but never forward a saved key to a new URL. */
export function resolveProviderSettings(current: ProviderSettings, input: ProviderSettingsInput): ProviderSettings {
  const apiBaseUrl = (input.apiBaseUrl?.trim() || current.apiBaseUrl).replace(/\/+$/, '');
  const replacementKey = input.apiKey?.trim();
  const changedDestination = apiBaseUrl !== current.apiBaseUrl.replace(/\/+$/, '');
  if (changedDestination && current.apiKey && !replacementKey) {
    throw new ProviderSettingsUpdateError('更换第三方地址时必须同时填写新的密钥；已保存的密钥不会发送到新地址。');
  }
  return {
    apiBaseUrl,
    apiKey: replacementKey || current.apiKey,
    apiMode: input.apiMode,
    authMode: input.authMode,
    defaultModel: input.defaultModel.trim(),
    allowedModels: [...new Set([...input.allowedModels, input.defaultModel.trim()])],
  };
}
