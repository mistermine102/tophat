// Node transport for the Engine (tests, benchmarks, scripts). Importing this module registers it as the default
// `UciSpawn`, so `Engine.start({ threads, hashMb })` works as before.
//
// Engine file: env `STOCKFISH_PATH` (a native binary, or a stockfish.js `.js` file which is run with node), else the
// Stockfish WASM build from the `stockfish` npm package (the same engine the browser runs; multi-threaded build, so
// `threads` is honoured). The native binary is about 2.3x faster per thread (Stockfish 19, measured), the search
// itself is identical (same node counts at 1 thread).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { EngineError, setDefaultUciSpawn, type UciHandlers, type UciProcess, type UciSpawn } from './uci';

export * from './uci';

/** stockfish.js flavours shipped in the `stockfish` npm package (bin/stockfish-19*.js). */
export type WasmFlavour = 'full' | 'single' | 'lite' | 'lite-single';

const FLAVOUR_FILE: Record<WasmFlavour, string> = {
  full: 'stockfish-19.js',
  single: 'stockfish-19-single.js',
  lite: 'stockfish-19-lite.js',
  'lite-single': 'stockfish-19-lite-single.js',
};

/** Path of a stockfish.js build inside node_modules/stockfish/bin. */
export function wasmEnginePath(flavour: WasmFlavour = 'full'): string {
  const pkg = createRequire(import.meta.url).resolve('stockfish/package.json');
  return join(dirname(pkg), 'bin', FLAVOUR_FILE[flavour]);
}

/** `STOCKFISH_PATH` env, else the multi-threaded WASM build from the stockfish npm package. */
export function defaultEnginePath(): string {
  const env = process.env.STOCKFISH_PATH;
  if (env) return env;
  return wasmEnginePath('full');
}

export function engineAvailable(path = defaultEnginePath()): boolean {
  return existsSync(path);
}

export function defaultThreads(): number {
  return Math.max(1, os.availableParallelism() - 2);
}

/** Child-process transport: `path` is a native binary, or a `.js` stockfish.js build (run with this node). */
export function nodeSpawn(path: string = defaultEnginePath()): UciSpawn {
  return (h: UciHandlers): UciProcess => {
    if (!existsSync(path)) throw new EngineError(`Stockfish not found at ${path} (run \`npm install\`, or set STOCKFISH_PATH)`);
    const isJs = /\.[cm]?js$/i.test(path);
    const proc = isJs ? spawn(process.execPath, [path], { stdio: 'pipe', windowsHide: true }) : spawn(path, [], { stdio: 'pipe', windowsHide: true });
    let buf = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => {
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        h.onLine(line);
      }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk: string) => h.onStderr?.(chunk));
    proc.stdin.on('error', () => undefined); // EPIPE after a crash; surfaced via 'exit'
    proc.on('error', (err) => h.onExit(`failed to run engine: ${err.message}`));
    proc.on('exit', (code, signal) => h.onExit(`engine exited (code ${code}, signal ${signal})`));
    return {
      write: (line) => {
        proc.stdin.write(line + '\n');
      },
      kill: () => {
        proc.kill();
      },
    };
  };
}

setDefaultUciSpawn((path = defaultEnginePath()) => ({ spawn: nodeSpawn(path), path }));
