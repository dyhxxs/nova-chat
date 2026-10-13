import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { checkApkGateway, readApkBundle } from '../check_apk_gateway.mjs';
const entry = 'assets/index.android.bundle';
const gateway = 'https://gateway.example.com';
function zip(items = [{ name: entry, content: Buffer.from(`app-data\0${gateway}\0end`), method: 8 }]) {
  const localParts = [], centralParts = []; let offset = 0;
  for (const item of items) {
    const name = Buffer.from(item.name); const content = Buffer.from(item.content); const method = item.method ?? 0;
    const compressed = method === 8 ? deflateRawSync(content) : content;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(item.flags ?? 0, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(item.flags ?? 0, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(item.size ?? content.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    localParts.push(local, name, compressed); centralParts.push(central, name); offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(centralParts); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, directory, end]);
}
for (const method of [0, 8]) test(`reads a stored/deflated application bundle (${method})`, () => {
  const content = Buffer.from(`binary\0${gateway}\0text`);
  const apk = zip([{ name: 'unrelated.txt', content: 'ignore' }, { name: entry, content, method }]);
  assert.deepEqual(readApkBundle(apk), content);
  assert.deepEqual(checkApkGateway(apk, gateway), { gatewayUrl: gateway, bundleBytes: content.length, expectedGatewayFound: true });
});
test('normalizes the expected public origin', () => { assert.equal(checkApkGateway(zip(), 'HTTPS://GATEWAY.EXAMPLE.COM/').gatewayUrl, gateway); });
test('rejects a stale gateway even if the expected URL is present in another file', () => {
  const apk = zip([{ name: entry, content: 'https://old.trycloudflare.com' }, { name: 'metadata.json', content: gateway }]);
  assert.throws(() => checkApkGateway(apk, gateway), /旧构建缓存/);
});
test('rejects missing and duplicate application bundles', () => {
  assert.throws(() => readApkBundle(zip([{ name: 'other', content: gateway }])));
  assert.throws(() => readApkBundle(zip([{ name: entry, content: gateway }, { name: entry, content: gateway }])));
});
test('rejects an invalid or credential-bearing expected URL', () => {
  for (const url of ['http://gateway.example.com', 'https://user:pass@gateway.example.com', 'https://gateway.example.com?token=secret', 'https://localhost']) assert.throws(() => checkApkGateway(zip(), url));
});
test('rejects truncated and non-ZIP data', () => { for (const input of [Buffer.alloc(0), Buffer.alloc(30), zip().subarray(0, -1)]) assert.throws(() => readApkBundle(input)); });
test('rejects encryption, unsupported compression and oversized output', () => {
  for (const extra of [{ flags: 1 }, { method: 12 }, { size: 33 * 1024 * 1024 }, { size: 0 }]) assert.throws(() => readApkBundle(zip([{ name: entry, content: gateway, ...extra }])));
});
test('rejects ZIP64 and multi-disk directories', () => {
  for (const field of [4, 6, 8, 10]) { const apk = zip(); apk.writeUInt16LE(0xffff, apk.length - 22 + field); assert.throws(() => readApkBundle(apk)); }
});
test('rejects out-of-bounds directories, payloads, and local offsets', () => {
  const bounds = zip(); bounds.writeUInt32LE(0xfffffffe, bounds.length - 22 + 16); assert.throws(() => readApkBundle(bounds));
  for (const field of [20, 42]) { const apk = zip(); const central = apk.readUInt32LE(apk.length - 22 + 16); apk.writeUInt32LE(0xfffffffe, central + field); assert.throws(() => readApkBundle(apk)); }
});
test('rejects mismatched local names, flags, methods and uncompressed length', () => {
  for (const field of [6, 8, 30]) { const apk = zip(); apk[field] ^= 1; assert.throws(() => readApkBundle(apk)); }
  const apk = zip(); const central = apk.readUInt32LE(apk.length - 22 + 16); apk.writeUInt32LE(10000, central + 24); assert.throws(() => readApkBundle(apk));
});
test('does not select lookalike or traversal entry names', () => {
  for (const name of ['../assets/index.android.bundle', 'assets/index.android.bundle.bak', 'assets\\index.android.bundle']) assert.throws(() => readApkBundle(zip([{ name, content: gateway }])));
});
test('publisher clears Metro, reruns Gradle and checks the final signed APK before copying', () => {
  const script = readFileSync(new URL('../build_friend_android.ps1', import.meta.url), 'utf8');
  const initialGate = script.indexOf('$gatewayCheck = & node @checkArgs');
  const clear = script.indexOf('expo export --platform android --clear');
  const gradle = script.indexOf(':app:assembleRelease');
  const signature = script.indexOf('& $signer verify $source');
  const verify = script.indexOf("'check_apk_gateway.mjs'");
  const copy = script.indexOf('Copy-Item -LiteralPath $source');
  assert(initialGate >= 0 && initialGate < clear && clear < gradle && gradle < signature && signature < verify && verify < copy);
  assert(script.includes("'--no-daemon', '--rerun-tasks'"));
  assert(script.includes("if ($OfflineBuild) { $gradleArgs += '--offline' }"));
  assert(script.includes('& .\\gradlew.bat @gradleArgs'));
  assert(script.includes('$env:EXPO_PUBLIC_GATEWAY_URL = $verifiedGatewayUrl'));
});


test('verifies a public IP gateway in the actual app bundle', () => {
  const ip = 'https://8.8.8.8';
  assert.equal(checkApkGateway(zip([{ name: entry, content: ip }]), ip).gatewayUrl, ip);
  assert.throws(() => checkApkGateway(zip(), ip), /旧构建缓存/);
});
