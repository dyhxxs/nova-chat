import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
};

/**
 * Serves an Expo web export (index.html + hashed assets) from the gateway at
 * the same origin, with a single-page-app fallback so client-side routes still
 * load. API routes under /v1/ and the health endpoints are registered first and
 * take precedence over this wildcard GET route.
 */
export function registerWebStatic(app: FastifyInstance, webDir: string) {
  if (!webDir) return;
  const root = path.resolve(webDir);
  if (!existsSync(root)) return;

  const resolveInside = (relative: string): string | undefined => {
    const resolved = path.resolve(root, relative);
    return resolved === root || resolved.startsWith(root + path.sep) ? resolved : undefined;
  };

  const sendFile = (reply: FastifyReply, filePath: string) => {
    const isHtml = filePath.endsWith('index.html');
    reply.header('cache-control', isHtml ? 'no-cache' : 'public, max-age=31536000, immutable');
    reply.type(MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream');
    return reply.send(createReadStream(filePath));
  };

  app.get('/*', async (request, reply) => {
    const rawPath = request.url.split('?')[0]?.split('#')[0] ?? '/';
    const decoded = decodeURIComponent(rawPath);
    const relative = decoded === '/' ? '' : decoded.replace(/^\/+/, '');
    const filePath = resolveInside(relative);
    if (!filePath) {
      return reply.code(404).send({ error: { code: 'not_found', message: '请求的资源不存在。', retryable: false } });
    }
    if (relative && existsSync(filePath) && statSync(filePath).isFile()) return sendFile(reply, filePath);
    const index = resolveInside('index.html');
    if (index && existsSync(index)) return sendFile(reply, index);
    return reply.code(404).send({ error: { code: 'not_found', message: '网页未部署。', retryable: false } });
  });
}
