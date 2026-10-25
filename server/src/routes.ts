// REST + SSE routes under /api (ARCHITECTURE.md "HTTP API").
import { type ErrorRequestHandler, type Request, type Response, Router } from 'express';
import type { AppContext } from './app';
import { BadRequestError, type GameEvent, type GameManager, PgnImportError } from './games';

/** SSE heartbeat interval (comment line) so proxies and browsers keep the stream open. */
export const SSE_HEARTBEAT_MS = 15_000;

export function apiRouter(ctx: AppContext, games: GameManager): Router {
  const r = Router();

  r.get('/health', (_req, res) => {
    const engine = ctx.engine;
    if (engine?.alive) res.json({ ok: true, engine: engine.name });
    else res.status(503).json({ ok: false, engine: null, error: ctx.engineError ?? 'engine not running' });
  });

  r.post('/games', (req, res) => {
    const pgn = (req.body as { pgn?: unknown } | undefined)?.pgn;
    if (typeof pgn !== 'string') throw new PgnImportError('body must be { pgn: string }');
    res.json(games.importPgn(pgn));
  });

  r.get('/games/:id', (req, res) => {
    const g = games.get(String(req.params.id));
    if (!g) {
      res.status(404).json({ error: 'unknown game' });
      return;
    }
    res.json(g);
  });

  r.get('/games/:id/stream', (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!games.info(id)) {
      res.status(404).json({ error: 'unknown game' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const send = (e: GameEvent) => {
      const { type, ...data } = e;
      const payload = type === 'summary' ? (data as { summary: unknown }).summary : data;
      res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    // subscribe first, then replay: an analysis finishing in between is at worst sent twice (idempotent)
    const unsubscribe = games.subscribe(id, send);
    for (const e of games.snapshot(id)) send(e);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), SSE_HEARTBEAT_MS);
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on('close', cleanup);
    res.on('error', cleanup);
  });

  r.post('/games/:id/focus', (req, res) => {
    const ply = Number((req.body as { ply?: unknown } | undefined)?.ply);
    if (!Number.isInteger(ply) || ply < 1) throw new BadRequestError('body must be { ply: positive integer }');
    if (!games.focus(String(req.params.id), ply)) {
      res.status(404).json({ error: 'unknown game' });
      return;
    }
    res.status(204).end();
  });

  r.post('/analyse', async (req, res) => {
    if (!ctx.scheduler) {
      res.status(503).json({ error: ctx.engineError ?? 'engine not running' });
      return;
    }
    res.json(await games.analyse(req.body));
  });

  r.get('/settings', (_req, res) => {
    res.json(games.getSettings());
  });

  r.put('/settings', (req, res) => {
    res.json(games.putSettings(req.body));
  });

  // Fault injection for E2E tests, only with env CHESS_COACH_TEST_HOOKS=1.
  if (ctx.testHooks ?? process.env.CHESS_COACH_TEST_HOOKS === '1') {
    // kill the Stockfish processes (a running search rejects with EngineCrashedError; the next search restarts it)
    r.post('/test/kill-engine', (_req, res) => {
      const engines = ctx.engines?.length ? ctx.engines : ctx.engine ? [ctx.engine] : [];
      let killed = 0;
      for (const e of engines) {
        const proc = (e as unknown as { proc?: { kill(): void } | null }).proc;
        if (proc) {
          proc.kill();
          killed++;
        }
      }
      res.json({ killed: killed > 0, processes: killed });
    });
    // the next `n` analysis attempts fail (each ply is attempted twice), e.g. { n: 2 } -> one failed ply
    r.post('/test/fail-next', (req, res) => {
      const n = Number((req.body as { n?: unknown } | undefined)?.n ?? 2);
      games.injectFailures(n);
      res.json({ n });
    });
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (res.headersSent) return;
    if (err instanceof PgnImportError || err instanceof BadRequestError) res.status(400).json({ error: err.message });
    else if ((err as { type?: string }).type === 'entity.parse.failed') res.status(400).json({ error: 'invalid JSON body' });
    else {
      console.error('[api]', err);
      res.status(500).json({ error: (err as Error).message ?? 'internal error' });
    }
  };
  r.use(onError);
  return r;
}
