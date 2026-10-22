import { APP_VERSION_CODE_HEADER, type AppUpdate } from '@nova-chat/protocol';
import type { AppConfig } from './config.js';

export function appUpdatePolicy(config: AppConfig): AppUpdate | undefined {
  if (!config.appDownloadUrl) return undefined;
  return {
    minimumVersionCode: config.minimumAppVersionCode,
    latestVersion: config.latestAppVersion,
    latestVersionCode: config.latestAppVersionCode,
    downloadUrl: config.appDownloadUrl,
    message: '当前版本已停止维护，请更新到最新版后继续使用',
  };
}

export function requiresAppUpdate(config: AppConfig, value: unknown): boolean {
  if (config.minimumAppVersionCode === 0) return false;
  const version = typeof value === 'number' ? value
    : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : 0;
  return !Number.isSafeInteger(version) || version < config.minimumAppVersionCode;
}

export function upgradeRequiredError(config: AppConfig) {
  return {
    code: 'upgrade_required',
    // Old APKs render only this message, so include the usable download address here too.
    message: `当前版本已停止维护，请更新到 ${config.latestAppVersion} 后继续使用。\n下载最新版：${config.appDownloadUrl}`,
    retryable: false,
    details: appUpdatePolicy(config),
  };
}
export { APP_VERSION_CODE_HEADER };
