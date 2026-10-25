#!/usr/bin/env node
// `npm start`: the whole app on one port — builds the client (only when its sources changed since the last build),
// then runs the server with SERVE_CLIENT=1 so Express serves client/dist next to /api, and opens the browser.
//   PORT (default 5174), --no-open (don't open a browser); every server env (ENGINE_THREADS, ...) is passed through.
// Without Stockfish it first runs the download (`npm run setup:engine`); if that fails the server still starts and
// prints how to install it. If Chess Coach is already running on the port, it only opens the browser again.

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

async function probe() {
  // Is something already listening on the port? 'coach' = a running Chess Coach, 'other' = another program.
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3000) });
    const body = await res.json().catch(() => null);
    return body && typeof body === 'object' && 'ok' in body ? 'coach' : 'other';
  } catch (e) {
    return e?.cause?.code === 'ECONNREFUSED' ? 'free' : e?.name === 'TimeoutError' ? 'other' : 'free';
  }
}

const noOpen = process.argv.includes('--no-open') || process.env.NO_OPEN === '1';
const portState = await probe();
if (portState === 'coach') {
  console.log(`[start] Chess Coach is already running at ${url}${noOpen ? '' : ' — opening it in your browser'}.`);
  if (!noOpen) openBrowser(url);
  process.exit(0);
}
if (portState === 'other') {
  console.error(`[start] Another program is using port ${port}. Close it, or start Chess Coach on another port:`);
  console.error('          PowerShell:       $env:PORT=5180; npm start');
  console.error('          Command Prompt:   set PORT=5180 && npm start');
  process.exit(1);
}

const enginePath = process.env.STOCKFISH_PATH || join(repo, 'engine', 'stockfish.exe');
if (!existsSync(enginePath) && !process.env.STOCKFISH_PATH) {
  console.log('[start] Stockfish is not installed yet — downloading it first (same as `npm run setup:engine`) …');
  spawnSync(process.execPath, [join(repo, 'scripts', 'setup-engine.mjs')], { cwd: repo, stdio: 'inherit' });
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

// node:sqlite prints an "experimental feature" warning on every start: noise for the user.
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', join('src', 'index.ts')], {
  cwd: join(repo, 'server'),
  stdio: ['inherit', 'pipe', 'inherit'],
  env: { ...process.env, SERVE_CLIENT: '1', PORT: String(port) },
});
let opened = noOpen;
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
