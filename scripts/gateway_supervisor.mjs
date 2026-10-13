// Keeps only the local gateway alive. Public-domain/tunnel availability is separate.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cwd = path.join(root, 'services', 'gateway');
const entry = path.join(cwd, 'dist', 'index.js');
if (!existsSync(entry)) throw new Error('Run npm run build before starting the gateway supervisor.');
mkdirSync(path.join(root, '.run'), { recursive: true });
const statePath = path.join(root, '.run', 'gateway-supervisor.json');
let child;
let stopping = false;
let timer;
let failures = 0;
function start() {
  if (stopping) return;
  const started = Date.now();
  child = spawn(process.execPath, [entry], { cwd, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });
  writeFileSync(statePath, JSON.stringify({ supervisorPid: process.pid, gatewayPid: child.pid, startedAt: new Date().toISOString() }, null, 2));
  child.once('error', (error) => console.error('Gateway launch failed:', error.message));
  child.once('close', (code) => {
    if (stopping) return;
    failures = Date.now() - started > 60_000 ? 0 : failures + 1;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures, 5));
    console.error(`Gateway exited (${code}); restarting in ${delay} ms.`);
    timer = setTimeout(start, delay);
  });
}
function stop() {
  stopping = true;
  clearTimeout(timer);
  if (child && child.exitCode === null) child.kill();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
start();
