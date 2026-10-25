// Memoised engine searches: in memory and (optionally) persisted in SQLite (cache.ts table `searches`).
//
// Key = position (EPD: board, turn, castling, legal ep square; move clocks ignored) + depth + time cap + MultiPV +
// sorted searchmoves. The same position reached in different plies/games/side lines is searched once, e.g. the deep
// MultiPV search at fenAfter of ply N is the deep search at fenBefore of ply N+1.
// A request for MultiPV m is also answered by a cached result of the same depth with a larger MultiPV (first m
// lines). Concurrent identical requests share one engine call (also across engines/jobs, M4); if that call is
// aborted (its job was preempted), a waiter runs the search itself. Failed searches are not cached.
//
// Engine non-determinism (multi-threaded search) makes this important for consistency too: every consumer of a
// position sees the same lines.

import { makeFen } from 'chessops/fen';
import { positionFromFen } from '../chess/material';
import type { CacheDb } from '../cache';
import { type SearchResult, SearchAbortedError } from '../engine/uci';

export interface SearchParams {
  depth: number;
  multipv: number;
  /** Time cap: stop at `depth` or after this many ms, whichever comes first. */
  maxMs?: number;
  /** Node cap (UCI `go nodes`), optional: stop at `depth` or after this many nodes. */
  maxNodes?: number;
  searchmoves?: string[];
}

/** Anything that can run a search (an Engine, or a fake in tests). */
export interface Searcher {
  search(req: { fen: string; depth: number; multipv: number; movetimeMs?: number; nodes?: number; searchmoves?: string[] }): Promise<SearchResult>;
}

export interface SearchOutcome {
  result: SearchResult;
  /** Served from the cache (memory or sqlite) — no engine time spent. */
  cached: boolean;
}

/** In-memory entries kept (oldest dropped first; sqlite keeps everything). */
export const MEMORY_LIMIT = 20_000;

/** MultiPV values probed when looking for a superset result (larger MultiPV, same depth). */
const SUPERSET_MULTIPV = [5, 4, 3, 2];

export class SearchCache {
  private mem = new Map<string, SearchResult>();
  private pending = new Map<string, Promise<SearchResult>>();
  stats = { hits: 0, misses: 0, engineMs: 0 };

  constructor(private readonly db: CacheDb | null = null) {}

  static key(fen: string, p: SearchParams): string {
    const epd = makeFen(positionFromFen(fen).toSetup(), { epd: true });
    const sm = p.searchmoves?.length ? `|s:${[...p.searchmoves].sort().join(',')}` : '';
    const t = p.maxMs ? `|t${p.maxMs}` : '';
    const nd = p.maxNodes ? `|n${p.maxNodes}` : '';
    return `${epd}|d${p.depth}${t}${nd}|m${p.multipv}${sm}`;
  }

  /** Cached result for exactly these params (or a MultiPV superset), without searching. */
  peek(fen: string, p: SearchParams): SearchResult | undefined {
    const exact = this.lookup(SearchCache.key(fen, p));
    if (exact) return exact;
    if (p.searchmoves?.length) return undefined;
    for (const m of SUPERSET_MULTIPV) {
      if (m <= p.multipv) break;
      const r = this.lookup(SearchCache.key(fen, { ...p, multipv: m }));
      if (r) return { ...r, lines: r.lines.slice(0, p.multipv) };
    }
    return undefined;
  }

  async search(engine: Searcher, fen: string, p: SearchParams): Promise<SearchOutcome> {
    const hit = this.peek(fen, p);
    if (hit) {
      this.stats.hits++;
      return { result: hit, cached: true };
    }
    const key = SearchCache.key(fen, p);
    const inflight = this.pending.get(key);
    if (inflight) {
      try {
        return { result: await inflight, cached: true };
      } catch (e) {
        // the job that started it was preempted (scheduler): run it ourselves on our own engine
        if (!(e instanceof SearchAbortedError)) throw e;
        return this.search(engine, fen, p);
      }
    }
    this.stats.misses++;
    const req = { fen, depth: p.depth, multipv: p.multipv, ...(p.maxMs ? { movetimeMs: p.maxMs } : {}), ...(p.maxNodes ? { nodes: p.maxNodes } : {}), ...(p.searchmoves?.length ? { searchmoves: p.searchmoves } : {}) };
    const promise = engine.search(req);
    this.pending.set(key, promise);
    try {
      const result = await promise;
      this.stats.engineMs += result.timeMs;
      this.remember(key, result);
      this.db?.put('searches', key, result);
      return { result, cached: false };
    } finally {
      if (this.pending.get(key) === promise) this.pending.delete(key);
    }
  }

  private remember(key: string, r: SearchResult): void {
    this.mem.set(key, r);
    if (this.mem.size > MEMORY_LIMIT) {
      const drop = this.mem.size - MEMORY_LIMIT / 2;
      let i = 0;
      for (const k of this.mem.keys()) {
        if (i++ >= drop) break;
        this.mem.delete(k);
      }
    }
  }

  private lookup(key: string): SearchResult | undefined {
    const m = this.mem.get(key);
    if (m) return m;
    const d = this.db?.get<SearchResult>('searches', key);
    if (d) {
      this.remember(key, d);
      return d;
    }
    return undefined;
  }
}
