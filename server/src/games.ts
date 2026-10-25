// Games: PGN import -> GameInfo, per-game analysis state, the background queue, summaries and side-line analysis.
//
// - PGN: chessops parser, first game only; comments / clock annotations / NAGs / variations are ignored (main
//   line only); SetUp/FEN headers give the start position. Bad PGN (no game, no moves, illegal SAN, bad FEN,
//   non-standard variant) -> PgnImportError (HTTP 400).
// - Game id = sha1(start FEN + ' ' + UCI moves); the same game imported twice gets the same id. Games are
//   persisted (cache.ts `games`) so a restart can reload them by id.
// - you / orientation: settings.username vs the White/Black headers (case-insensitive); neither -> White.
// - Analysis of main-line ply N is one Scheduler job (key `move:<analysisKey>`), queued in game order at
//   BACKGROUND priority; `focus(ply)` bumps ply, ply+1 and ply-1 to FOCUS; side-line moves (`analyse`) run at SIDELINE.
//   Finished analyses are cached in sqlite under analysisKey (ARCHITECTURE.md "Cache"): re-importing or
//   reloading a game is instant.
// - Previous-move context for ply N: ply N-1's move (prev.fenBefore / prev.uci) and, when already analysed, its
//   result (winLoss, win%, label). Book chain: every earlier ply is a book position move (pure book check);
//   analyzeMove additionally breaks the chain if ply N-1 wasn't labelled Book.

import type { AnalysisSettings, Color, GameInfo, GameMove, GameSummary, Label, MoveAnalysis, Score, Settings, SideSummary } from '@chess-coach/shared';
import { ANALYSIS_VERSION, gameAccuracyFromScores, settingsHash } from '@chess-coach/shared';
import { makeFen } from 'chessops/fen';
import { emptyHeaders, parsePgn, parseVariant, startingPosition } from 'chessops/pgn';
import { makeSan, parseSan } from 'chessops/san';
import { type AnalyzeInput, type PrevResult, analyzeMove } from './analysis/analyzeMove';
import { bookInfo } from './analysis/book';
import type { SearchCache, Searcher } from './analysis/searchCache';
import { type CacheDb, sha1 } from './cache';
import { normalizeFen, playMove, standardUci } from './chess/notation';
import { Priority, type Scheduler } from './engine/scheduler';
import { EngineError } from './engine/uci';
import type { Chess } from 'chessops/chess';

export class PgnImportError extends Error {
  override name = 'PgnImportError';
}
export class BadRequestError extends Error {
  override name = 'BadRequestError';
}

export interface ParsedGame {
  id: string;
  headers: Record<string, string>;
  startFen: string;
  moves: GameMove[];
}

/** Parse the first game of a PGN (main line only). Throws PgnImportError. */
export function parseGamePgn(pgn: string): ParsedGame {
  if (typeof pgn !== 'string' || !pgn.trim()) throw new PgnImportError('empty PGN');
  const games = parsePgn(pgn, emptyHeaders);
  const g = games[0];
  if (!g) throw new PgnImportError('no game found in the PGN');
  const variant = g.headers.get('Variant');
  if (variant && parseVariant(variant) !== 'chess') throw new PgnImportError(`unsupported variant "${variant}"`);
  const start = startingPosition(g.headers);
  if (start.isErr) throw new PgnImportError(`bad start position (FEN header): ${start.error.message}`);
  const pos = start.value as Chess;
  if (pos.rules !== 'chess') throw new PgnImportError('only standard chess is supported');
  const startFen = makeFen(pos.toSetup());
  const moves: GameMove[] = [];
  let ply = 0;
  for (const node of g.moves.mainline()) {
    ply++;
    const move = parseSan(pos, node.san);
    if (!move) throw new PgnImportError(`illegal or unreadable move "${node.san}" at ply ${ply}`);
    const fenBefore = makeFen(pos.toSetup());
    const san = makeSan(pos, move);
    const p = playMove(fenBefore, standardUci(pos, move));
    pos.play(move);
    moves.push({ ply, san, uci: p.uci, color: p.color, fenBefore, fenAfter: makeFen(pos.toSetup()) });
  }
  if (moves.length === 0) throw new PgnImportError('no moves found — paste the whole PGN of a game (chess.com: Share → PGN)');
  const headers: Record<string, string> = {};
  for (const [k, v] of g.headers) headers[k] = v;
  const id = sha1(`${startFen} ${moves.map((m) => m.uci).join(' ')}`);
  return { id, headers, startFen, moves };
}

/** you / orientation from the username (case-insensitive match against the White/Black headers). */
export function youFor(headers: Record<string, string>, username: string | null): Color {
  const u = username?.trim().toLowerCase();
  if (u) {
    if (headers.White?.trim().toLowerCase() === u) return 'white';
    if (headers.Black?.trim().toLowerCase() === u) return 'black';
  }
  return 'white';
}

