#!/usr/bin/env node
// `npm start`: the whole app on one port — builds the client (only when its sources changed since the last build),
// then runs the server with SERVE_CLIENT=1 so Express serves client/dist next to /api, and opens the browser.
//   PORT (default 5174), --no-open (don't open a browser); every server env (ENGINE_THREADS, ...) is passed through.
// Without Stockfish the server still starts and prints how to install it (`npm run setup:engine`).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const client = join(repo, 'client');
const distIndex = join(client, 'dist', 'index.html');
const port = Number(process.env.PORT ?? 5174);
const url = `http://localhost:${port}`;

function newestMtime(paths) {
  let newest = 0;
  const visit = (p) => {
    if (!existsSync(p)) return;
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const n of readdirSync(p)) if (n !== 'node_modules' && n !== 'dist') visit(join(p, n));
    } else newest = Math.max(newest, st.mtimeMs);
  };
  paths.forEach(visit);
  return newest;
}

const sources = [join(client, 'src'), join(client, 'index.html'), join(client, 'vite.config.ts'), join(client, 'package.json'), join(repo, 'shared', 'src')];
const stale = !existsSync(distIndex) || newestMtime(sources) > statSync(distIndex).mtimeMs;
if (stale) {
  console.log('[start] building the client (vite build) …');
  const r = spawnSync('npx vite build --logLevel warn', { cwd: client, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error('[start] client build failed');
    process.exit(r.status ?? 1);
  }
} else {
  console.log('[start] client build is up to date');
}

const server = spawn(process.execPath, ['--import', 'tsx', join('src', 'index.ts')], {
  cwd: join(repo, 'server'),
  stdio: ['inherit', 'pipe', 'inherit'],
  env: { ...process.env, SERVE_CLIENT: '1', PORT: String(port) },
});
let opened = process.argv.includes('--no-open') || process.env.NO_OPEN === '1';
server.stdout.setEncoding('utf8');
server.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  if (!opened && chunk.includes('Chess Coach is running')) {
    opened = true;
    openBrowser(url);
  }
});
server.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig));

function openBrowser(u) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', u]] : process.platform === 'darwin' ? ['open', [u]] : ['xdg-open', [u]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref();
  } catch {
    // no browser: the URL is printed above
  }
}
