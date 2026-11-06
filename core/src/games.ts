// Games: PGN import -> GameInfo, per-game analysis state, the background queue, summaries and side-line analysis.
//
// - PGN: chessops parser, first game only; comments / clock annotations / NAGs / variations are ignored (main
//   line only); SetUp/FEN headers give the start position. Bad PGN (no game, no moves, illegal SAN, bad FEN,
//   non-standard variant) -> PgnImportError.
// - Game id = sha1(start FEN + ' ' + UCI moves); the same game imported twice gets the same id. Games are
//   persisted (store `games`) so a reload can reopen them by id.
// - Environment-neutral (runs in the browser's analysis worker and in Node): the cache is an async `CacheStore`
//   (IndexedDB in the browser), so the public methods that touch it are async.
// - you / orientation: `deps.username` vs the White/Black headers (case-insensitive); neither -> White (a first
//   guess only: the client decides "You" itself).
// - Analysis of main-line ply N is one Scheduler job (key `move:<analysisKey>`), queued in game order at
//   BACKGROUND priority; `focus(ply)` bumps ply, ply+1 and ply-1 to FOCUS; side-line moves (`analyse`) run at SIDELINE.
//   Finished analyses are cached in the store under analysisKey (ARCHITECTURE.md "Cache"): re-importing or
//   reloading a game is instant.
// - Previous-move context for ply N: ply N-1's move (prev.fenBefore / prev.uci) and, when already analysed, its
//   result (winLoss, win%, label). Book chain: every earlier ply is a book position move (pure book check);
//   analyzeMove additionally breaks the chain if ply N-1 wasn't labelled Book.

import type { AnalysisSettings, Color, GameInfo, GameMove, GameSummary, Label, MoveAnalysis, Score, SideSummary } from '@chess-coach/shared';
import { ANALYSIS_VERSION, gameAccuracyFromScores, settingsHash } from '@chess-coach/shared';
import { makeFen } from 'chessops/fen';
import { emptyHeaders, parsePgn, parseVariant, startingPosition } from 'chessops/pgn';
import { makeSan, parseSan } from 'chessops/san';
import { type AnalyzeInput, type PrevResult, analyzeMove } from './analysis/analyzeMove';
import { bookInfo } from './analysis/book';
import type { SearchCache, Searcher } from './analysis/searchCache';
import { sha1 } from './hash';
import type { CacheStore } from './store';
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
  db: CacheStore;
  searchCache: SearchCache;
  scheduler: Scheduler<Searcher> | null;
  settings: AnalysisSettings;
  /** First guess of "You" for GameInfo.you (case-insensitive match of the player names); default none (White). */
  username?: string | null;
  /** Progress log (finished plies with their run time, focus bumps); default: none. */
  log?: (msg: string) => void;
}

export class GameManager {
  private games = new Map<string, GameState>();
  /** Games being loaded from the store (concurrent calls share one load). */
  private loading = new Map<string, Promise<GameState | undefined>>();
  private readonly settingsKey: string;
  private injectedFailures = 0;

  constructor(private readonly deps: GameManagerDeps) {
    this.settingsKey = settingsHash(deps.settings);
  }

  private log(msg: string): void {
    this.deps.log?.(`${new Date().toISOString().slice(11, 23)} ${msg}`);
  }

  // --- games ------------------------------------------------------------------------------------------------

  async info(id: string): Promise<GameInfo | null> {
    const st = await this.state(id);
    return st ? this.infoOf(st) : null;
  }

  private infoOf(st: GameState): GameInfo {
    const you = youFor(st.parsed.headers, this.deps.username ?? null);
    return { ...st.parsed, you, orientation: you };
  }

  /** Import a PGN (first game). Enqueues every ply not cached yet. Throws PgnImportError. */
  async importPgn(pgn: string): Promise<GameInfo> {
    const parsed = parseGamePgn(pgn);
    let st = this.games.get(parsed.id) ?? (await this.loading.get(parsed.id));
    if (!st) {
      await this.deps.db.put('games', parsed.id, parsed);
      st = await this.loadOnce(parsed.id, async () => parsed);
    }
    return this.infoOf(st!);
  }

  async get(id: string): Promise<{ game: GameInfo; analyses: Record<number, MoveAnalysis>; summary: GameSummary } | null> {
    const st = await this.state(id);
    if (!st) return null;
    const analyses: Record<number, MoveAnalysis> = {};
    for (const [ply, a] of [...st.analyses].sort((x, y) => x[0] - y[0])) analyses[ply] = a;
    return { game: this.infoOf(st), analyses, summary: summarize(st.parsed, st.analyses) };
  }

  /**
   * Bump ply and ply+1 to FOCUS priority, then ply-1 (M4: ply's label needs ply-1's deep search for the Miss
   * context — with several engines it runs in parallel instead of after ply's own search). Failed plies among
   * ply / ply+1 are re-queued. Returns false for an unknown game.
   */
  async focus(id: string, ply: number): Promise<boolean> {
    const st = await this.state(id);
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
    this.log(`focus ${id.slice(0, 8)} ply ${ply}: bumped [${bumped.join(', ')}]${retried.length ? ` retried [${retried.join(', ')}]` : ''}`);
    return true;
  }

  /** Listen to a game's events; resolves to the unsubscribe function (rejects for an unknown game). */
  async subscribe(id: string, listener: GameListener): Promise<() => void> {
    const st = await this.state(id);
    if (!st) throw new Error(`unknown game ${id}`);
    st.listeners.add(listener);
    return () => st.listeners.delete(listener);
  }

