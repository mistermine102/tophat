// Label benchmark: our move labels on the 60 Lichess games (bench/games/lichess, ~1500-1600 players, Lichess
// server analysis) vs Lichess' judgements; distribution, material-rule / mate-rule firings, Great / Miss lists,
// stability and depth trade-off. Report: bench/reports/labels.md (see `report`).
//
// Labels are computed by `labelMove` (server/src/analysis/label.ts) — the same function analyzeMove uses — so they
// are the product's labels; only the explanation searches (shallow / threat / forcedness) are skipped. Every
// engine search goes through SearchCache with a per-tag sqlite db, so re-running after a classify.ts change costs
// no engine time (labels are re-derived from cached searches).
//
//   npx tsx bench/label-benchmark.ts run    [--tag d18] [--depth 18] [--max-ms 5000|0] [--n 60] [--games id,id]
//                                           [--threads 5] [--hash 512] [--fresh] [--db-tag other] [--verify-margin 1|0]
//                                           [--set great.maxWinAfterBest=70,...]  (numeric settings overrides) [--max-nodes N]
//                                           [--cache-only]  (never start the engine: uncached plies become errors)
//                                           [--parallel N]  (N engine processes, N games at a time; M4)
//   npx tsx bench/label-benchmark.ts report [--main d18] [--cold cold] [--depths d16,d18,d22] [--ref d22]
//                                           [--verify d18v,coldv]
//
// run:    plays every game ply by ply like games.ts (prev = ply N-1 with its result; book chain), for two
//         threshold profiles: `default` (DEFAULT_SETTINGS) and `lichess` (Lichess' thresholds on our winLoss:
//         Inaccuracy >= 5, Mistake >= 10, Blunder >= 15 win% — lila's 0.1/0.2/0.3 winningChances). Also searches
//         fenAfter of the last ply, so every position has our eval. Writes data/bench/labels-<tag>.json.
//         --fresh deletes the tag's db first (cold cache). --max-ms 0 = no time cap (depth only).
// report: reads the JSONs and writes bench/reports/labels.md (+ labels-details.md with full lists).

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AnalysisSettings, type Color, DEFAULT_SETTINGS, type Label, type MoveAnalysis, type Score, toWhitePov } from '@chess-coach/shared';
import { type LabelWork, type PrevResult, deepParams, labelMove } from '../core/src/analysis/label';
import { SearchCache, type Searcher } from '../core/src/analysis/searchCache';
import { bookInfo } from '../core/src/analysis/book';
import { CacheDb } from '../core/src/cache';
import { playMove, positionStatus, pvToSan } from '../core/src/chess/notation';
import { Engine, type SearchResult } from '../core/src/engine/uci';
import { type Judgement, type LichessScore, parseLichessGame } from './lib/lichessPgn';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const GAMES_DIR = join(here, 'games', 'lichess');
const OUT_DIR = join(ROOT, 'data', 'bench');

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name: string, def?: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
const flag = (name: string) => argv.includes(`--${name}`);

// ---------------------------------------------------------------------------------------------------------------
// Profiles

export type ProfileName = 'default' | 'lichess';

