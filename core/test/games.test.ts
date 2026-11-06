// GameManager end to end (real Stockfish — the WASM build run by node unless STOCKFISH_PATH is set — with the reduced
// `fast` search budget): import, the event stream, the cache, focus, side lines, failures. Replaces the old HTTP API
// test; the browser runs the same GameManager in its analysis worker (client/src/worker/analysis.worker.ts).
import type { GameEvent } from '../src/games';
import type { GameSummary, MoveAnalysis } from '@chess-coach/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SearchCache, type Searcher } from '../src/analysis/searchCache';
import { Engine, engineAvailable } from '../src/engine/node';
import { Scheduler } from '../src/engine/scheduler';
import { BadRequestError, GameManager, PgnImportError, parseGamePgn } from '../src/games';
import { analysisSettingsFor } from '../src/profiles';
import { MemoryStore } from '../src/store';

const T = 240_000;
const FAST = analysisSettingsFor('fast');

// chess.com-style export: many headers, clock comments. Blackburne Shilling trap, 7...Nf3# (14 plies).
const PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.10.20"]
[White "SomeOpponent"]
[Black "SzymonJ"]
[Result "0-1"]
[ECO "C50"]
[TimeControl "600"]
[Link "https://www.chess.com/game/live/123456789"]

1. e4 {[%clk 0:09:58.5]} 1... e5 {[%clk 0:09:57.1]} 2. Nf3 {[%clk 0:09:55.2]} 2... Nc6 {[%clk 0:09:54.0]}
3. Bc4 {[%clk 0:09:50.9]} 3... Nd4 {[%clk 0:09:49.3]} 4. Nxe5 $2 {[%clk 0:09:45.0]} 4... Qg5 {[%clk 0:09:40.8]}
5. Nxf7 {[%clk 0:09:30.2]} 5... Qxg2 {[%clk 0:09:35.5]} 6. Rf1 {[%clk 0:09:20.0]} (6. Qf3 Qxf3) 6... Qxe4+ {[%clk 0:09:30.1]}
7. Be2 {[%clk 0:09:10.4]} 7... Nf3# {[%clk 0:09:28.0]} 0-1`;

const PGN2 = `[White "A"]
[Black "B"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 6. Nf3 h6 *`;

/** Collect a game's events (replay + live) until `until(events)`. */
async function collect(games: GameManager, id: string, until: (events: GameEvent[]) => boolean): Promise<GameEvent[]> {
  const events: GameEvent[] = [];
  let unsubscribe = () => {};
  await new Promise<void>((resolve) => {
    const push = (e: GameEvent) => {
      events.push(e);
      if (until(events)) resolve();
    };
    void games.subscribe(id, push).then(async (u) => {
      unsubscribe = u;
      for (const e of await games.snapshot(id)) push(e);
    });
  });
  unsubscribe();
  return events;
}
const allDone = (events: GameEvent[]) => events.some((e) => e.type === 'summary' && e.summary.done === e.summary.total);

