#!/usr/bin/env node
// `npm start`: serves the app on one port and opens the browser. There is no server-side analysis any more: the
// browser runs Stockfish (WASM) itself, this only serves static files. Builds the client first when its sources
// changed since the last build (client/dist), then runs `vite preview` (with the cross-origin isolation headers).
//   PORT (default 5174), --no-open (don't open a browser).
// If Chess Coach is already running on the port, it only opens the browser again.
// Any static web server works for client/dist too (see README "Hosting").

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
  // Is something already listening on the port? 'coach' = a running Chess Coach (it serves the engine files),
  // 'other' = another program.
  try {
    const res = await fetch(`${url}/engine/stockfish-19-single.js`, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
    return res.ok ? 'coach' : 'other';
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

const sources = [join(client, 'src'), join(client, 'index.html'), join(client, 'vite.config.ts'), join(client, 'package.json'), join(repo, 'shared', 'src'), join(repo, 'core', 'src'), join(repo, 'core', 'data')];
const stale = !existsSync(distIndex) || !existsSync(join(client, 'dist', 'engine')) || newestMtime(sources) > statSync(distIndex).mtimeMs;
if (stale) {
  console.log('[start] building the app (vite build) …');
  const r = spawnSync('npx vite build --logLevel warn', { cwd: client, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error('[start] build failed');
    process.exit(r.status ?? 1);
  }
} else {
  console.log('[start] build is up to date');
}

const server = spawn(`npx vite preview --port ${port} --strictPort`, { cwd: client, stdio: ['inherit', 'pipe', 'inherit'], shell: true, env: { ...process.env, PORT: String(port) } });
let opened = noOpen;
server.stdout.setEncoding('utf8');
server.stdout.on('data', (chunk) => {
  if (!opened && /localhost:\d+/.test(chunk)) {
    opened = true;
    console.log(`[start] Chess Coach is running — open ${url} (keep this window open; Ctrl+C stops it)`);
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
