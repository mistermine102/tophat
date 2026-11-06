// Server entry: starts the Stockfish processes + scheduler and serves the API on PORT (default 5174).
// Environment:
//   PORT              HTTP port (default 5174)
//   CHESS_COACH_DB    sqlite cache path (default data/cache.sqlite)
//   STOCKFISH_PATH    engine binary (default engine/stockfish.exe)
//   ENGINE_THREADS    total Stockfish threads (default max(1, cpus - 2)), split over the processes
//   ENGINE_PROCESSES  Stockfish processes = plies analysed concurrently (default threads / 2, e.g. 5 x 2 threads)
//   ENGINE_HASH_MB    Stockfish Hash in MB per process (default 256)
//   ANALYSIS_PROFILE  `default` (full depth) or `fast` (reduced search budget, e.g. for E2E tests)
//   SERVE_CLIENT      `1`: also serve the built client (client/dist) on the same port (`npm start`)
import { existsSync } from 'node:fs';
import { analysisSettingsFor, clientDistDir, createApp, createGameManager, envInt, type AppContext } from './app';
import { CacheDb } from './cache';
import { createEnginePool } from './engine/pool';
import { Scheduler } from './engine/scheduler';
import { defaultEnginePath, engineAvailable } from './engine/uci';
import type { Searcher } from './analysis/searchCache';

const PORT = Number(process.env.PORT ?? 5174);
const settings = analysisSettingsFor(process.env.ANALYSIS_PROFILE);

const ctx: AppContext = { engine: null, engines: [], scheduler: null };
if (!engineAvailable()) {
  ctx.engineError = `Stockfish not found at ${defaultEnginePath()}`;
  console.error(
    [
      '',
      '  ┌──────────────────────────────────────────────────────────────────────┐',
      '  │  Stockfish is not installed. Run   npm run setup:engine   once, then  │',
      '  │  restart. (Or point STOCKFISH_PATH at an existing stockfish binary.)  │',
      '  └──────────────────────────────────────────────────────────────────────┘',
      `  looked for: ${defaultEnginePath()}`,
      '  The app still opens, but games cannot be analysed until the engine is there.',
      '',
    ].join('\n'),
  );
} else {
  try {
    const pool = await createEnginePool({ threads: envInt(process.env.ENGINE_THREADS), processes: envInt(process.env.ENGINE_PROCESSES), hashMb: envInt(process.env.ENGINE_HASH_MB) });
    ctx.engines = pool.engines;
    ctx.engine = pool.engines[0]!;
    ctx.scheduler = new Scheduler<Searcher>(pool.engines);
    console.log(`[server] engine: ${ctx.engine.name} (${pool.engines.length} process${pool.engines.length > 1 ? 'es' : ''} × ${pool.threadsPerEngine} threads, hash ${ctx.engine.hashMb} MB each)`);
  } catch (e) {
    ctx.engineError = (e as Error).message;
    console.error(`[server] engine failed to start: ${ctx.engineError}`);
  }
}
const db = new CacheDb();
ctx.games = createGameManager({ scheduler: ctx.scheduler, db, settings });
console.log(`[server] cache: ${db.path}`);
if (process.env.ANALYSIS_PROFILE) console.log(`[server] analysis profile: ${process.env.ANALYSIS_PROFILE}`);
if (process.env.SERVE_CLIENT === '1') {
  if (existsSync(clientDistDir())) ctx.serveClient = clientDistDir();
  else console.error(`[server] SERVE_CLIENT=1 but ${clientDistDir()} does not exist — run \`npm run build\` first`);
}

// Express 5 calls the listen callback with the error too (e.g. EADDRINUSE)
const server = createApp(ctx).listen(PORT, (err?: Error) => {
  if (err) {
    const e = err as NodeJS.ErrnoException;
    console.error(e.code === 'EADDRINUSE' ? `[server] port ${PORT} is already in use — is Chess Coach already running? (set PORT to use another port)` : `[server] ${e.message}`);
    void shutdown(1);
    return;
  }
  const where = `http://localhost:${PORT}`;
  console.log(ctx.serveClient ? `[server] Chess Coach is running — open ${where}` : `[server] listening on ${where}`);
});

let shuttingDown = false;
async function shutdown(code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  await Promise.all((ctx.engines ?? []).map((e) => e.quit().catch(() => undefined)));
  db.close();
  process.exit(code);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