/** Cache key of one move analysis (ARCHITECTURE.md "Cache"). */
export function analysisKey(settingsKey: string, input: AnalyzeInput): string {
  const prevKey = input.prev ? `${normalizeFen(input.prev.fenBefore)}|${input.prev.uci}` : '-';
  const chain = input.earlierMovesAllBook === undefined ? 'u' : input.earlierMovesAllBook ? '1' : '0';
  return sha1(`${ANALYSIS_VERSION}|${settingsKey}|${normalizeFen(input.fenBefore)}|${input.uci}|${prevKey}|${chain}`);
}

export type GameEvent =
  | { type: 'analysis'; ply: number; analysis: MoveAnalysis }
  | { type: 'progress'; done: number; total: number }
  | { type: 'summary'; summary: GameSummary }
  | { type: 'error'; ply: number; message: string };
export type GameListener = (e: GameEvent) => void;

interface GameState {
  parsed: ParsedGame;
  inputs: AnalyzeInput[]; // index = ply - 1 (prev.result filled at run time)
  keys: string[];
  analyses: Map<number, MoveAnalysis>;
  errors: Map<number, string>;
  /** Plies whose analysis job is in flight (initial run or a focus retry of a failed ply). */
  retrying: Set<number>;
  listeners: Set<GameListener>;
  doneWaiters: (() => void)[];
}

export interface GameManagerDeps {
  db: CacheDb;
  searchCache: SearchCache;
  scheduler: Scheduler<Searcher> | null;
  settings: AnalysisSettings;
}

const DEFAULT_USER_SETTINGS: Settings = { username: null };

/** Analysis progress log (env `LOG_ANALYSIS=1`): finished plies with their run time, focus bumps. */
function log(msg: string): void {
  if (process.env.LOG_ANALYSIS === '1') console.log(`[analysis] ${new Date().toISOString().slice(11, 23)} ${msg}`);
}

export class GameManager {
  private games = new Map<string, GameState>();
  private readonly settingsKey: string;
  private injectedFailures = 0;

  constructor(private readonly deps: GameManagerDeps) {
    this.settingsKey = settingsHash(deps.settings);
  }

  // --- settings ---------------------------------------------------------------------------------------------

  getSettings(): Settings {
    return { ...DEFAULT_USER_SETTINGS, ...(this.deps.db.get<Settings>('settings', 'user') ?? {}) };
  }

  putSettings(body: unknown): Settings {
    if (!body || typeof body !== 'object') throw new BadRequestError('settings must be an object');
    const u = (body as { username?: unknown }).username;
    if (u !== null && u !== undefined && typeof u !== 'string') throw new BadRequestError('username must be a string or null');
    const username = typeof u === 'string' && u.trim() ? u.trim() : null;
    const s: Settings = { username };
    this.deps.db.put('settings', 'user', s);
    return s;
  }

  // --- games ------------------------------------------------------------------------------------------------

  info(id: string): GameInfo | null {
    const st = this.state(id);
    if (!st) return null;
    const you = youFor(st.parsed.headers, this.getSettings().username);
    return { ...st.parsed, you, orientation: you };
  }

  /** Import a PGN (first game). Enqueues every ply not cached yet. Throws PgnImportError. */
  importPgn(pgn: string): GameInfo {
    const parsed = parseGamePgn(pgn);
    if (!this.games.has(parsed.id)) {
      this.deps.db.put('games', parsed.id, parsed);
      this.load(parsed);
    }
    return this.info(parsed.id)!;
  }

  get(id: string): { game: GameInfo; analyses: Record<number, MoveAnalysis>; summary: GameSummary } | null {
    const game = this.info(id);
    if (!game) return null;
    const st = this.games.get(id)!;
    const analyses: Record<number, MoveAnalysis> = {};
    for (const [ply, a] of [...st.analyses].sort((x, y) => x[0] - y[0])) analyses[ply] = a;
    return { game, analyses, summary: this.summary(id)! };
  }

  /**
   * Bump ply and ply+1 to FOCUS priority, then ply-1 (M4: ply's label needs ply-1's deep search for the Miss
   * context — with several engines it runs in parallel instead of after ply's own search). Failed plies among
   * ply / ply+1 are re-queued. Returns false for an unknown game.
   */
  focus(id: string, ply: number): boolean {
    const st = this.state(id);
    if (!st) return false;
    const sched = this.deps.scheduler;
    const bumped: number[] = [];
    const retried: number[] = [];
    for (const p of [ply, ply + 1, ply - 1]) {
      const key = st.keys[p - 1];
      if (!key || !sched) continue;
      if (sched.bump(`move:${key}`, Priority.FOCUS)) bumped.push(p);
      else if (p >= ply && st.errors.has(p) && !st.retrying.has(p)) {
        // a failed ply is analysed again when the user looks at it (e.g. after an engine crash)
        retried.push(p);
        void this.analysePly(st, p, Priority.FOCUS);
      }
    }
    log(`focus ${id.slice(0, 8)} ply ${ply}: bumped [${bumped.join(', ')}]${retried.length ? ` retried [${retried.join(', ')}]` : ''}`);
    return true;
  }

