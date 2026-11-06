// Node environment for the analysis pipeline (tests, benchmarks, scripts): import this once at startup.
// - registers the Node engine transport (engine/node.ts: Stockfish WASM run by node, or STOCKFISH_PATH);
// - registers the opening book source (data/openings/*.tsv read from disk).
// The browser counterpart is client/src/worker/analysis.worker.ts.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BOOK_FILES, setBookSource } from './analysis/book';
import './engine/node';

export const BOOK_DIR = fileURLToPath(new URL('../data/openings/', import.meta.url));

setBookSource(() => BOOK_FILES.map((file) => ({ file, content: readFileSync(BOOK_DIR + file, 'utf8') })));

export { defaultEnginePath, defaultThreads, engineAvailable, nodeSpawn, wasmEnginePath } from './engine/node';
