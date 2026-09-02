#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const root = path.resolve(args.get('--dir') ?? 'artifacts');
const port = Number(args.get('--port') ?? '8090');
const token = args.get('--token') ?? '';
const allowedExtensions = new Set(['.apk', '.aab', '.ipa', '.zip']);

if (!token || token.length < 32) throw new Error('A strong --token is required.');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid --port.');

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character]);
}

function authorized(request, url) {
  const bearer = request.headers.authorization?.startsWith('Bearer ')
    ? request.headers.authorization.slice(7)
    : '';
  return bearer === token || url.searchParams.get('token') === token;
}

async function availableFiles(directory = root, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const absolute = path.join(directory, entry.name);
    const nextRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await availableFiles(absolute, nextRelative));
    if (entry.isFile() && allowedExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(nextRelative.split(path.sep).join('/'));
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function sendText(response, status, text, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  response.end(text);
}

function parseByteRange(header, size) {
  if (!header) return undefined;
  if (typeof header !== 'string' || header.includes(',')) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return null;

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/healthz') {
      sendText(response, 200, 'ok');
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method ?? '') || !authorized(request, url)) {
      sendText(response, 404, 'Not found');
      return;
    }
    if (url.pathname === '/') {
      const files = await availableFiles();
      const items = files.map((file) => {
        const href = `/download/${file.split('/').map(encodeURIComponent).join('/')}?token=${encodeURIComponent(token)}`;
        return `<li><a href="${href}" rel="noreferrer">${escapeHtml(file)}</a></li>`;
      }).join('');
      sendText(response, 200, `<!doctype html><meta name="viewport" content="width=device-width"><title>Nova Chat Builds</title><style>body{font:16px system-ui;max-width:760px;margin:40px auto;padding:0 20px;background:#0e0f13;color:#f4f4f5}a{color:#7ca7ff}li{margin:16px 0}.note{color:#a1a1aa}</style><h1>Nova Chat 安装包</h1><p class="note">此临时下载地址包含访问令牌，请勿转发；下载完成后请运行停止脚本。</p><ul>${items || '<li>暂无可下载构建</li>'}</ul>`, 'text/html; charset=utf-8');
      return;
    }
    if (!url.pathname.startsWith('/download/')) {
      sendText(response, 404, 'Not found');
      return;
    }
    const requested = decodeURIComponent(url.pathname.slice('/download/'.length));
    const absolute = path.resolve(root, requested);
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !allowedExtensions.has(path.extname(absolute).toLowerCase())) {
      sendText(response, 404, 'Not found');
      return;
    }
    const details = await stat(absolute);
    if (!details.isFile()) {
      sendText(response, 404, 'Not found');
      return;
    }
    const range = parseByteRange(request.headers.range, details.size);
    if (range === null) {
      response.writeHead(416, {
        'content-range': `bytes */${details.size}`,
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      response.end();
      return;
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? details.size - 1;
    const partial = range !== undefined;
    response.writeHead(partial ? 206 : 200, {
      'content-type': 'application/octet-stream',
      'content-length': String(end - start + 1),
      ...(partial ? { 'content-range': `bytes ${start}-${end}/${details.size}` } : {}),
      'accept-ranges': 'bytes',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(absolute))}`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(absolute, { start, end }).pipe(response);
  } catch {
    if (!response.headersSent) sendText(response, 404, 'Not found');
    else response.destroy();
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Nova build server listening on http://127.0.0.1:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
