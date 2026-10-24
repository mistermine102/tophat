import { defineConfig } from '@playwright/test';

// E2E tests live in client/e2e. The default run uses mock mode (`?mock=1`), so only the Vite dev server is needed;
// it runs on its own port so it never collides with (or reuses) a dev server started by hand.
// Set E2E_FULL=1 to start both dev servers (`npm run dev` at the repo root) for tests against the real server.
const full = !!process.env.E2E_FULL;
const port = full ? 5173 : 5183;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  webServer: {
    command: full ? 'npm run dev' : `npx vite --port ${port} --strictPort`,
    cwd: full ? '..' : '.',
    url: `http://localhost:${port}`,
    reuseExistingServer: full,
    timeout: 60_000,
  },
});
