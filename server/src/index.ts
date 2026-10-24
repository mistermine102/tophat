// Server entry: starts Stockfish + scheduler and serves the API on PORT (default 5174).
// Cache database: data/cache.sqlite (override with env CHESS_COACH_DB).
import { createApp, createGameManager, type AppContext } from './app';
import { CacheDb } from './cache';
import { Scheduler } from './engine/scheduler';
import { Engine } from './engine/uci';
import type { Searcher } from './analysis/searchCache';

const PORT = Number(process.env.PORT ?? 5174);

const ctx: AppContext = { engine: null, scheduler: null };
try {
  ctx.engine = await Engine.start();
  ctx.scheduler = new Scheduler<Searcher>(ctx.engine);
  console.log(`[server] engine: ${ctx.engine.name} (threads ${ctx.engine.threads}, hash ${ctx.engine.hashMb} MB)`);
} catch (e) {
  ctx.engineError = (e as Error).message;
  console.error(`[server] engine failed to start: ${ctx.engineError}`);
}
const db = new CacheDb();
ctx.games = createGameManager({ scheduler: ctx.scheduler, db });
console.log(`[server] cache: ${db.path}`);

const server = createApp(ctx).listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  await ctx.engine?.quit().catch(() => undefined);
  db.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
