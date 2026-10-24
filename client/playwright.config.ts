import { defineConfig } from '@playwright/test';

// E2E tests live in client/e2e (written in M4). `npm run e2e` starts both dev servers.
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'npm run dev',
    cwd: '..',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
