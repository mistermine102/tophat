import { defineConfig } from 'vitest/config';

// Runs every workspace's tests from the repo root (`npm test`).
export default defineConfig({
  test: {
    projects: ['shared', 'core', 'client'],
  },
});
