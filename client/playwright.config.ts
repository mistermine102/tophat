import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// Two projects, both run by `npm run e2e`:
//  - `mock`: e2e/*.spec.ts against the Vite dev server in mock mode (`?mock=1`, fixture data, no server).
//  - `real`: e2e/real/*.spec.ts against the real server (Stockfish) + a Vite dev server proxying to it. The server
//    uses its own ports, a fresh sqlite file per run, ANALYSIS_PROFILE=fast (shallow searches, ~1 s per ply),
//    ENGINE_THREADS=2 and the fault-injection routes (CHESS_COACH_TEST_HOOKS=1). Tests skip if Stockfish is missing.
// Set E2E_REAL=0 to run only the mock project (no engine/server started).
// Ports are distinct from `npm run dev` (5173/5174) so a dev session is never reused or disturbed.
const MOCK_PORT = 5183;
export const REAL_CLIENT_PORT = 5193;
export const REAL_API_PORT = 5194;
const withReal = process.env.E2E_REAL !== '0';
// Fresh cache per run (the config is also evaluated in workers; only the runner starts the servers).
const db = process.env.E2E_DB ?? join(tmpdir(), `chess-coach-e2e-${Date.now()}.sqlite`);

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
            command: 'node --import tsx src/index.ts',
            cwd: '../server',
            url: `http://localhost:${REAL_API_PORT}/api/settings`,
            reuseExistingServer: false,
            timeout: 60_000,
            stdout: 'pipe' as const,
            env: {
              ...(process.env as Record<string, string>),
              PORT: String(REAL_API_PORT),
              CHESS_COACH_DB: db,
              ANALYSIS_PROFILE: process.env.ANALYSIS_PROFILE ?? 'fast',
              ENGINE_THREADS: process.env.ENGINE_THREADS ?? '2',
              ENGINE_HASH_MB: process.env.ENGINE_HASH_MB ?? '128',
              CHESS_COACH_TEST_HOOKS: '1',
              LOG_ANALYSIS: '1',
            },
          },
          {
            command: `npx vite --port ${REAL_CLIENT_PORT} --strictPort`,
            cwd: '.',
            url: `http://localhost:${REAL_CLIENT_PORT}`,
            reuseExistingServer: false,
            timeout: 60_000,
            env: { ...(process.env as Record<string, string>), API_PORT: String(REAL_API_PORT) },
          },
        ]
      : []),
  ],
});
