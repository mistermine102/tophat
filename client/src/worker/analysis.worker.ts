// The analysis worker: the whole analysis pipeline of the old server, in the browser.
//
//   page (api/local.ts) --postMessage--> this worker: GameManager + Scheduler + SearchCache + IndexedDB cache
//                                          └─ N Stockfish WASM workers (worker/stockfish.ts), one ply each
//
// Same pipeline as before (core/: analyzeMove, facts, labels, explanations, priorities / focus / preemption); only the
// environment differs: engines are Web Workers, the cache is IndexedDB (worker/idbStore.ts), the opening book TSVs are
// static assets fetched on first use.
import { loadBookAsync } from '@chess-coach/core/analysis/book';
import { SearchCache, type Searcher } from '@chess-coach/core/analysis/searchCache';
import { Scheduler } from '@chess-coach/core/engine/scheduler';
import { Engine, SearchAbortedError } from '@chess-coach/core/engine/uci';
import { BadRequestError, GameManager, PgnImportError } from '@chess-coach/core/games';
import { analysisSettingsFor } from '@chess-coach/core/profiles';
import { type CacheStore, MemoryStore } from '@chess-coach/core/store';
import bookA from '../../../core/data/openings/a.tsv?url';
import bookB from '../../../core/data/openings/b.tsv?url';
import bookC from '../../../core/data/openings/c.tsv?url';
import bookD from '../../../core/data/openings/d.tsv?url';
import bookE from '../../../core/data/openings/e.tsv?url';
import type { Health } from '../api/types';
import { type AnalysisConfig, engineFile } from './config';
import { IdbStore } from './idbStore';
import type { FromWorker, Requests, ToWorker, WorkerError, WorkerStats } from './protocol';
import { engineUrl, workerSpawn } from './stockfish';

const BOOK_URLS: Record<string, string> = { 'a.tsv': bookA, 'b.tsv': bookB, 'c.tsv': bookC, 'd.tsv': bookD, 'e.tsv': bookE };

interface State {
  config: AnalysisConfig;
  file: string;
  games: GameManager;
  searchCache: SearchCache;
  scheduler: Scheduler<Searcher> | null;
  engines: Engine[];
  /** Resolves when the first engine is running (or failed). */
  firstEngine: Promise<void>;
  engineError: string | null;
  subs: Map<number, () => void>;
}

let state: Promise<State> | null = null;

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

function log(msg: string): void {
  if (state) console.debug(`[analysis] ${msg}`);
}

async function openStore(): Promise<CacheStore> {
  try {
    return await IdbStore.open();
  } catch (e) {
    // e.g. a private window without IndexedDB: analyses still work, they just aren't kept
    console.warn(`[analysis] IndexedDB unavailable (${(e as Error).message}); results are kept in memory only`);
    return new MemoryStore();
  }
}

async function loadBook(): Promise<void> {
  await loadBookAsync(async (file) => {
    const res = await fetch(BOOK_URLS[file]!);
    if (!res.ok) throw new Error(`opening book ${file}: HTTP ${res.status}`);
    return res.text();
  });
}

async function init(config: AnalysisConfig): Promise<State> {
  const [db] = await Promise.all([openStore(), loadBook()]);
  const settings = analysisSettingsFor(config.profile);
  const searchCache = new SearchCache(db);
  const file = engineFile(config);
  const spawn = workerSpawn(engineUrl(file));
  const st: State = {
    config,
    file,
    searchCache,
    scheduler: null,
    engines: [],
    games: null as unknown as GameManager,
    firstEngine: Promise.resolve(),
    engineError: null,
    subs: new Map(),
  };
  const start = () => Engine.start({ spawn, path: file, threads: config.threads, hashMb: config.hashMb });
  // The first instance alone (it downloads / compiles the engine into the HTTP and code caches), then the rest in
  // parallel; the scheduler gets each one as soon as it runs, so the first labels don't wait for all of them.
  // Until the first one runs, its slot is a stand-in whose searches wait for it: games open (from the cache) and
  // jobs queue right away.
  const firstP = start();
  let first: Engine | null = null;
  let abortSeq = 0;
  const standIn: Searcher & { abort(): void } = {
    search: async (req) => {
      const seq = abortSeq;
      const e = await firstP;
      if (seq !== abortSeq) throw new SearchAbortedError('search aborted');
      return e.search(req);
    },
    abort: () => {
      abortSeq++;
      first?.abort();
    },
  };
  st.scheduler = new Scheduler<Searcher>([standIn], { preempt: true });
  st.games = new GameManager({ db, searchCache, scheduler: st.scheduler, settings, log });
  st.firstEngine = firstP.then(
    (e) => {
      first = e;
      st.engines.push(e);
      for (let i = 1; i < config.engines; i++) {
        start().then(
          (more) => {
            st.engines.push(more);
            st.scheduler!.addEngine(more);
          },
          (err: unknown) => console.warn(`[analysis] engine ${i + 1} failed to start: ${(err as Error).message}`),
        );
      }
    },
    (err: unknown) => {
      st.engineError = (err as Error).message;
    },
  );
  return st;
}

