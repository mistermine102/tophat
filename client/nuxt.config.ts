// Nuxt config. The app itself (pages/index.vue → CoachApp.vue) only runs in the browser: the analysis is Stockfish WASM in
// Web Workers, the data lives in IndexedDB / localStorage. Nuxt prerenders the pages (`nuxt generate` → .output/public,
// a static site any web server can host) so search engines and link previews see real HTML: the home page's text and
// head tags, and the guide pages under pages/.
import { copyFileSync, createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineNuxtConfig } from 'nuxt/config';
import type { Connect, Plugin } from 'vite';
import { SITE_URL } from './src/site';

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

/** The lite network (the default, ?engine=lite): ~2 MB, single-threaded. */
const LITE_ENGINE_FILES = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm'];
/** The full NNUE network (?engine=full): ~100 MB per .wasm; single-threaded, and multi-threaded (?threads=N). */
const FULL_ENGINE_FILES = ['stockfish-19-single.js', 'stockfish-19-single.wasm', 'stockfish-19.js', 'stockfish-19.wasm'];

/** Stockfish.js builds served at /engine/ by the dev server (from node_modules/stockfish/bin). */
export const ENGINE_FILES = [...LITE_ENGINE_FILES, ...FULL_ENGINE_FILES];

/**
 * The builds a production build copies into <output>/engine/: only the lite network (the full one's 100 MB files are
 * more than many hosts accept, and nobody needs them by default), unless env FULL_ENGINE=1.
 */
export const BUILD_ENGINE_FILES = process.env.FULL_ENGINE === '1' ? ENGINE_FILES : LITE_ENGINE_FILES;

function stockfishDir(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('stockfish/package.json')), 'bin');
}

const MIME: Record<string, string> = { '.js': 'text/javascript', '.wasm': 'application/wasm' };

/** Dev server: /engine/<file> straight from node_modules/stockfish/bin. */
function stockfishDevAssets(): Plugin {
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
  return {
    name: 'chess-coach:stockfish-dev-assets',
    configureServer(server) {
      server.middlewares.use(serve);
    },
  };
}

// Dev server port (env CLIENT_PORT, default 5173; `nuxt dev --port` overrides it).
const clientPort = Number(process.env.CLIENT_PORT ?? 5173);

export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  srcDir: 'src/',
  // env NUXT_BUILD_DIR: a separate build dir per dev server (the E2E runs start two at once, playwright.config.ts)
  buildDir: process.env.NUXT_BUILD_DIR ?? '.nuxt',
  // src/layouts/ holds the game screen's layouts (plain components), not Nuxt layouts
  dir: { layouts: 'nuxt-layouts' },
  // explicit imports everywhere, like the rest of the code base
  imports: { autoImport: false },
  components: { dirs: [] },
  devtools: { enabled: false },
  telemetry: false,
  // chessground's board CSS first: style.css restyles parts of it with selectors of the same weight
  css: ['chessground/assets/chessground.base.css', 'chessground/assets/chessground.brown.css', 'chessground/assets/chessground.cburnett.css', '~/style.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      charset: 'utf-8',
      viewport: 'width=device-width, initial-scale=1',
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      meta: [{ name: 'theme-color', content: '#f6eedd' }],
    },
  },
  runtimeConfig: { public: { siteUrl: SITE_URL } },
  devServer: { port: clientPort },
  routeRules: { '/**': { headers: ISOLATION_HEADERS } },
  nitro: {
    // about.html, not about/index.html: the same URLs on any static host (and the old /about.html keeps working)
    prerender: { autoSubfolderIndex: false, crawlLinks: true, routes: ['/', '/sitemap.xml'] },
  },
  vite: {
    // with NUXT_BUILD_DIR, Vite's dependency cache goes there too (two dev servers must not share one)
    ...(process.env.NUXT_BUILD_DIR ? { cacheDir: join(process.env.NUXT_BUILD_DIR, 'vite') } : {}),
    plugins: [tailwindcss(), stockfishDevAssets()],
    server: {
      headers: ISOLATION_HEADERS,
      // testing on a phone through an ngrok tunnel (`ngrok http 5173`)
      allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app'],
    },
    // the site's base path for the engine and sound URLs (BASE_URL is the assets' /_nuxt/ under Nuxt), and the
    // analysis defaults of a dev server / build (env VITE_ANALYSIS_DEFAULTS, e.g. the E2E dev server's)
    define: {
      'import.meta.env.VITE_APP_BASE': JSON.stringify(process.env.NUXT_APP_BASE_URL ?? '/'),
      'import.meta.env.VITE_ANALYSIS_DEFAULTS': JSON.stringify(process.env.VITE_ANALYSIS_DEFAULTS ?? ''),
    },
    worker: { format: 'es' },
    // pre-bundled up front, so the dev server doesn't discover them on the first page / analysis and reload the page
    optimizeDeps: {
      include: ['chessground', 'chessops', 'chessops/attacks', 'chessops/chess', 'chessops/compat', 'chessops/fen', 'chessops/pgn', 'chessops/san', 'chessops/util'],
    },
  },
  hooks: {
    // production: copy the engine builds next to the site (<output>/engine/)
    'nitro:build:public-assets'(nitro) {
      const from = stockfishDir();
      const target = join(nitro.options.output.publicDir, 'engine');
      mkdirSync(target, { recursive: true });
      for (const f of BUILD_ENGINE_FILES) copyFileSync(join(from, f), join(target, f));
      copyFileSync(join(dirname(from), 'Copying.txt'), join(target, 'STOCKFISH-COPYING.txt'));
    },
    // the look labs (/pieces, /identity), on a dev server started with env LABS=1 only: not part of the built site,
    // and identity.css (unlayered element styles) would leak into the app's pages in dev
    'pages:extend'(pages) {
      if (process.env.NODE_ENV === 'production' || process.env.LABS !== '1') return;
      pages.push({ name: 'pieces-lab', path: '/pieces', file: '~/pieces/PiecesPage.vue' });
      pages.push({ name: 'identity-lab', path: '/identity', file: '~/identity/IdentityPage.vue' });
    },
  },
});