  subscribe(id: string, listener: GameListener): () => void {
    const st = this.state(id);
    if (!st) throw new Error(`unknown game ${id}`);
    st.listeners.add(listener);
    return () => st.listeners.delete(listener);
  }

  /** Replay of the current state as events (for a new SSE subscriber). */
  snapshot(id: string): GameEvent[] {
    const st = this.state(id);
    if (!st) return [];
    const out: GameEvent[] = [];
    for (const [ply, analysis] of [...st.analyses].sort((a, b) => a[0] - b[0])) out.push({ type: 'analysis', ply, analysis });
    for (const [ply, message] of st.errors) out.push({ type: 'error', ply, message });
    const s = this.summary(id)!;
    out.push({ type: 'progress', done: s.done, total: s.total }, { type: 'summary', summary: s });
    return out;
  }

  summary(id: string): GameSummary | null {
    const st = this.state(id);
    if (!st) return null;
    return summarize(st.parsed, st.analyses);
  }

  /** Resolves when every ply is analysed (or failed). */
  whenDone(id: string): Promise<void> {
    const st = this.state(id);
    if (!st) return Promise.reject(new Error(`unknown game ${id}`));
    if (st.analyses.size + st.errors.size >= st.parsed.moves.length) return Promise.resolve();
    return new Promise((resolve) => st.doneWaiters.push(resolve));
  }

  /** Side-line (or any) single move analysis at SIDELINE priority. */
  async analyse(body: unknown): Promise<MoveAnalysis> {
    const b = body as { fenBefore?: unknown; uci?: unknown; prev?: { fenBefore?: unknown; uci?: unknown } | null };
    if (!b || typeof b.fenBefore !== 'string' || typeof b.uci !== 'string') throw new BadRequestError('body must be { fenBefore, uci, prev? }');
    let input: AnalyzeInput;
    try {
      const fenBefore = normalizeFen(b.fenBefore);
      const p = playMove(fenBefore, b.uci);
      let prev: AnalyzeInput['prev'] = null;
      if (b.prev) {
        if (typeof b.prev.fenBefore !== 'string' || typeof b.prev.uci !== 'string') throw new Error('prev must be { fenBefore, uci }');
        const pf = normalizeFen(b.prev.fenBefore);
        const pp = playMove(pf, b.prev.uci);
        if (normalizeFen(pp.fenAfter) !== fenBefore) throw new Error('prev move does not lead to fenBefore');
        prev = { fenBefore: pf, uci: pp.uci };
      }
      input = { fenBefore, uci: p.uci, prev };
    } catch (e) {
      throw new BadRequestError((e as Error).message);
    }
    return this.run(input, Priority.SIDELINE);
  }

  /** Test hook: the next `n` analysis attempts fail with an EngineError (each ply is tried twice). */
  injectFailures(n: number): void {
    this.injectedFailures = Math.max(0, Math.floor(n));
  }

  // --- internals --------------------------------------------------------------------------------------------

  private state(id: string): GameState | undefined {
    const st = this.games.get(id);
    if (st) return st;
    const parsed = this.deps.db.get<ParsedGame>('games', id);
    if (!parsed) return undefined;
    return this.load(parsed);
  }

  private load(parsed: ParsedGame): GameState {
    const inputs: AnalyzeInput[] = [];
    let chain = true;
    for (let i = 0; i < parsed.moves.length; i++) {
      const m = parsed.moves[i]!;
      const prevMove = i > 0 ? parsed.moves[i - 1]! : null;
      inputs.push({ fenBefore: m.fenBefore, uci: m.uci, prev: prevMove ? { fenBefore: prevMove.fenBefore, uci: prevMove.uci } : null, earlierMovesAllBook: chain });
      const b = bookInfo(m.fenBefore, m.fenAfter);
      chain = chain && b.after !== null && b.beforeIsStartOrBook;
    }
    const st: GameState = {
      parsed,
      inputs,
      keys: inputs.map((inp) => analysisKey(this.settingsKey, inp)),
      analyses: new Map(),
      errors: new Map(),
      retrying: new Set(),
      listeners: new Set(),
      doneWaiters: [],
    };
    this.games.set(parsed.id, st);
    for (let i = 0; i < inputs.length; i++) {
      const cached = this.deps.db.get<MoveAnalysis>('analyses', st.keys[i]!);
      if (cached) st.analyses.set(i + 1, cached);
    }
    for (let i = 0; i < inputs.length; i++) {
      if (st.analyses.has(i + 1)) continue;
      void this.analysePly(st, i + 1);
    }
    return st;
  }

