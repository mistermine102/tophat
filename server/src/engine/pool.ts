// Several Stockfish processes for the scheduler (M4): plies are analysed concurrently, one job per process.
//
// Measured on the Ryzen 5 3600 (ARCHITECTURE.md "Performance (M4)"): at a fixed depth, extra Stockfish threads
// widen the search (more nodes) instead of finishing it sooner, so the same 10 threads as 5 processes x 2 threads
// analyse a game ~5x faster than 1 x 10 threads, with label quality within run-to-run noise (bench/label-compare.ts).
// Default: processes = total threads / 2 (10 threads -> 5 x 2).
import os from 'node:os';
import { Engine, type EngineOptions } from './uci';

export interface EnginePoolOptions extends Omit<EngineOptions, 'threads'> {
  /** Total Stockfish threads, split evenly over the processes (default max(1, cpus - 2)). */
  threads?: number;
  /** Number of engine processes (default: total threads / DEFAULT_THREADS_PER_PROCESS, at least 1). */
  processes?: number;
}

export const DEFAULT_THREADS_PER_PROCESS = 2;
/** Hash per process: a d16 search visits a few million nodes, far below what 256 MB holds. */
export const DEFAULT_HASH_MB_PER_PROCESS = 256;

export interface EnginePool {
  engines: Engine[];
  threadsPerEngine: number;
  quit(): Promise<void>;
}

export function defaultThreads(): number {
  return Math.max(1, os.availableParallelism() - 2);
}

export function defaultProcesses(totalThreads: number): number {
  return Math.max(1, Math.floor(totalThreads / DEFAULT_THREADS_PER_PROCESS));
}

export async function createEnginePool(opts: EnginePoolOptions = {}): Promise<EnginePool> {
  const total = Math.max(1, opts.threads ?? defaultThreads());
  const processes = Math.max(1, Math.min(total, opts.processes ?? defaultProcesses(total)));
  const threadsPerEngine = Math.max(1, Math.floor(total / processes));
  const { threads: _t, processes: _p, ...engineOpts } = opts;
  const hashMb = opts.hashMb ?? DEFAULT_HASH_MB_PER_PROCESS;
  const started = await Promise.allSettled(Array.from({ length: processes }, () => Engine.start({ ...engineOpts, threads: threadsPerEngine, hashMb })));
  const engines = started.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const failed = started.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) {
    await Promise.all(engines.map((e) => e.quit().catch(() => undefined)));
    throw failed.reason;
  }
  return {
    engines,
    threadsPerEngine,
    quit: async () => {
      await Promise.all(engines.map((e) => e.quit().catch(() => undefined)));
    },
  };
}
