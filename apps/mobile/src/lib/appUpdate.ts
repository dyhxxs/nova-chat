import { create } from 'zustand';
import { APP_VERSION_HEADER, APP_VERSION_CODE_HEADER, appUpdateSchema, type AppUpdate } from '@nova-chat/protocol';
import appConfig from '../../app.json';
import { normalizeServerUrl } from './connection';

// These values are bundled with this binary; version headers must match the installed APK.
export const APP_VERSION = appConfig.expo.version;
export const APP_VERSION_CODE = appConfig.expo.android.versionCode;
export const appVersionHeaders = {
  [APP_VERSION_HEADER]: APP_VERSION,
  [APP_VERSION_CODE_HEADER]: String(APP_VERSION_CODE),
};
export const useAppUpdateStore = create<{ serverUrl: string; required?: AppUpdate }>(() => ({ serverUrl: '' }));

export function applyAppUpdate(serverUrl: string, value: unknown) {
  const parsed = appUpdateSchema.safeParse(value);
  useAppUpdateStore.setState({
    serverUrl: normalizeServerUrl(serverUrl),
    required: parsed.success && parsed.data.minimumVersionCode > APP_VERSION_CODE ? parsed.data : undefined,
  });
}

export function reportUpgradeRequired(serverUrl: string, error: { code?: unknown; details?: unknown }) {
  if (error.code === 'upgrade_required') applyAppUpdate(serverUrl, error.details);
}
