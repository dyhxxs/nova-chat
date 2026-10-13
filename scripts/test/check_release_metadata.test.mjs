import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReleaseMetadata } from '../check_release_metadata.mjs';

function fixture() {
  const version = '1.1.15';
  const rootPackage = { version };
  const protocolPackage = { version };
  const mobilePackage = { version, dependencies: { '@nova-chat/protocol': version } };
  const gatewayPackage = structuredClone(mobilePackage);
  return { rootPackage, protocolPackage, mobilePackage, gatewayPackage,
    appConfig: { expo: { name: 'Nova Chat', version, android: { package: 'com.novachat.mobile', versionCode: 17, allowBackup: false }, ios: { bundleIdentifier: 'com.novachat.mobile', buildNumber: '17' } } },
    lockfile: { version, packages: structuredClone({ '': rootPackage, 'apps/mobile': mobilePackage, 'services/gateway': gatewayPackage, 'packages/protocol': protocolPackage }) },
  };
}

test('normal friend release metadata is consistent', () => {
  assert.deepEqual(validateReleaseMetadata(fixture()), { version: '1.1.15', androidVersionCode: 17, iosBuildNumber: '17', package: 'com.novachat.mobile' });
});
test('rejects stale workspace and lockfile versions', () => {
  for (const key of ['rootPackage', 'mobilePackage', 'gatewayPackage', 'protocolPackage', 'lockfile']) {
    const data = fixture(); data[key].version = '1.1.14'; assert.throws(() => validateReleaseMetadata(data));
  }
  for (const key of ['', 'apps/mobile', 'services/gateway', 'packages/protocol']) {
    const data = fixture(); data.lockfile.packages[key].version = '1.1.14'; assert.throws(() => validateReleaseMetadata(data));
  }
  const data = fixture(); data.appConfig.expo.version = '1.1.14'; assert.throws(() => validateReleaseMetadata(data));
});
test('rejects stale protocol dependencies', () => {
  for (const source of ['mobilePackage', 'gatewayPackage']) {
    const data = fixture(); data[source].dependencies['@nova-chat/protocol'] = '1.1.14'; assert.throws(() => validateReleaseMetadata(data), /dependency/);
  }
  for (const location of ['apps/mobile', 'services/gateway']) {
    const data = fixture(); data.lockfile.packages[location].dependencies['@nova-chat/protocol'] = '1.1.14'; assert.throws(() => validateReleaseMetadata(data), /dependency/);
  }
});
test('rejects QA identity, native version errors and enabled account backup', () => {
  for (const mutate of [
    (x) => { x.expo.android.package += '.qa.r3'; },
    (x) => { x.expo.ios.bundleIdentifier += '.qa.r3'; },
    (x) => { x.expo.name = 'Nova QA R3'; },
    (x) => { x.expo.android.versionCode = 0; },
    (x) => { x.expo.android.versionCode = 1.5; },
    (x) => { x.expo.ios.buildNumber = ''; },
    (x) => { x.expo.android.allowBackup = true; },
  ]) { const data = fixture(); mutate(data.appConfig); assert.throws(() => validateReleaseMetadata(data)); }
});
