#!/usr/bin/env node
// Serves the built site (client/.output/public, `npm run build`) like the production web server does: a file, else
// <path>.html, else <path>/index.html, else 404.html with status 404; with the cross-origin isolation headers
// (COOP/COEP/CORP, needed for the multi-threaded engine). Used by `npm start` (scripts/start.mjs) and
// `npm run preview -w client`.
//   PORT (default 5174), ROOT (default client/.output/public).
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const root = normalize(process.env.ROOT ?? join(repo, 'client', '.output', 'public'));
const port = Number(process.env.PORT ?? 5174);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};
const HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const isFile = (p) => existsSync(p) && statSync(p).isFile();

function resolveFile(urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const base = normalize(join(root, rel));
  if (base !== root && !base.startsWith(root + sep)) return null; // no ../ out of the site
  for (const p of [base, `${base}.html`, join(base, 'index.html')]) if (isFile(p)) return p;
  return null;
}

if (!isFile(join(root, 'index.html'))) {
  console.error(`[serve] no built site in ${root}: run \`npm run build\` first`);
  process.exit(1);
}

createServer((req, res) => {
  const urlPath = new URL(req.url ?? '/', 'http://x').pathname;
  let file = resolveFile(urlPath);
  let status = 200;
  if (!file) {
    file = join(root, '404.html');
    status = 404;
  }
  const ext = extname(file);
  res.writeHead(status, {
    ...HEADERS,
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': String(statSync(file).size),
    // hashed build assets never change; everything else is checked again
    'Cache-Control': urlPath.startsWith('/_nuxt/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`  Local: http://localhost:${port}/`));