describe.skipIf(!engineAvailable())('GameManager (Stockfish)', () => {
  let engine: Engine;
  let store: MemoryStore;
  let games: GameManager;

  beforeAll(async () => {
    engine = await Engine.start({ threads: Number(process.env.TEST_ENGINE_THREADS ?? 2), hashMb: 64 });
    store = new MemoryStore();
    games = new GameManager({ db: store, searchCache: new SearchCache(store), scheduler: new Scheduler<Searcher>(engine), settings: FAST, username: 'szymonj' });
  });
  afterAll(async () => {
    await engine?.quit();
  });

  it('bad PGN -> PgnImportError', async () => {
    for (const pgn of ['', 'hello world', '1. e4 e5 2. Ke3 Ke6 3. Qh5 Kxh5', '[FEN "not a fen"]\n\n1. e4 *']) {
      await expect(games.importPgn(pgn), pgn).rejects.toBeInstanceOf(PgnImportError);
    }
  });

  it(
    'import -> GameInfo; the events deliver every analysis and the summary; get() returns them',
    async () => {
      const info = await games.importPgn(PGN);
      expect(info.moves).toHaveLength(14);
      expect(info.moves[13]).toMatchObject({ ply: 14, san: 'Nf3#', uci: 'd4f3', color: 'black' });
      expect(info.headers.White).toBe('SomeOpponent');
      expect(info.you).toBe('black'); // the username matches Black (case-insensitive)
      expect(info.id).toBe(parseGamePgn(PGN).id);

      const events = await collect(games, info.id, allDone);
      const analyses = events.flatMap((e) => (e.type === 'analysis' ? [e] : []));
      expect(new Set(analyses.map((a) => a.ply))).toEqual(new Set(Array.from({ length: 14 }, (_, i) => i + 1)));
      expect(events.some((e) => e.type === 'progress')).toBe(true);
      expect(events.filter((e) => e.type === 'error')).toEqual([]);
      const last = analyses.find((a) => a.ply === 14)!.analysis;
      expect(last.label).toBe('best');
      expect(last.played.explanation!.immediate.text).toContain('Checkmate, Black wins.');
      const blunder = analyses.find((a) => a.ply === 9)!.analysis; // 5.Nxf7??
      expect(['mistake', 'blunder', 'miss']).toContain(blunder.label);

      const g = (await games.get(info.id))!;
      expect(Object.keys(g.analyses)).toHaveLength(14);
      expect(g.summary).toMatchObject({ done: 14, total: 14 });
      expect(g.summary.black.accuracy).toBeGreaterThan(g.summary.white.accuracy!);
      const counts = (s: GameSummary['white']) => Object.values(s.counts).reduce((x, y) => x + (y ?? 0), 0);
      expect(counts(g.summary.white) + counts(g.summary.black)).toBe(14);
      expect(await games.get('nope')).toBeNull();
      await expect(games.subscribe('nope', () => {})).rejects.toThrow(/unknown game/);
    },
    T,
  );

  it(
    'a second import (and a new manager over the same store, no engine) is served from the cache',
    async () => {
      const t0 = performance.now();
      const info = await games.importPgn(PGN);
      expect(Object.keys((await games.get(info.id))!.analyses)).toHaveLength(14);
      expect(performance.now() - t0).toBeLessThan(1000);

      const games2 = new GameManager({ db: store, searchCache: new SearchCache(store), scheduler: null, settings: FAST });
      const g = (await games2.get(info.id))!;
      expect(Object.keys(g.analyses)).toHaveLength(14);
      expect(g.summary.done).toBe(14);
    },
    T,
  );

  it(
    'focus reorders the queue',
    async () => {
      const info = await games.importPgn(PGN2);
      expect(info.moves).toHaveLength(12);
      expect(info.you).toBe('white'); // username matches neither side
      expect(await games.focus(info.id, 9)).toBe(true);
      expect(await games.focus('nope', 1)).toBe(false);
      const events = await collect(games, info.id, allDone);
      const order = events.flatMap((e) => (e.type === 'analysis' ? [e.ply] : []));
      expect(new Set(order).size).toBe(12);
      // ply 1 may already be running when the focus arrives; 9 and 10 jump ahead of 2..8
      expect(order.indexOf(9), order.join(',')).toBeLessThan(order.indexOf(2));
      expect(order.indexOf(10), order.join(',')).toBeLessThan(order.indexOf(2));
    },
    T,
  );

  it(
    'analyse: a side-line move (with prev) and validation',
    async () => {
      const g = parseGamePgn(PGN);
      // side line after 3...Nd4: 4.Nxd4 instead of 4.Nxe5
      const a: MoveAnalysis = await games.analyse({ fenBefore: g.moves[6]!.fenBefore, uci: 'f3d4', prev: { fenBefore: g.moves[5]!.fenBefore, uci: g.moves[5]!.uci } });
      expect(a.san).toBe('Nxd4');
      expect(a.played.explanation!.immediate.text.join(' ')).toMatch(/knight on d4/);
      expect(['best', 'great', 'excellent', 'good']).toContain(a.label);
      await expect(games.analyse({ fenBefore: g.moves[6]!.fenBefore, uci: 'e1e3' })).rejects.toBeInstanceOf(BadRequestError);
      await expect(games.analyse({ fenBefore: 'garbage', uci: 'e2e4' })).rejects.toBeInstanceOf(BadRequestError);
      await expect(games.analyse({ fenBefore: g.moves[6]!.fenBefore, uci: 'f3d4', prev: { fenBefore: g.moves[0]!.fenBefore, uci: 'e2e4' } })).rejects.toBeInstanceOf(BadRequestError);
    },
    T,
  );

  it(
    'a failed ply is reported as an error event and re-analysed on focus',
    async () => {
      games.injectFailures(2);
      const info = await games.importPgn('[White "x"]\n[Black "y"]\n\n1. c4 e5 *');
      const first = await collect(games, info.id, (ev) => ev.some((e) => e.type === 'error') && ev.some((e) => e.type === 'analysis'));
      const err = first.find((e) => e.type === 'error')!;
      expect(err).toEqual({ type: 'error', ply: 1, message: expect.stringMatching(/injected/) });
      expect(await games.focus(info.id, 1)).toBe(true);
      const again = await collect(games, info.id, allDone);
      expect([...new Set(again.flatMap((e) => (e.type === 'analysis' ? [e.ply] : [])))].sort()).toEqual([1, 2]);
    },
    T,
  );
});
