import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 8790);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(scriptDir);
const appConfig = JSON.parse(await readFile(path.join(projectRoot, 'apps', 'mobile', 'app.json'), 'utf8'));
const appVersion = String(appConfig?.expo?.version || '').trim();
if (!appVersion) throw new Error('apps/mobile/app.json is missing expo.version');
const apkName = `NovaChat-${appVersion}-android-arm64-lan.apk`;
const apkPath = path.join(projectRoot, 'artifacts', apkName);

function text(response, status, body, contentType = 'text/plain; charset=utf-8') {
  const data = Buffer.from(body);
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(data);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.pathname === '/health') {
      return text(response, 200, JSON.stringify({ ok: true, service: 'nova-chat-lan-download' }), 'application/json; charset=utf-8');
    }
    if (url.pathname === '/') {
      const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nova Chat LAN</title><style>body{font-family:sans-serif;max-width:720px;margin:50px auto;padding:20px;line-height:1.7}a{display:inline-block;padding:14px 20px;background:#111;color:#fff;text-decoration:none;border-radius:10px}</style></head><body><h1>Nova Chat 局域网测试版</h1><p>仅限连接当前家庭局域网的设备下载。</p><a href="/' + apkName + '">下载安卓 APK</a><p>安装后打开 Nova Chat LAN，网关地址已预置。</p></body></html>';
      return text(response, 200, html, 'text/html; charset=utf-8');
    }
    if (url.pathname !== '/' + apkName || !['GET', 'HEAD'].includes(request.method || '')) {
      return text(response, 404, 'Not Found');
    }

    const fileStat = await stat(apkPath);
    const total = fileStat.size;
    const range = request.headers.range;
    const commonHeaders = {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="' + apkName + '"',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        response.writeHead(416, { ...commonHeaders, 'Content-Range': 'bytes */' + total });
        return response.end();
      }
      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : total - 1;
      if (!match[1] && match[2]) {
        const suffix = Number(match[2]);
        start = Math.max(total - suffix, 0);
        end = total - 1;
      }
      if (start < 0 || end < start || start >= total) {
        response.writeHead(416, { ...commonHeaders, 'Content-Range': 'bytes */' + total });
        return response.end();
      }
      end = Math.min(end, total - 1);
      response.writeHead(206, {
        ...commonHeaders,
        'Content-Length': end - start + 1,
        'Content-Range': 'bytes ' + start + '-' + end + '/' + total,
      });
      if (request.method === 'HEAD') return response.end();
      return createReadStream(apkPath, { start, end }).pipe(response);
    }

    response.writeHead(200, { ...commonHeaders, 'Content-Length': total });
    if (request.method === 'HEAD') return response.end();
    createReadStream(apkPath).pipe(response);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) text(response, 500, 'Internal Server Error');
    else response.destroy();
  }
});

server.listen(port, host, () => {
  console.log('Nova LAN download server listening on http://' + host + ':' + port);
});