  private async analysePly(st: GameState, ply: number, priority: Priority = Priority.BACKGROUND): Promise<void> {
    const input = st.inputs[ply - 1]!;
    st.retrying.add(ply);
    try {
      if (!this.deps.scheduler) throw new Error('engine not running');
      let started = 0;
      const analysis = await this.run(input, priority, () => {
        started = Date.now();
        // the previous ply's job stores its result before resolving, so the db has it even if our state lags
        const prev = st.analyses.get(ply - 1) ?? (ply > 1 ? this.deps.db.get<MoveAnalysis>('analyses', st.keys[ply - 2]!) : undefined);
        const result: PrevResult | null = prev ? { winLoss: prev.winLoss, winBefore: prev.winBefore, label: prev.label } : null;
        return input.prev ? { ...input, prev: { ...input.prev, result } } : input;
      });
      if (started) log(`game ${st.parsed.id.slice(0, 8)} ply ${ply} done in ${Date.now() - started} ms`);
      st.analyses.set(ply, analysis);
      st.errors.delete(ply);
      this.emit(st, { type: 'analysis', ply, analysis });
    } catch (e) {
      log(`game ${st.parsed.id.slice(0, 8)} ply ${ply} failed: ${(e as Error).message}`);
      st.errors.set(ply, (e as Error).message);
      this.emit(st, { type: 'error', ply, message: (e as Error).message });
    } finally {
      st.retrying.delete(ply);
    }
    const s = summarize(st.parsed, st.analyses);
    this.emit(st, { type: 'progress', done: s.done, total: s.total });
    this.emit(st, { type: 'summary', summary: s });
    if (st.analyses.size + st.errors.size >= st.parsed.moves.length) {
      const w = st.doneWaiters;
      st.doneWaiters = [];
      for (const f of w) f();
    }
  }

  /** Cached analysis, or a scheduler job (deduplicated by key). `finalInput` is evaluated when the job starts. */
  private run(input: AnalyzeInput, priority: Priority, finalInput: () => AnalyzeInput = () => input): Promise<MoveAnalysis> {
    const key = analysisKey(this.settingsKey, input);
    const cached = this.deps.db.get<MoveAnalysis>('analyses', key);
    if (cached) return Promise.resolve(cached);
    const sched = this.deps.scheduler;
    if (!sched) return Promise.reject(new Error('engine not running'));
    return sched.run(`move:${key}`, priority, async (engine) => {
      const again = this.deps.db.get<MoveAnalysis>('analyses', key);
      if (again) return again;
      const ctx = { searcher: engine, cache: this.deps.searchCache, settings: this.deps.settings };
      const inp = finalInput();
      const attempt = () => {
        if (this.injectedFailures > 0) {
          this.injectedFailures--;
          return Promise.reject(new EngineError('engine failure (injected by test hook)'));
        }
        return analyzeMove(ctx, inp);
      };
      let a: MoveAnalysis;
      try {
        a = await attempt();
      } catch (e) {
        if (!(e instanceof EngineError)) throw e;
        a = await attempt(); // one retry: a crashed engine restarts on the next search
      }
      this.deps.db.put('analyses', key, a);
      return a;
    });
  }

  private emit(st: GameState, e: GameEvent): void {
    for (const l of st.listeners) {
      try {
        l(e);
      } catch {
        // a broken listener must not stop the others
      }
    }
  }
}

/** Accuracy (Lichess game accuracy) and label counts per side, over the analysed plies. */
export function summarize(parsed: Pick<ParsedGame, 'moves' | 'startFen'>, analyses: ReadonlyMap<number, MoveAnalysis>): GameSummary {
  const total = parsed.moves.length;
  const side = (): SideSummary => ({ accuracy: null, counts: {} });
  const out: GameSummary = { white: side(), black: side(), done: analyses.size, total };
  for (const [ply, a] of analyses) {
    const color = parsed.moves[ply - 1]?.color ?? a.color;
    const counts = out[color].counts;
    counts[a.label as Label] = (counts[a.label as Label] ?? 0) + 1;
  }
  // evals of every position: start, after ply 1, ... (null = unknown)
  const evals: (Score | null)[] = [analyses.get(1)?.evalBefore ?? null];
  for (let p = 1; p <= total; p++) evals.push(analyses.get(p)?.evalAfter ?? analyses.get(p + 1)?.evalBefore ?? null);
  const startColor = parsed.moves[0]?.color ?? 'white';
  const acc = gameAccuracyFromScores(evals, startColor);
  out.white.accuracy = acc.white;
  out.black.accuracy = acc.black;
  return out;
}
