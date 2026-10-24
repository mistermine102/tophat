// Server entry: starts Stockfish + scheduler and serves the API on PORT (default 5174).
import { createApp, type AppContext } from './app';
import { Scheduler } from './engine/scheduler';
import { Engine } from './engine/uci';

const PORT = Number(process.env.PORT ?? 5174);

const ctx: AppContext = { engine: null, scheduler: null };
try {
  ctx.engine = await Engine.start();
  ctx.scheduler = new Scheduler(ctx.engine);
  console.log(`[server] engine: ${ctx.engine.name} (threads ${ctx.engine.threads}, hash ${ctx.engine.hashMb} MB)`);
} catch (e) {
  ctx.engineError = (e as Error).message;
  console.error(`[server] engine failed to start: ${ctx.engineError}`);
}

const server = createApp(ctx).listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  await ctx.engine?.quit().catch(() => undefined);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
