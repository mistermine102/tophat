// Express app factory (no listening, no engine start) so tests can mount it with fakes.
import { fileURLToPath } from 'node:url';
import { type AnalysisSettings, DEFAULT_SETTINGS } from '@chess-coach/shared';
import express, { type Express } from 'express';
import { SearchCache, type Searcher } from './analysis/searchCache';
import { CacheDb } from './cache';
import type { Scheduler } from './engine/scheduler';
import type { Engine } from './engine/uci';
import { GameManager } from './games';
import { apiRouter } from './routes';

export interface AppContext {
  /** The first engine process (health: name / alive). */
  engine: Engine | null;
  /** All engine processes (M4: ENGINE_PROCESSES); default [engine]. */
  engines?: Engine[];
  /** Serve this directory (the built client) at / with an index.html fallback (`npm start`). */
  serveClient?: string;
  scheduler: Scheduler<Searcher> | null;
  /** Why the engine isn't available (shown by /api/health). */
  engineError?: string;
  /** Game/analysis state. Default: a GameManager over an in-memory database (tests). */
  games?: GameManager;
  /** fetch used for chess.com import (tests pass a fake; default: global fetch). */
  fetchImpl?: typeof fetch;
  /** Mount the fault-injection routes under /api/test (default: env CHESS_COACH_TEST_HOOKS=1). */
  testHooks?: boolean;
}

/** Build the full server state: sqlite cache, persisted search cache and the game manager. */
export function createGameManager(opts: { scheduler: Scheduler<Searcher> | null; db?: CacheDb; settings?: AnalysisSettings }): GameManager {
  const db = opts.db ?? new CacheDb();
  return new GameManager({ db, searchCache: new SearchCache(db), scheduler: opts.scheduler, settings: opts.settings ?? DEFAULT_SETTINGS });
}

/**
 * Analysis profiles (env `ANALYSIS_PROFILE`): `default` = DEFAULT_SETTINGS; `fast` = reduced search budget for
 * E2E tests and quick looks (same pipeline, much shallower searches; a different settings hash, so its cache
 * entries never mix with full-depth results).
 */
export function analysisSettingsFor(profile: string | undefined): AnalysisSettings {
  const p = (profile ?? '').trim().toLowerCase();
  if (!p || p === 'default') return DEFAULT_SETTINGS;
  if (p !== 'fast') throw new Error(`unknown ANALYSIS_PROFILE "${profile}" (expected "default" or "fast")`);
  const s: AnalysisSettings = structuredClone(DEFAULT_SETTINGS);
  s.budget.deep = { depth: 10, multipv: 5, maxMs: 1000 };
  s.budget.shallow = { depth: 6, multipv: 5, maxMs: 300 };
  s.budget.threat = { depth: 8, multipv: 1, maxMs: 300 };
  s.budget.forcedness = { depth: 8, multipv: 2, maxMs: 300 };
  return s;
}

/** Positive integer from an env value, or undefined (unset / invalid). */
export function envInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function createApp(ctx: AppContext): Express {
  const games = ctx.games ?? createGameManager({ scheduler: ctx.scheduler, db: new CacheDb(':memory:') });
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', apiRouter(ctx, games));
  const dist = ctx.serveClient;
  if (dist) {
    app.use(express.static(dist, { index: 'index.html' }));
    // single-page app: any other GET (outside /api) gets index.html
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile('index.html', { root: dist }); // root: the repo path itself may contain dot folders
    });
  }
  return app;
}

/** client/dist (Vite build output), served by `npm start`. */
export function clientDistDir(): string {
  return fileURLToPath(new URL('../../client/dist', import.meta.url));
}
