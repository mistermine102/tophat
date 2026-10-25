import { defineConfig } from '@playwright/test';

// Acceptance walk-through (M6) against an already running `npm start` (real engine, full depth, default profile).
// Not part of `npm run e2e`. Start the app first, then:
//   npm run acceptance                         (ACCEPT_URL, default http://localhost:5174)
// Writes screenshots + a text log of every panel it read to ACCEPT_OUT (default ../tmp/acceptance).
export default defineConfig({
  testDir: './e2e/acceptance',
  timeout: 20 * 60_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.ACCEPT_URL ?? 'http://localhost:5174', trace: 'off' },
});
