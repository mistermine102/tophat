// Performance profile of a full game analysis (cold cache), the same GameManager pipeline the app runs (here with Node engines).
//
// Usage: npx tsx core/scripts/profile-game.ts <file.pgn> [--threads 10] [--processes 1] [--hash 512] [--depth N]
//          [--probe] [--no-preempt] [--json out.json] [--label name]
//   --threads    total Stockfish threads (split evenly over the processes; default cpus - 2)
//   --processes  engine processes = background jobs running concurrently (default: server default)
//   --hash       Hash MB per process (default 512)
//   --probe      latency probes while the background analysis runs: at 15 s focus the ply at 2/3 of the game and
//                time it; when it is done, analyse a side-line move (an alternative to the next ply's move) and a
//                reply to it, timed like the client's /api/analyse.
//
// Prints (stderr) wall time, time to the first label, per-search-type engine time and counts, per-ply timing
// percentiles and the probe latencies; --json writes the raw numbers.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { type AnalysisSettings, DEFAULT_SETTINGS, type MoveAnalysis } from '@chess-coach/shared';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeUci } from 'chessops/util';
import { SearchCache, type Searcher } from '../src/analysis/searchCache';
import { defaultThreads } from '../src/node';
import { CacheDb } from '../src/cache';
import { createEnginePool } from '../src/engine/pool';
import { Scheduler } from '../src/engine/scheduler';
import type { SearchResult } from '../src/engine/uci';
import { GameManager } from '../src/games';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name: string) => args.includes(`--${name}`);
const VALUE_OPTS = new Set(['--threads', '--processes', '--hash', '--depth', '--json', '--label']);
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_OPTS.has(args[i - 1]!)));
if (!file) {
  console.error('usage: npx tsx core/scripts/profile-game.ts <file.pgn> [--threads N] [--processes N] [--hash MB] [--depth N] [--probe] [--json out.json]');
  process.exit(2);
}

const settings: AnalysisSettings = structuredClone(DEFAULT_SETTINGS);
if (opt('depth')) settings.budget.deep.depth = Number(opt('depth'));
const B = settings.budget;

/** Search category from its parameters (the budget entries differ in depth / MultiPV / searchmoves). */
function category(req: { depth?: number; multipv?: number; searchmoves?: string[] }): string {
  const sm = req.searchmoves?.length ? '+sm' : '';
  if (req.depth === B.deep.depth) return `deep${sm}`;
  if (req.depth === B.shallow.depth) return `shallow${sm}`;
  if (req.depth === B.forcedness.depth && req.multipv === B.forcedness.multipv && !sm) return 'forcedness';
  if (req.depth === B.threat.depth) return `threat${sm}`;
  return `other(d${req.depth} m${req.multipv}${sm})`;
}
const byCat = new Map<string, { n: number; ms: number; capped: number }>();
function tally(req: { depth?: number; multipv?: number; searchmoves?: string[]; movetimeMs?: number }, r: SearchResult): void {
  const c = category(req);
  const e = byCat.get(c) ?? { n: 0, ms: 0, capped: 0 };
  e.n++;
  e.ms += r.timeMs;
  if (req.movetimeMs && r.timeMs >= req.movetimeMs - 20 && (req.depth ?? 0) > r.depth) e.capped++;
  byCat.set(c, e);
}

const dir = mkdtempSync(join(os.tmpdir(), 'chess-coach-profile-'));
const db = new CacheDb(join(dir, 'cache.sqlite'));
const processes = opt('processes') ? Number(opt('processes')) : undefined;
const pool = await createEnginePool({
  threads: opt('threads') ? Number(opt('threads')) : defaultThreads(),
  ...(processes ? { processes } : {}),
  ...(opt('hash') ? { hashMb: Number(opt('hash')) } : {}),
});
const engines = pool.engines.map((e) => ({
  search: async (req: Parameters<Searcher['search']>[0]) => {
    const r = await e.search(req);
    tally(req, r);
    return r;
  },
  abort: () => e.abort(),
}));
const scheduler = new Scheduler<Searcher>(engines, { preempt: !flag('no-preempt') });
const searchCache = new SearchCache(db);
const games = new GameManager({ db, searchCache, scheduler, settings });

const pgn = readFileSync(file, 'utf8');
const t0 = performance.now();
const info = await games.importPgn(pgn);
const n = info.moves.length;
const doneAt = new Map<number, number>();
let first = 0;
const waiters = new Map<number, () => void>();
await games.subscribe(info.id, (e) => {
  if (e.type === 'analysis' && !doneAt.has(e.ply)) {
    const t = performance.now() - t0;
    if (!first) first = t;
    doneAt.set(e.ply, t);
    waiters.get(e.ply)?.();
  } else if (e.type === 'error') process.stderr.write(`  ply ${e.ply} ERROR ${e.message}\n`);
});
const plyDone = (ply: number) => (doneAt.has(ply) ? Promise.resolve() : new Promise<void>((r) => waiters.set(ply, r)));

