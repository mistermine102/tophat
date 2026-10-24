// Express app factory (no listening, no engine start) so tests can mount it with fakes.
import { type AnalysisSettings, DEFAULT_SETTINGS } from '@chess-coach/shared';
import express, { type Express } from 'express';
import { SearchCache, type Searcher } from './analysis/searchCache';
import { CacheDb } from './cache';
import type { Scheduler } from './engine/scheduler';
import type { Engine } from './engine/uci';
import { GameManager } from './games';
import { apiRouter } from './routes';

export interface AppContext {
  engine: Engine | null;
  scheduler: Scheduler<Searcher> | null;
  /** Why the engine isn't available (shown by /api/health). */
  engineError?: string;
  /** Game/analysis state. Default: a GameManager over an in-memory database (tests). */
  games?: GameManager;
}

/** Build the full server state: sqlite cache, persisted search cache and the game manager. */
export function createGameManager(opts: { scheduler: Scheduler<Searcher> | null; db?: CacheDb; settings?: AnalysisSettings }): GameManager {
  const db = opts.db ?? new CacheDb();
  return new GameManager({ db, searchCache: new SearchCache(db), scheduler: opts.scheduler, settings: opts.settings ?? DEFAULT_SETTINGS });
}

export function createApp(ctx: AppContext): Express {
  const games = ctx.games ?? createGameManager({ scheduler: ctx.scheduler, db: new CacheDb(':memory:') });
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', apiRouter(ctx, games));
  return app;
}
