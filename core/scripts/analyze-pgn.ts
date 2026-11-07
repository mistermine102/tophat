// Full analysis pipeline on a PGN file (no HTTP), writing a human-readable markdown report.
//
// Usage: npx tsx core/scripts/analyze-pgn.ts <file.pgn> [--out report.md] [--json out.json]
//          [--db path.sqlite] [--fresh] [--depth N] [--threads N] [--processes N]
//   --db     cache database (default data/cache.sqlite or env CHESS_COACH_DB)
//   --fresh  ignore cached move analyses (engine searches stay cached) — use after changing facts/explain code
//   --depth  override the deep search depth (default settings: 16)
//   --threads Stockfish threads in total (default: cpus - 2)
//   --processes Stockfish processes = plies analysed concurrently (default threads / 2)
//
// The report lists every ply: SAN, label (+reason), eval before -> after, the three explanation levels, the
// suggestion ("Try this" / "Engine's top") as the UI shows it, candidates and timings; the game summary at the end.

import { readFileSync, writeFileSync } from 'node:fs';
import { type AnalysisSettings, type Candidate, DEFAULT_SETTINGS, type GameInfo, type GameSummary, type MoveAnalysis } from '@chess-coach/shared';
import { formatEval, LABEL_NAMES, SUGGESTION_TEXT } from '../src/analysis/explain';
import { SearchCache, type Searcher } from '../src/analysis/searchCache';
import { defaultThreads } from '../src/node';
import { CacheDb, defaultDbPath } from '../src/cache';
import { positionStatus } from '../src/chess/notation';
import { Scheduler } from '../src/engine/scheduler';
import { createEnginePool } from '../src/engine/pool';
import { GameManager } from '../src/games';

// ---------------------------------------------------------------------------------------------------------------

interface ReportMeta {
  wallMs: number;
  settings: AnalysisSettings;
  engineName: string;
  threads: number;
  stats: SearchCache['stats'];
  dbPath: string;
}

function moveNo(ply: number, color: 'white' | 'black', startPly: number): string {
  const n = Math.floor((ply - 1 + startPly) / 2) + 1;
  return color === 'white' ? `${n}.` : `${n}...`;
}

function levelLines(c: Candidate | null | undefined, indent = ''): string[] {
  const e = c?.explanation;
  if (!e) return [];
  return [
    `${indent}- *Immediate:* ${e.immediate.text.join(' ')}`,
    `${indent}- *Short term:* ${e.short.text.join(' ')}`,
    `${indent}- *Long term:* ${e.long.text.join(' ')}`,
  ];
}

const SHOWS_CONFIRMATION = new Set(['best', 'great', 'book', 'forced']);

