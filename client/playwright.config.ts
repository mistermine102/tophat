import { defineConfig } from '@playwright/test';

// Two projects, both run by `npm run e2e`:
//  - `mock`: e2e/*.spec.ts against the Vite dev server in mock mode (`?mock=1`, fixture data, no engine).
//  - `real`: e2e/real/*.spec.ts against the real in-browser analysis (Stockfish WASM in the page's workers). Its dev
//    server bakes in VITE_ANALYSIS_DEFAULTS: the `fast` profile (shallow searches, ~1 s per ply), 2 engine
//    instances and the test hooks (window.__chessCoachTest: kill engines, inject failures). The tests of a file
//    share one browser context, so IndexedDB (the cache) carries over between them like the old server's sqlite.
// Set E2E_REAL=0 to run only the mock project.
// Ports are distinct from `npm run dev` (5173) and from other checkouts' E2E runs, so no dev session is reused or
// disturbed (env E2E_MOCK_PORT / E2E_REAL_PORT override them).
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? 5283);
export const REAL_CLIENT_PORT = Number(process.env.E2E_REAL_PORT ?? 5293);
const withReal = process.env.E2E_REAL !== '0';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'mock', testIgnore: /(real|acceptance)[\\/]/, use: { baseURL: `http://localhost:${MOCK_PORT}` } },
    ...(withReal
      ? [{ name: 'real', testDir: './e2e/real', timeout: 240_000, use: { baseURL: `http://localhost:${REAL_CLIENT_PORT}` } }]
      : []),
  ],
  webServer: [
    {
      command: `npx vite --port ${MOCK_PORT} --strictPort`,
      cwd: '.',
      url: `http://localhost:${MOCK_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    ...(withReal
      ? [
          {
            command: `npx vite --port ${REAL_CLIENT_PORT} --strictPort`,
            cwd: '.',
            url: `http://localhost:${REAL_CLIENT_PORT}`,
            reuseExistingServer: false,
            timeout: 60_000,
            env: {
              ...(process.env as Record<string, string>),
              VITE_ANALYSIS_DEFAULTS: process.env.E2E_ANALYSIS ?? 'profile=fast&engines=2&testhooks=1',
            },
          },
        ]
      : []),
  ],
});