const probes: Record<string, number> = {};
async function probe(): Promise<void> {
  await new Promise((r) => setTimeout(r, 15_000));
  const P = Math.round((n * 2) / 3);
  if (doneAt.has(P)) return;
  const tf = performance.now();
  await games.focus(info.id, P);
  await plyDone(P);
  probes[`focus ply ${P}`] = performance.now() - tf;
  await plyDone(P + 1).catch(() => undefined);
  // side line: an alternative to ply P+1's move (its position is analysed now), then a reply to that
  const m = info.moves[P]!; // ply P+1
  if (!m) return;
  const pos = Chess.fromSetup(parseFen(m.fenBefore).unwrap()).unwrap();
  const alt = [...pos.allDests()].flatMap(([from, ds]) => [...ds].map((to) => makeUci({ from, to }))).find((u) => u !== m.uci)!;
  let ts = performance.now();
  const a1: MoveAnalysis = await games.analyse({ fenBefore: m.fenBefore, uci: alt, prev: { fenBefore: info.moves[P - 1]!.fenBefore, uci: info.moves[P - 1]!.uci } });
  probes[`side line ${a1.san}`] = performance.now() - ts;
  const reply = a1.best.uci === alt ? null : a1.played.pvUci[1];
  if (reply) {
    ts = performance.now();
    const a2 = await games.analyse({ fenBefore: a1.fenAfter, uci: reply, prev: { fenBefore: m.fenBefore, uci: alt } });
    probes[`side line reply ${a2.san}`] = performance.now() - ts;
  }
}
const probing = flag('probe') ? probe() : Promise.resolve();
await games.whenDone(info.id);
await probing;
const wallMs = performance.now() - t0;
const result = (await games.get(info.id))!;
await pool.quit();
db.close();
rmSync(dir, { recursive: true, force: true });

// --- report ------------------------------------------------------------------------------------------------------
const analyses = Object.values(result.analyses) as MoveAnalysis[];
const sumTiming = new Map<string, number>();
for (const a of analyses) for (const [k, v] of Object.entries(a.timings ?? {})) if (k !== 'cachedSearches') sumTiming.set(k, (sumTiming.get(k) ?? 0) + v);
const totals = analyses.map((a) => a.timings?.total ?? 0).sort((x, y) => x - y);
const pctl = (p: number) => totals[Math.min(totals.length - 1, Math.floor(p * totals.length))] ?? 0;
const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const label = opt('label') ?? `${pool.engines.length}x${pool.threadsPerEngine} threads, d${B.deep.depth}${flag('no-preempt') ? ', no preemption' : ''}`;
const lines: string[] = [];
lines.push(`## ${label} — ${file} (${n} plies)`);
lines.push(`wall ${s(wallMs)} (${(wallMs / 1000 / n).toFixed(2)} s/ply), first label after ${s(first)}, 10 plies after ${s([...doneAt.values()].sort((a, b) => a - b)[9] ?? 0)}`);
lines.push(`per-ply job time (incl. waits): median ${s(pctl(0.5))}, p90 ${s(pctl(0.9))}, max ${s(totals.at(-1) ?? 0)}`);
lines.push('| search | count | engine time | per search | capped |');
lines.push('|---|---|---|---|---|');
const engineTotal = [...byCat.values()].reduce((x, e) => x + e.ms, 0);
for (const [c, e] of [...byCat].sort((a, b) => b[1].ms - a[1].ms)) lines.push(`| ${c} | ${e.n} | ${s(e.ms)} (${((100 * e.ms) / engineTotal).toFixed(0)}%) | ${Math.round(e.ms / e.n)} ms | ${e.capped} |`);
lines.push(`| total | ${[...byCat.values()].reduce((x, e) => x + e.n, 0)} | ${s(engineTotal)} | | |`);
lines.push(`analyzeMove timings (sum over plies, job-local; with parallel jobs waits on another job's search are not counted): ${[...sumTiming].map(([k, v]) => `${k} ${s(v)}`).join(', ')}`);
if (Object.keys(probes).length) lines.push(`preemptions ${scheduler.preemptions}; probes: ${Object.entries(probes).map(([k, v]) => `${k} ${s(v)}`).join(', ')}`);
const labels: Record<string, number> = {};
for (const a of analyses) labels[a.label] = (labels[a.label] ?? 0) + 1;
lines.push(`labels: ${JSON.stringify(labels)}`);
process.stderr.write(lines.join('\n') + '\n');
const json = opt('json');
if (json) writeFileSync(json, JSON.stringify({ label, file, plies: n, wallMs, firstMs: first, doneAt: Object.fromEntries(doneAt), byCat: Object.fromEntries(byCat), sumTiming: Object.fromEntries(sumTiming), probes, labels: Object.fromEntries(analyses.map((a, i) => [i + 1, a.label])) }, null, 1));