  /** Replay of the current state as events (for a new subscriber). */
  async snapshot(id: string): Promise<GameEvent[]> {
    const st = await this.state(id);
    if (!st) return [];
    const out: GameEvent[] = [];
    for (const [ply, analysis] of [...st.analyses].sort((a, b) => a[0] - b[0])) out.push({ type: 'analysis', ply, analysis });
    for (const [ply, message] of st.errors) out.push({ type: 'error', ply, message });
    const s = summarize(st.parsed, st.analyses);
    out.push({ type: 'progress', done: s.done, total: s.total }, { type: 'summary', summary: s });
    return out;
  }

  async summary(id: string): Promise<GameSummary | null> {
    const st = await this.state(id);
    return st ? summarize(st.parsed, st.analyses) : null;
  }

  /** Resolves when every ply is analysed (or failed). */
  async whenDone(id: string): Promise<void> {
    const st = await this.state(id);
    if (!st) throw new Error(`unknown game ${id}`);
    if (st.analyses.size + st.errors.size >= st.parsed.moves.length) return;
    return new Promise((resolve) => st.doneWaiters.push(resolve));
  }

  /** Side-line (or any) single move analysis at SIDELINE priority. Throws BadRequestError for bad input. */
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

  private async state(id: string): Promise<GameState | undefined> {
    const st = this.games.get(id);
    if (st) return st;
    return this.loadOnce(id, async () => this.deps.db.get<ParsedGame>('games', id));
  }

  private loadOnce(id: string, parsed: () => Promise<ParsedGame | undefined>): Promise<GameState | undefined> {
    const pending = this.loading.get(id);
    if (pending) return pending;
    const p = (async () => {
      const g = await parsed();
      return g ? this.load(g) : undefined;
    })();
    this.loading.set(id, p);
    void p.finally(() => this.loading.delete(id)).catch(() => undefined);
    return p;
  }

  private async load(parsed: ParsedGame): Promise<GameState> {
    const existing = this.games.get(parsed.id);
    if (existing) return existing;
    const inputs: AnalyzeInput[] = [];
    let chain = true;
    for (let i = 0; i < parsed.moves.length; i++) {
      const m = parsed.moves[i]!;
      const prevMove = i > 0 ? parsed.moves[i - 1]! : null;
      inputs.push({ fenBefore: m.fenBefore, uci: m.uci, prev: prevMove ? { fenBefore: prevMove.fenBefore, uci: prevMove.uci } : null, earlierMovesAllBook: chain });
      const b = bookInfo(m.fenBefore, m.fenAfter);
      chain = chain && b.after !== null && b.beforeIsStartOrBook;
    }
    const keys = inputs.map((inp) => analysisKey(this.settingsKey, inp));
    const cached = await Promise.all(keys.map((k) => this.deps.db.get<MoveAnalysis>('analyses', k)));
    const st: GameState = {
      parsed,
      inputs,
      keys,
      analyses: new Map(),
      errors: new Map(),
      retrying: new Set(),
      listeners: new Set(),
      doneWaiters: [],
    };
    cached.forEach((a, i) => {
      if (a) st.analyses.set(i + 1, a);
    });
    this.games.set(parsed.id, st);
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
      const analysis = await this.run(input, priority, async () => {
        started = Date.now();
        // the previous ply's job stores its result before resolving, so the store has it even if our state lags
        const prev = st.analyses.get(ply - 1) ?? (ply > 1 ? await this.deps.db.get<MoveAnalysis>('analyses', st.keys[ply - 2]!) : undefined);
        const result: PrevResult | null = prev ? { winLoss: prev.winLoss, winBefore: prev.winBefore, label: prev.label } : null;
        return input.prev ? { ...input, prev: { ...input.prev, result } } : input;
      });
      if (started) this.log(`game ${st.parsed.id.slice(0, 8)} ply ${ply} done in ${Date.now() - started} ms`);
      st.analyses.set(ply, analysis);
      st.errors.delete(ply);
      this.emit(st, { type: 'analysis', ply, analysis });
    } catch (e) {
      this.log(`game ${st.parsed.id.slice(0, 8)} ply ${ply} failed: ${(e as Error).message}`);
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
  private async run(input: AnalyzeInput, priority: Priority, finalInput: () => Promise<AnalyzeInput> | AnalyzeInput = () => input): Promise<MoveAnalysis> {
    const key = analysisKey(this.settingsKey, input);
    const sched = this.deps.scheduler;
    // a job already queued/running for this key: join it (and upgrade its priority) without a store lookup
    if (sched?.has(`move:${key}`)) return sched.run(`move:${key}`, priority, () => Promise.reject(new Error('unreachable')));
    const cached = await this.deps.db.get<MoveAnalysis>('analyses', key);
    if (cached) return cached;
    if (!sched) throw new Error('engine not running');
    return sched.run(`move:${key}`, priority, async (engine) => {
      const again = await this.deps.db.get<MoveAnalysis>('analyses', key);
      if (again) return again;
      const ctx = { searcher: engine, cache: this.deps.searchCache, settings: this.deps.settings };
      const inp = await finalInput();
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
      try {
        await this.deps.db.put('analyses', key, a);
      } catch {
        // best-effort persistence (e.g. storage quota): the result is still delivered
      }
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
