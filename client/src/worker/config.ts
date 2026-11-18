// Engine / analysis configuration of the in-browser analysis (main thread decides, the worker applies it).
//
// URL overrides (for testing and tuning): `?engines=N` (Stockfish instances = plies analysed at once), `?threads=N`
// (threads per instance; > 1 needs cross-origin isolation and uses the multi-threaded build), `?hash=MB` (per
// instance), `?engine=full` (the big network: ~100 MB download instead of the default lite one's ~2 MB, a bit stronger; the
// only one with a multi-threaded build), `?profile=fast` (shallow
// searches, for E2E tests), `?testhooks=1` (window.__chessCoachTest: kill engines, inject failures).

export type EngineFlavour = 'full' | 'lite';

export interface AnalysisConfig {
  flavour: EngineFlavour;
  /** Stockfish instances (Web Workers); each runs one ply's analysis at a time. */
  engines: number;
  /** Threads per instance (1 = the single-threaded build). */
  threads: number;
  hashMb: number;
  profile: 'default' | 'fast';
  testHooks: boolean;
}

export interface BrowserEnv {
  hardwareConcurrency: number;
  crossOriginIsolated: boolean;
  /** `navigator.deviceMemory` (GB, Chromium only, capped at 8); undefined elsewhere. */
  deviceMemory?: number | undefined;
}

/** At most this many instances by default. */
export const MAX_DEFAULT_ENGINES = 6;
/** Instances per GB of device memory: one full-network instance takes ≈ 0.35–0.4 GB (measured, Chromium). */
export const ENGINES_PER_GB = 0.75;
export const DEFAULT_HASH_MB = 32;

/**
 * Default instances: one per logical core minus two (the page and the analysis worker), at most
 * MAX_DEFAULT_ENGINES and ENGINES_PER_GB × device memory. At a fixed depth, 1-thread instances give the most plies
 * per second (Lazy SMP threads widen the search instead of finishing it sooner; ARCHITECTURE.md "Performance").
 */
export function defaultEngines(hardwareConcurrency: number, deviceMemory?: number): number {
  const byCores = (hardwareConcurrency || 4) - 2;
  const byMemory = deviceMemory ? Math.floor(deviceMemory * ENGINES_PER_GB) : MAX_DEFAULT_ENGINES;
  return Math.max(1, Math.min(MAX_DEFAULT_ENGINES, byCores, byMemory));
}

function int(v: string | null, min: number, max: number): number | undefined {
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

export function analysisConfig(search: string, env: BrowserEnv): AnalysisConfig {
  const q = new URLSearchParams(search);
  // the lite network by default (2 MB to load instead of 100 MB, about a third faster); `?engine=full` for the big one
  const flavour: EngineFlavour = q.get('engine') === 'full' ? 'full' : 'lite';
  const wantThreads = int(q.get('threads'), 1, 64) ?? 1;
  // threads need SharedArrayBuffer (cross-origin isolation) and the full multi-threaded build
  const threads = flavour === 'full' && env.crossOriginIsolated ? wantThreads : 1;
  const engines = int(q.get('engines'), 1, 32) ?? defaultEngines(env.hardwareConcurrency, env.deviceMemory);
  const hashMb = int(q.get('hash'), 1, 1024) ?? DEFAULT_HASH_MB;
  const profile = q.get('profile') === 'fast' ? 'fast' : 'default';
  const testHooks = q.get('testhooks') === '1';
  return { flavour, engines, threads, hashMb, profile, testHooks };
}

/** The stockfish.js build (file name under /engine/) for a config. */
export function engineFile(c: Pick<AnalysisConfig, 'flavour' | 'threads'>): string {
  if (c.flavour === 'lite') return 'stockfish-19-lite-single.js';
  return c.threads > 1 ? 'stockfish-19.js' : 'stockfish-19-single.js';
}
