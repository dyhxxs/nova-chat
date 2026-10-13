// Read only the application bundle; never extract archive paths to disk.
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { validateFriendGateway } from './check_gateway.mjs';
const MAX_BUNDLE = 32 * 1024 * 1024;
const ENTRY = 'assets/index.android.bundle';
function requireBytes(value, message) { if (!value) throw new Error(message); }

export function readApkBundle(apk) {
  requireBytes(Buffer.isBuffer(apk) && apk.length >= 22 && apk.length <= 512 * 1024 * 1024, 'APK 文件大小无效。');
  let end = -1;
  for (let offset = apk.length - 22; offset >= Math.max(0, apk.length - 65557); offset--) {
    if (apk.readUInt32LE(offset) === 0x06054b50 && offset + 22 + apk.readUInt16LE(offset + 20) === apk.length) { end = offset; break; }
  }
  requireBytes(end >= 0, 'APK 缺少 ZIP 目录。');
  const count = apk.readUInt16LE(end + 10);
  const directorySize = apk.readUInt32LE(end + 12);
  const directoryStart = apk.readUInt32LE(end + 16);
  requireBytes(apk.readUInt16LE(end + 4) === 0 && apk.readUInt16LE(end + 6) === 0 && apk.readUInt16LE(end + 8) === count && count !== 0xffff, '不支持多磁盘或 ZIP64 APK。');
  const directoryEnd = directoryStart + directorySize;
  requireBytes(directoryEnd <= end && directorySize !== 0xffffffff && directoryStart !== 0xffffffff, 'APK ZIP 目录越界。');
  let cursor = directoryStart;
  let target;
  for (let index = 0; index < count; index++) {
    requireBytes(cursor + 46 <= directoryEnd && apk.readUInt32LE(cursor) === 0x02014b50, 'APK ZIP 条目无效。');
    const nameLength = apk.readUInt16LE(cursor + 28);
    const next = cursor + 46 + nameLength + apk.readUInt16LE(cursor + 30) + apk.readUInt16LE(cursor + 32);
    requireBytes(next <= directoryEnd, 'APK ZIP 条目越界。');
    const name = apk.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (name === ENTRY) {
      requireBytes(!target, 'APK 中有重复的应用代码包。');
      target = { flags: apk.readUInt16LE(cursor + 8), method: apk.readUInt16LE(cursor + 10), compressed: apk.readUInt32LE(cursor + 20), size: apk.readUInt32LE(cursor + 24), local: apk.readUInt32LE(cursor + 42) };
    }
    cursor = next;
  }
  requireBytes(cursor === directoryEnd && target, 'APK 缺少唯一的应用代码包。');
  requireBytes(!(target.flags & 1) && [0, 8].includes(target.method) && target.size > 0 && target.size <= MAX_BUNDLE && target.compressed <= MAX_BUNDLE, 'APK 应用代码包压缩格式或大小无效。');
  const local = target.local;
  requireBytes(local + 30 <= directoryStart && apk.readUInt32LE(local) === 0x04034b50, 'APK 本地条目无效。');
  const nameLength = apk.readUInt16LE(local + 26);
  const payload = local + 30 + nameLength + apk.readUInt16LE(local + 28);
  requireBytes(payload + target.compressed <= directoryStart && apk.readUInt16LE(local + 6) === target.flags && apk.readUInt16LE(local + 8) === target.method && apk.subarray(local + 30, local + 30 + nameLength).toString('utf8') === ENTRY, 'APK 本地条目与目录不一致。');
  const compressed = apk.subarray(payload, payload + target.compressed);
  const bundle = target.method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: MAX_BUNDLE });
  requireBytes(bundle.length === target.size, 'APK 应用代码包长度不一致。');
  return bundle;
}

/** A stale-build guard, not an APK signature or live-connectivity verification. */
export function checkApkGateway(apk, expectedGatewayUrl) {
  const gatewayUrl = validateFriendGateway(expectedGatewayUrl, { allowTemporary: true });
  const bundle = readApkBundle(apk);
  requireBytes(bundle.includes(Buffer.from(gatewayUrl, 'utf8')), 'APK 没有包含本次验证的网关地址，可能复用了旧构建缓存；禁止分发。');
  return { gatewayUrl, bundleBytes: bundle.length, expectedGatewayFound: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(checkApkGateway(await readFile(process.argv[2]), process.argv[3]), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : 'APK 网关检查失败。'); process.exitCode = 1; }
}
