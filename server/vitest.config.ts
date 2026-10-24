import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    include: ['test/**/*.test.ts'],
    // engine integration tests spawn Stockfish; keep them out of parallel worker contention
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
