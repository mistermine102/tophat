// Mock data layer (`?mock=1`): serves the fixture game and simulates the server's analysis queue.
//  - Analyses "finish" one by one every `intervalMs` in ply order; focus(ply) moves ply and ply+1 to the front.
//  - stream() replays finished analyses on connect, like the server.
//  - analyse() answers side-line moves after `analyseDelayMs` (fixture analysis if it is a known game move,
//    otherwise a generic analysis built with chessops).
//  - topMoves() answers after `analyseDelayMs`: a game move's candidates in that position, else generic legal moves.
//  - topIdeas() tells those moves with the real point rules (core analysis/movePoints.ts) on their fixture lines (no
//    engine, so no threats), after one more `analyseDelayMs`.
//  - Any other pasted PGN works too: its plies get generic analyses.
import { DEFAULT_SETTINGS, toWhitePov, type ChessComGames, type GameInfo, type MoveAnalysis, type TopIdeasResult, type TopMovesResult } from '@chess-coach/shared';
import { compareIdeas, movePoints } from '@chess-coach/core/analysis/movePoints';
import { genericAnalysis, genericTopMoves } from '../fixtures/generic';
import { FIXTURE_PGN, FIXTURE_USERNAME, fixtureGame } from '../fixtures/game';
import { PgnImportError, pgnToGame, sideOf } from '../fixtures/pgnGame';
import { computeSummary } from '../lib/summary';
import { ApiError, type AnalyseRequest, type ApiClient, type GameSnapshot, type Health, type StreamHandlers, type Unsubscribe } from './types';

/** (Points) The fixture analyses get their points from the real rules (core movePoints.ts) on their own lines. */
function withPoints(a: MoveAnalysis, prev: { fenBefore: string; uci: string } | null = null): void {
  if (a.points || a.provisional) return;
  try {
    const mover = a.color;
    const of = (c: MoveAnalysis['played'], winLoss: number) => movePoints(a.fenBefore, { uci: c.uci, pv: c.pvUci.length ? c.pvUci : [c.uci], score: toWhitePov(c.score, mover), winLoss, prev }, DEFAULT_SETTINGS);
    if (a.best.uci === a.uci) a.points = { played: compareIdeas([of(a.played, 0)])[0]! };
    else {
      const [best, played] = compareIdeas([of(a.best, 0), of(a.played, a.winLoss)]);
      a.points = { played: played!, best: best! };
    }
  } catch {
    // a fixture line that doesn't play out: no points (the verdict sentence stays)
  }
}

export interface MockOptions {
  intervalMs?: number;
  analyseDelayMs?: number;
  createDelayMs?: number;
}

