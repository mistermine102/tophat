#!/usr/bin/env node
// Prints a clear hint when Stockfish is missing (run before `npm run dev`). Never fails: the app still starts and
// shows "Engine offline" until the engine is installed.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const target = process.env.STOCKFISH_PATH || join(repo, 'engine', 'stockfish.exe');
if (!existsSync(target)) {
  console.warn(
    [
      '',
      '  Stockfish is not installed — games cannot be analysed yet.',
      '  Run this once, then start again:',
      '',
      '      npm run setup:engine',
      '',
      `  (looked for ${target}; set STOCKFISH_PATH to use another binary)`,
      '',
    ].join('\n'),
  );
}
