// Latency of side-line moves (what you wait for after dragging a piece in the review), engines otherwise idle.
// From positions spread over the game, plays an engine alternative to the game's move and then `--plies` more moves
// of that line (the engine's reply / continuation), analysing each like the client's /api/analyse, with a cold
// cache. Prints the wait per move and where the time went (analyzeMove timings).
//
// Usage: npx tsx server/scripts/sideline-timing.ts <file.pgn> [--depth N] [--starts 6] [--plies 3]

import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { type AnalysisSettings, DEFAULT_SETTINGS, type MoveAnalysis } from '@chess-coach/shared';
import { SearchCache, type Searcher } from '../src/analysis/searchCache';
import { CacheDb } from '../src/cache';
import { createEnginePool } from '../src/engine/pool';
import { Scheduler } from '../src/engine/scheduler';
import { GameManager } from '../src/games';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args[0];
if (!file || file.startsWith('--')) {
  console.error('usage: npx tsx server/scripts/sideline-timing.ts <file.pgn> [--depth N] [--starts 6] [--plies 3]');
  process.exit(2);
}
const settings: AnalysisSettings = structuredClone(DEFAULT_SETTINGS);
if (opt('depth')) settings.budget.deep.depth = Number(opt('depth'));
const starts = Number(opt('starts') ?? 6);
const plies = Number(opt('plies') ?? 3);

const db = new CacheDb(join(mkdtempSync(join(os.tmpdir(), 'chess-coach-sideline-')), 'cache.sqlite'));
const pool = await createEnginePool({});
const engines = pool.engines.map((e) => ({ search: (req: Parameters<Searcher['search']>[0]) => e.search(req), abort: () => e.abort() }));
const games = new GameManager({ db, searchCache: new SearchCache(db), scheduler: new Scheduler<Searcher>(engines, { preempt: true }), settings });

const info = games.importPgn(readFileSync(file, 'utf8'));
await games.whenDone(info.id); // the game itself is analysed first (as when you start trying moves)

const rows: { ms: number; t: Record<string, number> }[] = [];
for (let k = 0; k < starts; k++) {
  const ply = Math.max(1, Math.round(((k + 0.5) * info.moves.length) / starts)); // 1-based ply whose move we replace
  const m = info.moves[ply - 1]!;
  const base = await games.analyse({ fenBefore: m.fenBefore, uci: m.uci });
  // an alternative the user might try: the engine's 2nd choice, else its best if the game move was the best
  const alt = base.candidates.find((c) => c.uci !== m.uci)?.uci;
  if (!alt) continue;
  let fen = m.fenBefore;
  let uci = alt;
  let prev: { fenBefore: string; uci: string } | undefined = ply > 1 ? { fenBefore: info.moves[ply - 2]!.fenBefore, uci: info.moves[ply - 2]!.uci } : undefined;
  const line: string[] = [];
  for (let i = 0; i <= plies; i++) {
    const t = performance.now();
    const a: MoveAnalysis = await games.analyse({ fenBefore: fen, uci, ...(prev ? { prev } : {}) });
    const ms = performance.now() - t;
    rows.push({ ms, t: a.timings ?? {} });
    line.push(`${a.san} ${(ms / 1000).toFixed(1)}s`);
    const next = a.played.pvUci[1];
    if (!next) break;
    prev = { fenBefore: fen, uci };
    fen = a.fenAfter;
    uci = next;
  }
  console.log(`ply ${ply}: ${line.join(' · ')}`);
}

const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
const pct = (p: number) => (ms[Math.min(ms.length - 1, Math.floor(p * ms.length))]! / 1000).toFixed(2);
console.log(`\nd${settings.budget.deep.depth}: ${rows.length} side-line moves — median ${pct(0.5)} s, p90 ${pct(0.9)} s, max ${pct(1)} s`);
const sum: Record<string, number> = {};
for (const r of rows) for (const [k, v] of Object.entries(r.t)) sum[k] = (sum[k] ?? 0) + v;
console.log('mean per move (ms):', Object.entries(sum).map(([k, v]) => `${k} ${Math.round(v / rows.length)}`).join(', '));
process.exit(0);
