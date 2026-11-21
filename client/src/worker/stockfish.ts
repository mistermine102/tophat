// Browser transport for the Engine (core/src/engine/uci.ts `UciSpawn`): one Stockfish WASM instance per Web Worker.
//
// Build: stockfish.js 19 by Nathan Rugg / Chess.com (npm `stockfish`, GPL-3.0), Stockfish 19 with its NNUE network
// compiled to WebAssembly. The worker script is the engine itself: UCI commands go in with postMessage(string),
// output lines come back as string messages (other messages, e.g. download progress objects, are ignored). It
// loads the .wasm next to it (same name). Served at /engine/ (client/nuxt.config.ts serves / copies the files from
// node_modules/stockfish/bin).
import { EngineCrashedError, type UciProcess, type UciSpawn } from '@chess-coach/core/engine/uci';

export function workerSpawn(url: string): UciSpawn {
  return (h): UciProcess => {
    let worker: Worker;
    try {
      worker = new Worker(url);
    } catch (e) {
      throw new EngineCrashedError(`could not start the engine worker (${url}): ${(e as Error).message}`);
    }
    let alive = true;
    const exit = (why: string) => {
      if (!alive) return;
      alive = false;
      worker.terminate();
      h.onExit(why);
    };
    worker.onmessage = (e: MessageEvent<unknown>) => {
      if (typeof e.data !== 'string') return;
      for (const line of e.data.split('\n')) h.onLine(line);
    };
    worker.onerror = (e: ErrorEvent) => {
      e.preventDefault();
      h.onStderr?.(e.message ?? 'worker error');
      exit(`engine worker failed: ${e.message || 'could not load the engine (network / out of memory?)'}`);
    };
    worker.onmessageerror = () => exit('engine worker sent an unreadable message');
    return {
      write: (line) => {
        if (!alive) return;
        // a WASM instance doesn't exit on `quit`: end the worker instead
        if (line === 'quit') exit('quit');
        else worker.postMessage(line);
      },
      kill: () => exit('engine killed'),
    };
  };
}

/** Absolute URL of an engine file under the app's base path (works from the page and from module workers). */
export function engineUrl(file: string, base: string = import.meta.env.VITE_APP_BASE ?? '/', origin: string = self.location.origin): string {
  return new URL(`${base.replace(/\/?$/, '/')}engine/${file}`, origin).href;
}
