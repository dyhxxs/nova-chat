import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function validateReleaseMetadata({ rootPackage, mobilePackage, gatewayPackage, protocolPackage, appConfig, lockfile }) {
  const version = rootPackage.version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Release requires a stable numeric version.');
  const packages = { '': rootPackage, 'apps/mobile': mobilePackage, 'services/gateway': gatewayPackage, 'packages/protocol': protocolPackage };
  for (const [location, manifest] of Object.entries(packages)) {
    if (manifest.version !== version || lockfile.packages?.[location]?.version !== version) throw new Error('Version mismatch: ' + (location || 'root'));
    if (location === 'apps/mobile' || location === 'services/gateway') {
      if (manifest.dependencies?.['@nova-chat/protocol'] !== version || lockfile.packages?.[location]?.dependencies?.['@nova-chat/protocol'] !== version) throw new Error('Protocol dependency mismatch: ' + location);
    }
  }
  if (lockfile.version !== version || appConfig.expo?.version !== version) throw new Error('App or lockfile version mismatch.');
  const expo = appConfig.expo;
  if (expo.name !== 'Nova Chat' || expo.android?.package !== 'com.novachat.mobile' || expo.ios?.bundleIdentifier !== 'com.novachat.mobile') throw new Error('Friend releases must use the normal app identity, not an isolated QA package.');
  if (!Number.isSafeInteger(expo.android.versionCode) || expo.android.versionCode < 1 || !/^[1-9]\d*$/.test(expo.ios.buildNumber)) throw new Error('Invalid native build number.');
  if (expo.android.allowBackup !== false) throw new Error('Account data must not be included in automatic Android backups.');
  return { version, androidVersionCode: expo.android.versionCode, iosBuildNumber: expo.ios.buildNumber, package: expo.android.package };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  try {
    const names = { rootPackage: 'package.json', mobilePackage: 'apps/mobile/package.json', gatewayPackage: 'services/gateway/package.json', protocolPackage: 'packages/protocol/package.json', appConfig: 'apps/mobile/app.json', lockfile: 'package-lock.json' };
    const inputs = Object.fromEntries(await Promise.all(Object.entries(names).map(async ([key, file]) => [key, JSON.parse(await readFile(path.join(root, file), 'utf8'))])));
    console.log(JSON.stringify(validateReleaseMetadata(inputs), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
