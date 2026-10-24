// Server entry: starts Stockfish + scheduler and serves the API on PORT (default 5174).
// Environment:
//   PORT              HTTP port (default 5174)
//   CHESS_COACH_DB    sqlite cache path (default data/cache.sqlite)
//   STOCKFISH_PATH    engine binary (default engine/stockfish.exe)
//   ENGINE_THREADS    Stockfish Threads (default max(1, cpus - 2))
//   ENGINE_HASH_MB    Stockfish Hash in MB (default 512)
//   ANALYSIS_PROFILE  `default` (full depth) or `fast` (reduced search budget, e.g. for E2E tests)
import { analysisSettingsFor, createApp, createGameManager, envInt, type AppContext } from './app';
import { CacheDb } from './cache';
import { Scheduler } from './engine/scheduler';
import { Engine } from './engine/uci';
import type { Searcher } from './analysis/searchCache';

const PORT = Number(process.env.PORT ?? 5174);
const settings = analysisSettingsFor(process.env.ANALYSIS_PROFILE);

const ctx: AppContext = { engine: null, scheduler: null };
try {
  ctx.engine = await Engine.start({ threads: envInt(process.env.ENGINE_THREADS), hashMb: envInt(process.env.ENGINE_HASH_MB) });
  ctx.scheduler = new Scheduler<Searcher>(ctx.engine);
  console.log(`[server] engine: ${ctx.engine.name} (threads ${ctx.engine.threads}, hash ${ctx.engine.hashMb} MB)`);
} catch (e) {
  ctx.engineError = (e as Error).message;
  console.error(`[server] engine failed to start: ${ctx.engineError}`);
}
const db = new CacheDb();
ctx.games = createGameManager({ scheduler: ctx.scheduler, db, settings });
console.log(`[server] cache: ${db.path}`);
if (process.env.ANALYSIS_PROFILE) console.log(`[server] analysis profile: ${process.env.ANALYSIS_PROFILE}`);

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
