import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'core',
    include: ['test/**/*.test.ts'],
    // Node environment: engine transport (Stockfish WASM run by node, or STOCKFISH_PATH) + opening book from disk
    setupFiles: ['test/setup.ts'],
    // engine integration tests start Stockfish; keep them out of parallel worker contention
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