function fail(e: unknown): WorkerError {
  const message = (e as Error)?.message ?? String(e);
  if (e instanceof PgnImportError || e instanceof BadRequestError) return { message, status: 400 };
  return { message, status: 500 };
}

type Handlers = { [K in keyof Requests]: (payload: Requests[K]['req']) => Promise<Requests[K]['res']> | Requests[K]['res'] };

const need = async (): Promise<State> => {
  if (!state) throw new Error('analysis worker not initialised');
  return state;
};

const handlers: Handlers = {
  init: async (config) => {
    state ??= init(config);
    await state;
  },
  health: async (): Promise<Health> => {
    const st = await need();
    await st.firstEngine;
    const e = st.engines[0];
    if (e && !st.engineError) return { ok: true, engine: e.name };
    return { ok: false, engine: null, error: st.engineError ? `The chess engine could not start: ${st.engineError}` : 'engine not running' };
  },
  createGame: async ({ pgn }) => (await need()).games.importPgn(pgn),
  getGame: async ({ id }) => {
    const g = await (await need()).games.get(id);
    if (!g) throw Object.assign(new Error('This game is not stored in this browser any more — open it again from chess.com or paste its PGN.'), { status: 404 });
    return g;
  },
  focus: async ({ id, ply }) => {
    if (!Number.isInteger(ply) || ply < 1) throw new BadRequestError('ply must be a positive integer');
    const ok = await (await need()).games.focus(id, ply);
    if (!ok) throw Object.assign(new Error('unknown game'), { status: 404 });
  },
  analyse: async (req) => (await need()).games.analyse(req),
  subscribe: async ({ id, sub }) => {
    const st = await need();
    // subscribe first, then replay: an analysis finishing in between is at worst delivered twice (idempotent)
    const unsubscribe = await st.games.subscribe(id, (event) => post({ kind: 'event', sub, event }));
    st.subs.set(sub, unsubscribe);
    for (const event of await st.games.snapshot(id)) post({ kind: 'event', sub, event });
  },
  unsubscribe: async ({ sub }) => {
    const st = await need();
    st.subs.get(sub)?.();
    st.subs.delete(sub);
  },
  killEngines: async () => {
    const st = await need();
    if (!st.config.testHooks) throw new Error('test hooks are off (?testhooks=1)');
    return { killed: st.engines.filter((e) => e.killInstance()).length };
  },
  failNext: async ({ n }) => {
    const st = await need();
    if (!st.config.testHooks) throw new Error('test hooks are off (?testhooks=1)');
    st.games.injectFailures(n);
  },
  stats: async (): Promise<WorkerStats> => {
    const st = await need();
    return {
      engine: st.engines[0]?.name ?? null,
      engines: st.engines.length,
      threads: st.config.threads,
      file: st.file,
      engineMs: st.searchCache.stats.engineMs,
      searches: { hits: st.searchCache.stats.hits, misses: st.searchCache.stats.misses },
    };
  },
};

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const { id, type, payload } = e.data;
  try {
    const value = await (handlers[type] as (p: unknown) => unknown)(payload);
    post({ kind: 'response', id, ok: true, value });
  } catch (err) {
    const error = fail(err);
    const status = (err as { status?: unknown })?.status;
    if (typeof status === 'number') error.status = status;
    post({ kind: 'response', id, ok: false, error });
  }
};
