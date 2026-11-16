/// <reference types="vitest/config" />
import { copyFileSync, createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { type Connect, defineConfig, type Plugin } from 'vite';

// Dev server port (env CLIENT_PORT, default 5173). There is no API server: the analysis runs in the browser
// (src/worker/, Stockfish WASM).
const clientPort = Number(process.env.CLIENT_PORT ?? 5173);

/**
 * Cross-origin isolation (COOP/COEP): needed for SharedArrayBuffer, i.e. the multi-threaded Stockfish build. The
 * single-threaded build (the default) works without it; any static host that serves the app should send these
 * headers too (see README). CORP lets the isolated page load its own engine files from workers.
 */
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/** Stockfish.js builds served at /engine/ (from node_modules/stockfish/bin; copied into dist/engine/ by a build). */
export const ENGINE_FILES = [
  // full NNUE network, single-threaded (default; no cross-origin isolation needed)
  'stockfish-19-single.js',
  'stockfish-19-single.wasm',
  // full network, multi-threaded (?threads=N with cross-origin isolation)
  'stockfish-19.js',
  'stockfish-19.wasm',
  // small network (?engine=lite): ~2 MB instead of ~100 MB, weaker
  'stockfish-19-lite-single.js',
  'stockfish-19-lite-single.wasm',
];

function stockfishDir(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('stockfish/package.json')), 'bin');
}

const MIME: Record<string, string> = { '.js': 'text/javascript', '.wasm': 'application/wasm' };

function stockfishAssets(): Plugin {
  const dir = stockfishDir();
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const m = /^\/engine\/([\w.-]+)(?:[?#].*)?$/.exec(req.url ?? '');
    const file = m?.[1];
    if (!file || !ENGINE_FILES.includes(file)) return next();
    const path = join(dir, file);
    if (!existsSync(path)) return next();
    const ext = file.slice(file.lastIndexOf('.'));
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
    res.setHeader('Content-Length', String(statSync(path).size));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    for (const [k, v] of Object.entries(ISOLATION_HEADERS)) res.setHeader(k, v);
    createReadStream(path).pipe(res);
  };
  let outDir = 'dist';
  return {
    name: 'chess-coach:stockfish-assets',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use(serve);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve);
    },
    closeBundle() {
      const target = join(outDir, 'engine');
      mkdirSync(target, { recursive: true });
      for (const f of ENGINE_FILES) copyFileSync(join(dir, f), join(target, f));
      copyFileSync(join(dirname(dir), 'Copying.txt'), join(target, 'STOCKFISH-COPYING.txt'));
    },
  };
}

export default defineConfig({
  plugins: [vue(), tailwindcss(), stockfishAssets()],
  server: {
    port: clientPort,
    strictPort: true,
    headers: ISOLATION_HEADERS,
    // testing on a phone through an ngrok tunnel (`ngrok http 5173`)
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app'],
  },
  preview: {
    port: Number(process.env.PORT ?? 5174),
    strictPort: true,
    headers: ISOLATION_HEADERS,
  },
  worker: {
    format: 'es',
  },
  // scan the analysis worker's imports up front too, so the dev server doesn't discover dependencies on the first
  // analysis and reload the page
  optimizeDeps: {
    entries: ['index.html', 'src/worker/analysis.worker.ts'],
  },
  test: {
    name: 'client',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    passWithNoTests: true,
  },
});