interface MockGame {
  game: GameInfo;
  all: Record<number, MoveAnalysis>;
  done: Record<number, MoveAnalysis>;
  queue: number[];
  timer: ReturnType<typeof setTimeout> | null;
  listeners: Set<StreamHandlers>;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class MockApiClient implements ApiClient {
  readonly mode = 'mock' as const;
  private readonly games = new Map<string, MockGame>();
  private readonly intervalMs: number;
  private readonly analyseDelayMs: number;
  private readonly createDelayMs: number;

  constructor(opts: MockOptions = {}) {
    this.intervalMs = opts.intervalMs ?? 150;
    this.analyseDelayMs = opts.analyseDelayMs ?? 300;
    this.createDelayMs = opts.createDelayMs ?? 150;
  }

  private register(game: GameInfo, all: Record<number, MoveAnalysis>): MockGame {
    const existing = this.games.get(game.id);
    if (existing) {
      existing.game = game;
      return existing;
    }
    game.moves.forEach((m, i) => {
      const a = all[m.ply];
      const p = game.moves[i - 1];
      if (a) withPoints(a, p ? { fenBefore: p.fenBefore, uci: p.uci } : null);
    });
    const g: MockGame = { game, all, done: {}, queue: game.moves.map((m) => m.ply), timer: null, listeners: new Set() };
    this.games.set(game.id, g);
    return g;
  }

  /** The fixture game is always available (so `?game=<fixture id>` works after a reload). */
  private lookup(id: string): MockGame | null {
    const g = this.games.get(id);
    if (g) return g;
    const fx = fixtureGame();
    if (id === fx.game.id) return this.register(this.orient(fx.game), fx.analyses);
    return null;
  }

  private orient(game: GameInfo): GameInfo {
    // like the server: a first guess at your side (the fixture player); the client may flip it
    return { ...game, ...sideOf(game.headers, FIXTURE_USERNAME) };
  }

  async createGame(pgn: string): Promise<GameInfo> {
    await delay(this.createDelayMs);
    let parsed: GameInfo;
    try {
      parsed = pgnToGame(pgn, FIXTURE_USERNAME);
    } catch (e) {
      if (e instanceof PgnImportError) throw new ApiError(e.message, 400);
      throw new ApiError(`Could not read the PGN: ${(e as Error).message}`, 400);
    }
    const fx = fixtureGame();
    const sameAsFixture =
      parsed.startFen === fx.game.startFen &&
      parsed.moves.length === fx.game.moves.length &&
      parsed.moves.every((m, i) => m.uci === fx.game.moves[i]!.uci);
    if (sameAsFixture) return this.register(this.orient(fx.game), fx.analyses).game;
    const all: Record<number, MoveAnalysis> = {};
    for (const m of parsed.moves) {
      const prev = parsed.moves[m.ply - 2];
      all[m.ply] = genericAnalysis({ fenBefore: m.fenBefore, uci: m.uci, prev: prev && { fenBefore: prev.fenBefore, uci: prev.uci } });
    }
    return this.register(parsed, all).game;
  }

  async getGame(id: string): Promise<GameSnapshot> {
    await delay(0);
    const g = this.lookup(id);
    if (!g) throw new ApiError('Game not found.', 404);
    return { game: g.game, analyses: { ...g.done }, summary: computeSummary(g.game, g.done) };
  }

  stream(id: string, handlers: StreamHandlers): Unsubscribe {
    const g = this.lookup(id);
    if (!g) {
      setTimeout(() => handlers.onConnectionError?.('Game not found.'), 0);
      return () => {};
    }
    g.listeners.add(handlers);
    // Replay finished analyses on connect (like the server).
    const replay = setTimeout(() => {
      if (!g.listeners.has(handlers)) return;
      for (const [ply, a] of Object.entries(g.done)) handlers.onAnalysis?.(Number(ply), a);
      handlers.onProgress?.(Object.keys(g.done).length, g.game.moves.length);
      if (g.queue.length === 0) handlers.onSummary?.(computeSummary(g.game, g.done));
    }, 0);
    this.schedule(g);
    return () => {
      clearTimeout(replay);
      g.listeners.delete(handlers);
    };
  }

  private schedule(g: MockGame): void {
    if (g.timer || g.queue.length === 0) return;
    g.timer = setTimeout(() => {
      g.timer = null;
      this.tick(g);
      this.schedule(g);
    }, this.intervalMs);
  }

  private tick(g: MockGame): void {
    const ply = g.queue.shift();
    if (ply === undefined) return;
    const a = g.all[ply];
    if (!a) return;
    g.done[ply] = a;
    const done = Object.keys(g.done).length;
    for (const l of g.listeners) {
      l.onAnalysis?.(ply, a);
      l.onProgress?.(done, g.game.moves.length);
    }
    if (g.queue.length === 0) {
      const summary = computeSummary(g.game, g.done);
      for (const l of g.listeners) l.onSummary?.(summary);
    }
  }

  async focus(id: string, ply: number): Promise<void> {
    const g = this.lookup(id);
    if (!g) throw new ApiError('Game not found.', 404);
    const front = [ply, ply + 1].filter((p) => g.queue.includes(p));
    if (front.length) g.queue = [...front, ...g.queue.filter((p) => !front.includes(p))];
  }

  /** Test helper: the current queue order. */
  queueOf(id: string): number[] {
    return [...(this.lookup(id)?.queue ?? [])];
  }

  async analyse(req: AnalyseRequest): Promise<MoveAnalysis> {
    await delay(this.analyseDelayMs);
    for (const g of [...this.games.values()]) {
      const m = g.game.moves.find((mv) => mv.fenBefore === req.fenBefore && mv.uci === req.uci);
      if (m && g.all[m.ply]) return g.all[m.ply]!;
    }
    try {
      const a = genericAnalysis(req);
      withPoints(a, req.prev ?? null);
      return a;
    } catch (e) {
      throw new ApiError((e as Error).message, 400);
    }
  }

  async topMoves(fen: string): Promise<TopMovesResult> {
    await delay(this.analyseDelayMs);
    for (const g of [...this.games.values()]) {
      const m = g.game.moves.find((mv) => mv.fenBefore === fen);
      const a = m ? g.all[m.ply] : undefined;
      if (a?.candidates.length) {
        // (Brilliant lines) the played move keeps its Brilliant mark in the list
        const sac = a.label === 'brilliant' ? a.labelReason.brilliant : undefined;
        const moves = [...a.candidates]
          .filter((c) => c.rank > 0)
          .sort((x, y) => x.rank - y.rank)
          .map((c) => ({ uci: c.uci, san: c.san, score: c.score, winLoss: c.winLoss, gap: c.winLoss, ...(sac && c.uci === m!.uci ? { brilliant: sac } : {}) }));
        return { fen, moves, depth: 14 };
      }
    }
    return genericTopMoves(fen);
  }

  async topIdeas(fen: string, prev: { fenBefore: string; uci: string } | null = null): Promise<TopIdeasResult> {
    const top = await this.topMoves(fen);
    await delay(this.analyseDelayMs);
    const pvs = new Map<string, string[]>();
    for (const g of [...this.games.values()]) {
      const m = g.game.moves.find((mv) => mv.fenBefore === fen);
      for (const c of (m ? g.all[m.ply]?.candidates : undefined) ?? []) pvs.set(c.uci, c.pvUci);
    }
    const mover = fen.split(' ')[1] === 'b' ? 'black' : 'white';
    const all = top.moves.map((m) => movePoints(fen, { uci: m.uci, pv: pvs.get(m.uci) ?? [m.uci], score: toWhitePov(m.score, mover), winLoss: m.winLoss, prev }, DEFAULT_SETTINGS));
    return { fen, moves: compareIdeas(all) };
  }

  /** One game: the fixture (any username; "nobody" is an unknown player). */
  async chessComGames(username: string): Promise<ChessComGames> {
    await delay(this.createDelayMs);
    if (username.toLowerCase() === 'nobody') throw new ApiError(`chess.com has no player called "${username}".`, 404);
    return {
      username,
      games: [
        {
          url: 'https://www.chess.com/game/live/1',
          pgn: FIXTURE_PGN,
          endTime: Date.UTC(2026, 9, 18) / 1000,
          timeClass: 'rapid',
          timeControl: '600',
          rated: true,
          white: { username: 'BishopBlunder99', rating: 812, result: 'checkmated' },
          black: { username: FIXTURE_USERNAME, rating: 835, result: 'win' },
        },
      ],
    };
  }

  async health(): Promise<Health> {
    return { ok: true, engine: 'Mock engine' };
  }

}