export function profileSettings(name: ProfileName, base: AnalysisSettings): AnalysisSettings {
  const s = structuredClone(base);
  if (name === 'lichess') {
    // lila Advice.scala: winningChances drop >= 0.1 / 0.2 / 0.3 (= 5 / 10 / 15 win%) -> Inaccuracy / Mistake / Blunder
    s.labels = { ...s.labels, goodMaxLoss: 5, inaccuracyMaxLoss: 10, mistakeMaxLoss: 15 };
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Run records

export interface PlyLabel {
  label: Label;
  winChance: Label;
  winLoss: number;
  reason: MoveAnalysis['labelReason'];
  /** The label came from the near-threshold verification search. */
  verified?: boolean;
}

export interface PlyRecord {
  ply: number;
  san: string;
  uci: string;
  color: Color;
  fenBefore: string;
  legalMoves: number;
  /** Mover POV deep scores. */
  bestScore: Score;
  playedScore: Score;
  secondScore?: Score;
  bestUci: string;
  bestSan: string;
  secondSan?: string;
  playedRank: number; // 1-based, 0 = from searchmoves
  winBest: number;
  winPlayed: number;
  playedPvSan: string[];
  bestPvSan: string[];
  /** Our evals, White POV: before = deep best at fenBefore, after = deep best at fenAfter (next ply). */
  evalBefore: Score;
  evalAfter?: Score;
  deep: { depth: number; timeMs: number; nodes: number };
  searchmoves?: { depth: number; timeMs: number; nodes: number };
  labels: Record<ProfileName, PlyLabel>;
  lichess: { judgement?: Judgement; evalAfter?: LichessScore; comment?: string; best?: string };
  book: boolean;
}

export interface GameRecord {
  id: string;
  white: string;
  black: string;
  plies: PlyRecord[];
  /** Engine time of every search this game needed (from the cached SearchResult.timeMs, so stable on re-runs). */
  engineMs: number;
  wallMs: number;
  errors: string[];
}

export interface RunFile {
  tag: string;
  depth: number;
  maxMs: number;
  threads: number;
  engine: string;
  createdAt: string;
  games: GameRecord[];
  stats: { hits: number; misses: number; engineMs: number };
}

/** Lazily started engine: a run whose searches are all cached never starts Stockfish. */
class LazySearcher implements Searcher {
  private engine: Promise<Engine> | null = null;
  constructor(private readonly opts: { threads: number; hashMb: number; cacheOnly?: boolean }) {}
  get started() {
    return this.engine !== null;
  }
  async search(req: Parameters<Searcher['search']>[0]): Promise<SearchResult> {
    if (this.opts.cacheOnly) throw new Error('not in the search cache (--cache-only)');
    this.engine ??= Engine.start(this.opts);
    return (await this.engine).search(req);
  }
  async name(): Promise<string> {
    return this.engine ? (await this.engine).name : 'Stockfish (not started: all searches cached)';
  }
  async quit(): Promise<void> {
    if (this.engine) await (await this.engine).quit();
  }
}

function listGames(): string[] {
  const idx = JSON.parse(readFileSync(join(GAMES_DIR, 'index.json'), 'utf8')) as { id: string }[];
  return idx.map((g) => g.id);
}

async function runGame(id: string, settings: AnalysisSettings, cache: SearchCache, searcher: LazySearcher): Promise<GameRecord> {
  const t0 = performance.now();
  const lg = parseLichessGame(readFileSync(join(GAMES_DIR, `${id}.pgn`), 'utf8'));
  const searches = new Map<string, SearchResult>();
  const search = async (name: string, fen: string, p: Parameters<SearchCache['search']>[2]) => {
    const o = await cache.search(searcher, fen, p);
    searches.set(SearchCache.key(fen, p), o.result);
    return o.result;
  };
  const rec: GameRecord = { id, white: lg.headers.White ?? '?', black: lg.headers.Black ?? '?', plies: [], engineMs: 0, wallMs: 0, errors: [] };
  const profiles: ProfileName[] = ['default', 'lichess'];
  const prevResults: Record<ProfileName, PrevResult | null> = { default: null, lichess: null };
  let chain = true;
  for (let i = 0; i < lg.plies.length; i++) {
    const p = lg.plies[i]!;
    const prev = i > 0 ? lg.plies[i - 1]! : null;
    let work: LabelWork | null = null;
    const labels = {} as Record<ProfileName, PlyLabel>;
    try {
      for (const prof of profiles) {
        const s = profileSettings(prof, settings);
        const w = await labelMove(s, search, {
          fenBefore: p.fenBefore,
          uci: p.uci,
          prev: prev ? { fenBefore: prev.fenBefore, uci: prev.uci, result: prevResults[prof] } : null,
          earlierMovesAllBook: chain,
        });
        work ??= w;
        labels[prof] = { label: w.cr.label, winChance: w.cr.labelReason.winChance, winLoss: w.cr.winLoss, reason: w.cr.labelReason, ...(w.verified ? { verified: true } : {}) };
        prevResults[prof] = { winLoss: w.cr.winLoss, winBefore: w.cr.winBest, label: w.cr.label };
      }
    } catch (e) {
      rec.errors.push(`ply ${p.ply}: ${(e as Error).message}`);
      prevResults.default = prevResults.lichess = null;
      continue;
    }
    const b = bookInfo(p.fenBefore, work!.played.fenAfter);
    chain = chain && b.after !== null && b.beforeIsStartOrBook;
    const w = work!;
    const fen = w.fen;
    const deep = searches.get(SearchCache.key(fen, deepParams(settings)))!;
    const smKey = SearchCache.key(fen, { ...deepParams(settings), multipv: 1, searchmoves: [w.played.uci] });
    const sm = searches.get(smKey);
    const second = w.lines[1];
    const playedRank = w.lines.findIndex((l) => l.move === w.playedLine.move) + 1;
    rec.plies.push({
      ply: p.ply,
      san: w.played.san,
      uci: w.played.uci,
      color: w.mover,
      fenBefore: fen,
      legalMoves: w.legalMoves,
      bestScore: w.best.score,
      playedScore: w.playedLine.score,
      ...(second ? { secondScore: second.score, secondSan: pvToSan(fen, [second.move])[0] } : {}),
      bestUci: w.best.move,
      bestSan: pvToSan(fen, [w.best.move])[0] ?? w.best.move,
      playedRank,
      winBest: w.cr.winBest,
      winPlayed: w.cr.winPlayed,
      playedPvSan: pvToSan(fen, w.playedLine.pv.slice(0, 12)),
      bestPvSan: pvToSan(fen, w.best.pv.slice(0, 12)),
      evalBefore: toWhitePov(w.best.score, w.mover),
      deep: { depth: deep.depth, timeMs: deep.timeMs, nodes: deep.nodes },
      ...(sm ? { searchmoves: { depth: sm.depth, timeMs: sm.timeMs, nodes: sm.nodes } } : {}),
      labels,
      lichess: {
        ...(p.judgement ? { judgement: p.judgement } : {}),
        ...(p.evalAfter ? { evalAfter: p.evalAfter } : {}),
        ...(p.comment ? { comment: p.comment } : {}),
        ...(p.lichessBest ? { best: p.lichessBest } : {}),
      },
      book: w.cr.label === 'book',
    });
  }
  // evalAfter of every ply = evalBefore of the next one; the last ply's fenAfter is searched once
  for (let i = 0; i < rec.plies.length; i++) {
    const r = rec.plies[i]!;
    const next = rec.plies[i + 1];
    if (next && next.ply === r.ply + 1) r.evalAfter = next.evalBefore;
  }
  const last = lg.plies[lg.plies.length - 1]!;
  const lastRec = rec.plies[rec.plies.length - 1];
  if (lastRec && lastRec.ply === last.ply) {
    const fenAfter = playMove(last.fenBefore, last.uci).fenAfter;
    const st = positionStatus(fenAfter);
    const opp: Color = last.color === 'white' ? 'black' : 'white';
    if (st === 'checkmate') lastRec.evalAfter = toWhitePov({ mate: 0 }, opp);
    else if (st === 'stalemate') lastRec.evalAfter = { cp: 0 };
    else {
      try {
        const r = await search('final', fenAfter, deepParams(settings));
        if (r.lines[0]) lastRec.evalAfter = toWhitePov(r.lines[0].score, opp);
      } catch (e) {
        rec.errors.push(`final position: ${(e as Error).message}`);
      }
    }
  }
  for (const r of searches.values()) rec.engineMs += r.timeMs;
  rec.wallMs = Math.round(performance.now() - t0);
  return rec;
}

async function run(): Promise<void> {
  const depth = Number(opt('depth', String(DEFAULT_SETTINGS.budget.deep.depth)));
  const maxMs = Number(opt('max-ms', String(DEFAULT_SETTINGS.budget.deep.maxMs)));
  const tag = opt('tag', `d${depth}`)!;
  const threads = Number(opt('threads', '5'));
  const hashMb = Number(opt('hash', '512'));
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.budget.deep.depth = depth;
  settings.budget.deep.maxMs = maxMs; // 0 -> no cap (SearchCache omits movetime)
  if (opt('max-nodes')) settings.budget.deep.maxNodes = Number(opt('max-nodes')); // optional node cap
  if (opt('verify-margin') !== undefined) settings.budget.verify.margin = Number(opt('verify-margin')); // 0 = off
  // --set great.maxWinAfterBest=70,mate.allowedMaxMoves=2 : experiment with label settings (re-derived from cache)
  for (const kv of opt('set')?.split(',') ?? []) {
    const [path, value] = kv.split('=') as [string, string];
    const keys = path.split('.');
    let o = settings as unknown as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
    if (typeof o[keys.at(-1)!] !== 'number') throw new Error(`--set: ${path} is not a numeric setting`);
    o[keys.at(-1)!] = Number(value);
  }
  let ids = listGames();
  const only = opt('games');
  if (only) ids = only.split(',');
  const n = Number(opt('n', String(ids.length)));
  ids = ids.slice(0, n);

  mkdirSync(OUT_DIR, { recursive: true });
  const dbPath = join(OUT_DIR, `labels-${opt('db-tag', tag)}.sqlite`); // --db-tag: re-derive from another run's searches
  if (flag('fresh')) for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
  const db = new CacheDb(dbPath);
  const cache = new SearchCache(db);
  // --parallel N (M4): N engine processes (each --threads), N games at a time — the product's CPU conditions with
  // ENGINE_PROCESSES=N. Games are written in their listed order.
  const parallel = Math.max(1, Number(opt('parallel', '1')));
  const searchers = Array.from({ length: parallel }, () => new LazySearcher({ threads, hashMb, cacheOnly: flag('cache-only') }));
  const out: RunFile = { tag, depth, maxMs, threads, engine: '', createdAt: new Date().toISOString(), games: [], stats: cache.stats };
  if (parallel > 1) (out as RunFile & { parallel?: number }).parallel = parallel;
  const jsonPath = join(OUT_DIR, `labels-${tag}.json`);
  const t0 = performance.now();
  const results = new Map<string, GameRecord>();
  let nextIdx = 0;
  let finished = 0;
  const worker = async (searcher: LazySearcher) => {
    while (nextIdx < ids.length) {
      const id = ids[nextIdx++]!;
      const g = await runGame(id, settings, cache, searcher);
      results.set(id, g);
      finished++;
      const counts: Record<string, number> = {};
      for (const p of g.plies) counts[p.labels.default.label] = (counts[p.labels.default.label] ?? 0) + 1;
      process.stderr.write(`[${finished}/${ids.length}] ${id} ${g.plies.length} plies, engine ${(g.engineMs / 1000).toFixed(0)} s, wall ${(g.wallMs / 1000).toFixed(0)} s ${g.errors.length ? `ERRORS ${g.errors.join('; ')}` : ''} ${JSON.stringify(counts)}\n`);
      out.engine = searcher.started ? await searcher.name() : (db.get<{ name: string }>('settings', 'bench-engine')?.name ?? 'Stockfish (all searches from the cache)');
      if (searcher.started) db.put('settings', 'bench-engine', { name: out.engine });
      out.games = ids.filter((x) => results.has(x)).map((x) => results.get(x)!);
      writeFileSync(jsonPath, JSON.stringify(out));
    }
  };
  await Promise.all(searchers.map(worker));
  process.stderr.write(`done ${tag}: ${ids.length} games in ${((performance.now() - t0) / 1000).toFixed(0)} s; searches ${cache.stats.misses} run, ${cache.stats.hits} cached -> ${jsonPath}\n`);
  await Promise.all(searchers.map((s) => s.quit()));
  db.close();
}

// ---------------------------------------------------------------------------------------------------------------

if (cmd === 'run') await run();
else if (cmd === 'report') {
  const { report } = await import('./lib/labelReport');
  report({ outDir: OUT_DIR, reportDir: join(here, 'reports'), main: opt('main', 'd18')!, cold: opt('cold'), depths: opt('depths')?.split(','), ref: opt('ref'), verify: opt('verify')?.split(',') });
} else {
  console.error('usage: npx tsx bench/label-benchmark.ts run|report [options] (see the file header)');
  process.exit(2);
}
