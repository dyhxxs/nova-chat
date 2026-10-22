import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestPath = path.join(repositoryRoot, 'apps', 'mobile', 'app.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const version = manifest?.expo?.version;
const versionCode = manifest?.expo?.android?.versionCode;

if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)
    || !Number.isSafeInteger(versionCode) || versionCode < 1) {
  throw new Error('apps/mobile/app.json does not contain a valid release version');
}

export const currentAppVersion = version;
export const currentAppVersionCode = versionCode;
export const currentAppVersionHeaders = Object.freeze({
  'x-nova-app-version': currentAppVersion,
  'x-nova-app-version-code': String(currentAppVersionCode),
});