function renderReport(game: GameInfo, analyses: Record<number, MoveAnalysis>, summary: GameSummary, meta: ReportMeta): string {
  const h = game.headers;
  const L: string[] = [];
  const startPly = game.startFen.split(' ')[1] === 'b' ? 1 : 0;
  L.push(`# ${h.White ?? '?'} vs ${h.Black ?? '?'} — ${h.Result ?? '*'}`);
  L.push('');
  L.push(`${[h.Event, h.Site, h.Date].filter(Boolean).join(' · ')}`);
  L.push('');
  const b = meta.settings.budget;
  L.push(`Engine ${meta.engineName}, ${meta.threads} threads; deep d${b.deep.depth} MultiPV ${b.deep.multipv}, shallow d${b.shallow.depth}, threat d${b.threat.depth}, forcedness d${b.forcedness.depth}.`);
  const n = game.moves.length;
  L.push(`Wall time ${(meta.wallMs / 1000).toFixed(1)} s for ${n} plies (${(meta.wallMs / 1000 / n).toFixed(2)} s/ply); engine searches run ${meta.stats.misses} (${(meta.stats.engineMs / 1000).toFixed(1)} s engine time), served from cache ${meta.stats.hits}.`);
  L.push('');
  L.push('## Summary');
  L.push('');
  const labels = Object.keys(LABEL_NAMES) as (keyof typeof LABEL_NAMES)[];
  L.push(`| | White (${h.White ?? '?'}) | Black (${h.Black ?? '?'}) |`);
  L.push('|---|---|---|');
  L.push(`| Accuracy | ${summary.white.accuracy?.toFixed(1) ?? '–'} | ${summary.black.accuracy?.toFixed(1) ?? '–'} |`);
  for (const l of labels) {
    const w = summary.white.counts[l] ?? 0;
    const bl = summary.black.counts[l] ?? 0;
    if (w || bl) L.push(`| ${LABEL_NAMES[l]} | ${w} | ${bl} |`);
  }
  L.push('');
  L.push('## Moves');
  L.push('');
  for (const m of game.moves) {
    const a = analyses[m.ply];
    const num = moveNo(m.ply, m.color, startPly);
    if (!a) {
      L.push(`### ${num} ${m.san} — (not analysed)`, '');
      continue;
    }
    L.push(`### ${num} ${a.san} — ${LABEL_NAMES[a.label]}`);
    L.push('');
    L.push(`${a.labelText ?? ''}`);
    L.push('');
    const after = positionStatus(a.fenAfter) === 'checkmate' ? 'checkmate' : formatEval(a.evalAfter);
    L.push(`Eval ${formatEval(a.evalBefore)} → ${after} · ${a.color === 'white' ? 'White' : 'Black'}'s win% ${a.winBefore.toFixed(0)} → ${a.winAfter.toFixed(0)} · winLoss ${a.winLoss.toFixed(1)} · accuracy ${a.accuracy.toFixed(0)}`);
    L.push('');
    L.push(...levelLines(a.played));
    L.push('');
    if (SHOWS_CONFIRMATION.has(a.label)) {
      L.push(`${a.verdictText ?? ''}`);
    } else if (a.deepOnly) {
      L.push(`**Engine's top:** ${a.best.san} — ${SUGGESTION_TEXT.deepOnly} (${a.best.pv.slice(0, 6).join(' ')})`);
      L.push(...levelLines(a.best, '  '));
    } else if (a.pickIsBest && a.pick) {
      L.push(`**Engine's top:** ${a.pick.san} (${a.pick.pv.slice(0, 6).join(' ')})`);
      L.push(...levelLines(a.pick, '  '));
    } else if (a.pick) {
      L.push(`**Try this:** ${a.pick.san} (${a.pick.pv.slice(0, 6).join(' ')}; ${SUGGESTION_TEXT.lossVsBest(a.pick.winLoss)})`);
      L.push(...levelLines(a.pick, '  '));
      L.push(`**Engine's top:** ${a.best.san} (${a.best.pv.slice(0, 6).join(' ')})`);
      L.push(...levelLines(a.best, '  '));
    }
    L.push('');
    const cands = a.candidates
      .map((c) => `${c.san} ${formatEval(c.score)}${c.explainable ? ' ✓' : ` ✗(${(c.notExplainableReasons ?? []).join(',')})`}`)
      .join(' · ');
    L.push(`<sub>Candidates: ${cands}</sub>`);
    const t = a.timings ?? {};
    const ms = (k: string) => (t[k] ? `${k} ${(t[k]! / 1000).toFixed(2)}s` : null);
    L.push(`<sub>Timings: ${['total', 'deep', 'deepAfter', 'searchmoves', 'shallow', 'threat', 'forcedness', 'prev', 'facts'].map(ms).filter(Boolean).join(', ')}; cached searches ${t.cachedSearches ?? 0}</sub>`);
    L.push('');
  }
  return L.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// main

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name: string) => args.includes(`--${name}`);
const VALUE_OPTS = new Set(['--out', '--json', '--db', '--depth', '--threads', '--processes']);
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_OPTS.has(args[i - 1]!)));
if (!file) {
  console.error('usage: npx tsx core/scripts/analyze-pgn.ts <file.pgn> [--out report.md] [--json out.json] [--db path] [--fresh] [--depth N]');
  process.exit(2);
}

const settings: AnalysisSettings = structuredClone(DEFAULT_SETTINGS);
if (opt('depth')) settings.budget.deep.depth = Number(opt('depth'));

const pgn = readFileSync(file, 'utf8');
const dbPath = opt('db') ?? defaultDbPath();
const fileDb = new CacheDb(dbPath);
const gameDb = flag('fresh') ? new CacheDb(':memory:') : fileDb;
const pool = await createEnginePool({ threads: opt('threads') ? Number(opt('threads')) : defaultThreads(), ...(opt('processes') ? { processes: Number(opt('processes')) } : {}) });
const engine = pool.engines[0]!;
const scheduler = new Scheduler<Searcher>(pool.engines);
const searchCache = new SearchCache(fileDb);
const games = new GameManager({ db: gameDb, searchCache, scheduler, settings });

const t0 = performance.now();
const info = await games.importPgn(pgn);
let done = 0;
await games.subscribe(info.id, (e) => {
  if (e.type === 'analysis') {
    done++;
    const a = e.analysis;
    process.stderr.write(`  ${String(e.ply).padStart(3)} ${a.san.padEnd(8)} ${a.label.padEnd(10)} ${((a.timings?.total ?? 0) / 1000).toFixed(1)}s  [${done}/${info.moves.length}]\n`);
  } else if (e.type === 'error') process.stderr.write(`  ${e.ply} ERROR ${e.message}\n`);
});
await games.whenDone(info.id);
const wallMs = performance.now() - t0;
const result = (await games.get(info.id))!;
await pool.quit();

const report = renderReport(info, result.analyses, result.summary, { wallMs, settings, engineName: engine.name, threads: pool.engines.length * pool.threadsPerEngine, stats: searchCache.stats, dbPath });
const out = opt('out');
if (out) writeFileSync(out, report);
else process.stdout.write(report);
const json = opt('json');
if (json) writeFileSync(json, JSON.stringify({ game: info, analyses: result.analyses, summary: result.summary, wallMs }, null, 1));
process.stderr.write(`done: ${info.moves.length} plies in ${(wallMs / 1000).toFixed(1)} s (${(wallMs / 1000 / info.moves.length).toFixed(2)} s/ply); engine searches: ${searchCache.stats.misses} run, ${searchCache.stats.hits} cached\n`);
fileDb.close();
