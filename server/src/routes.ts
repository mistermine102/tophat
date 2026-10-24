// REST + SSE routes under /api. M0: health only (the rest of the API arrives in M2, see ARCHITECTURE.md).
import { Router } from 'express';
import type { AppContext } from './app';

export function apiRouter(ctx: AppContext): Router {
  const r = Router();

  r.get('/health', (_req, res) => {
    const engine = ctx.engine;
    if (engine?.alive) res.json({ ok: true, engine: engine.name });
    else res.status(503).json({ ok: false, engine: null, error: ctx.engineError ?? 'engine not running' });
  });

  return r;
}
