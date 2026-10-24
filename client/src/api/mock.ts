// Mock data layer (`?mock=1`): serves the fixture game and simulates the server's analysis queue.
//  - Analyses "finish" one by one every `intervalMs` in ply order; focus(ply) moves ply and ply+1 to the front.
//  - stream() replays finished analyses on connect, like the server.
//  - analyse() answers side-line moves after `analyseDelayMs` (fixture analysis if it is a known game move,
//    otherwise a generic analysis built with chessops).
//  - Any other pasted PGN works too: its plies get generic analyses.
import type { GameInfo, MoveAnalysis, Settings } from '@chess-coach/shared';
import { genericAnalysis } from '../fixtures/generic';
import { FIXTURE_USERNAME, fixtureGame } from '../fixtures/game';
import { PgnImportError, pgnToGame, sideOf } from '../fixtures/pgnGame';
import { computeSummary } from '../lib/summary';
import { ApiError, type AnalyseRequest, type ApiClient, type GameSnapshot, type StreamHandlers, type Unsubscribe } from './types';

export interface MockOptions {
  intervalMs?: number;
  analyseDelayMs?: number;
  createDelayMs?: number;
  /** Persist settings (browser: localStorage). */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

interface MockGame {
  game: GameInfo;
  all: Record<number, MoveAnalysis>;
  done: Record<number, MoveAnalysis>;
  queue: number[];
  timer: ReturnType<typeof setTimeout> | null;
  listeners: Set<StreamHandlers>;
}

const SETTINGS_KEY = 'chess-coach:mock-settings';
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class MockApiClient implements ApiClient {
  readonly mode = 'mock' as const;
  private readonly games = new Map<string, MockGame>();
  private settings: Settings = { username: FIXTURE_USERNAME };
  private readonly intervalMs: number;
  private readonly analyseDelayMs: number;
  private readonly createDelayMs: number;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;

  constructor(opts: MockOptions = {}) {
    this.intervalMs = opts.intervalMs ?? 150;
    this.analyseDelayMs = opts.analyseDelayMs ?? 300;
    this.createDelayMs = opts.createDelayMs ?? 150;
    this.storage = opts.storage ?? null;
    const saved = this.storage?.getItem(SETTINGS_KEY);
    if (saved) {
      try {
        this.settings = JSON.parse(saved) as Settings;
      } catch {
        /* ignore */
      }
    }
  }

  private register(game: GameInfo, all: Record<number, MoveAnalysis>): MockGame {
    const existing = this.games.get(game.id);
    if (existing) {
      existing.game = game;
      return existing;
    }
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
    return { ...game, ...sideOf(game.headers, this.settings.username) };
  }

  async createGame(pgn: string): Promise<GameInfo> {
    await delay(this.createDelayMs);
    let parsed: GameInfo;
    try {
      parsed = pgnToGame(pgn, this.settings.username);
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
      return genericAnalysis(req);
    } catch (e) {
      throw new ApiError((e as Error).message, 400);
    }
  }

  async getSettings(): Promise<Settings> {
    await delay(0);
    return { ...this.settings };
  }

  async putSettings(settings: Settings): Promise<Settings> {
    await delay(50);
    this.settings = { username: settings.username?.trim() || null };
    this.storage?.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    return { ...this.settings };
  }
}
