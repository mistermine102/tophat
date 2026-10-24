// Express app factory (no listening, no engine start) so tests can mount it with fakes.
import express, { type Express } from 'express';
import type { Scheduler } from './engine/scheduler';
import type { Engine } from './engine/uci';
import { apiRouter } from './routes';

export interface AppContext {
  engine: Engine | null;
  scheduler: Scheduler | null;
  /** Why the engine isn't available (shown by /api/health). */
  engineError?: string;
}

export function createApp(ctx: AppContext): Express {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', apiRouter(ctx));
  return app;
}
