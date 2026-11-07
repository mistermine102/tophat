// Integration tests against the real Stockfish binary. Auto-skipped when the binary is missing
// (run `npm run setup:engine`, or set STOCKFISH_PATH).
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { parseUci } from 'chessops/util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Engine, EngineCrashedError, EngineError, EngineTimeoutError, SearchAbortedError, engineAvailable, type SearchResult } from '../src/engine/node';

const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MATE_IN_1 = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1'; // Ra8#
const CHECKMATED = '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1';
const STALEMATE = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
const CASTLING = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
const MIDDLEGAME = 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 9';
const ITALIAN = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 1 5';

function isLegal(fen: string, uci: string): boolean {
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  const m = parseUci(uci);
  return !!m && pos.isLegal(m);
}

function expectWellFormed(fen: string, r: SearchResult, multipv: number) {
  expect(r.lines.length).toBe(multipv);
  expect(r.bestmove).toBe(r.lines[0]!.move);
  expect(r.lines.map((l) => l.multipv)).toEqual(Array.from({ length: multipv }, (_, i) => i + 1));
  expect(new Set(r.lines.map((l) => l.move)).size).toBe(multipv);
  for (const l of r.lines) {
    expect(isLegal(fen, l.move)).toBe(true);
    expect(l.pv[0]).toBe(l.move);
    expect(l.score.cp !== undefined || l.score.mate !== undefined).toBe(true);
  }
}

describe.skipIf(!engineAvailable())('Engine (real Stockfish)', () => {
  let engine: Engine;
  beforeAll(async () => {
    engine = await Engine.start({ threads: Number(process.env.TEST_ENGINE_THREADS ?? 2), hashMb: 64 });
  });
  afterAll(async () => {
    await engine?.quit();
  });

  it('identifies itself', () => {
    expect(engine.name).toMatch(/^Stockfish 19/);
    expect(engine.alive).toBe(true);
  });

  it('searches the start position', async () => {
    const r = await engine.search({ fen: STARTPOS, depth: 12 });
    expectWellFormed(STARTPOS, r, 1);
    expect(r.depth).toBeGreaterThanOrEqual(12);
    expect(r.nodes).toBeGreaterThan(0);
    expect(Math.abs(r.lines[0]!.score.cp!)).toBeLessThan(100);
  });

  it('multipv 5 returns 5 distinct, ranked lines', async () => {
    const r = await engine.search({ fen: MIDDLEGAME, depth: 14, multipv: 5 });
    expectWellFormed(MIDDLEGAME, r, 5);
    const cps = r.lines.map((l) => l.score.cp!);
    for (let i = 1; i < cps.length; i++) expect(cps[i]!).toBeLessThanOrEqual(cps[i - 1]!);
    for (const l of r.lines) expect(l.depth).toBe(14);
  });

  it('finds mate in 1 with score mate 1', async () => {
    const r = await engine.search({ fen: MATE_IN_1, depth: 10, multipv: 3 });
    expect(r.bestmove).toBe('a1a8');
    expect(r.lines[0]!.score).toEqual({ mate: 1 });
    expect(r.lines[0]!.pv).toEqual(['a1a8']);
  });

  it('checkmated position returns no lines without hanging', async () => {
    const r = await engine.search({ fen: CHECKMATED, depth: 18, multipv: 5 });
    expect(r).toMatchObject({ lines: [], bestmove: null });
  });

  it('stalemate returns no lines', async () => {
    const r = await engine.search({ fen: STALEMATE, depth: 18 });
    expect(r).toMatchObject({ lines: [], bestmove: null });
  });

  it('searchmoves restricts the search', async () => {
    const r = await engine.search({ fen: STARTPOS, depth: 10, multipv: 5, searchmoves: ['a2a3', 'h2h3'] });
    expect(r.lines.length).toBe(2);
    expect(new Set(r.lines.map((l) => l.move))).toEqual(new Set(['a2a3', 'h2h3']));
    const single = await engine.search({ fen: ITALIAN, depth: 10, searchmoves: ['g2g4'] });
    expect(single.lines.map((l) => l.move)).toEqual(['g2g4']);
  });

  it('searchmoves accepts castling as king-to-square and normalises king-takes-rook', async () => {
    const a = await engine.search({ fen: CASTLING, depth: 6, searchmoves: ['e1g1'] });
    expect(a.bestmove).toBe('e1g1');
    const b = await engine.search({ fen: CASTLING, depth: 6, searchmoves: ['e1a1'] });
    expect(b.bestmove).toBe('e1c1');
  });

  it('serialises concurrent calls correctly', async () => {
    const reqs = [
      { fen: STARTPOS, depth: 8, multipv: 3 },
      { fen: MATE_IN_1, depth: 8, multipv: 1 },
      { fen: CHECKMATED, depth: 8, multipv: 2 },
      { fen: MIDDLEGAME, depth: 8, multipv: 5 },
      { fen: ITALIAN, depth: 8, multipv: 2, searchmoves: ['c4f7', 'e1g1'] },
      { fen: STALEMATE, depth: 8 },
      { fen: ITALIAN, depth: 8, multipv: 4 },
    ];
    const results = await Promise.all(reqs.map((r) => engine.search(r)));
    expectWellFormed(STARTPOS, results[0]!, 3);
    expect(results[1]!.bestmove).toBe('a1a8');
    expect(results[2]!.lines).toEqual([]);
    expectWellFormed(MIDDLEGAME, results[3]!, 5);
    expect(new Set(results[4]!.lines.map((l) => l.move))).toEqual(new Set(['c4f7', 'e1g1']));
    expect(results[5]!.bestmove).toBeNull();
    expectWellFormed(ITALIAN, results[6]!, 4);
  });

  it('rejects invalid input without disturbing the engine', async () => {
    await expect(engine.search({ fen: 'not a fen', depth: 5 })).rejects.toBeInstanceOf(EngineError);
    await expect(engine.search({ fen: '8/8/8/8/8/8/8/8 w - - 0 1', depth: 5 })).rejects.toThrow(/Illegal position/);
    await expect(engine.search({ fen: STARTPOS, depth: 5, searchmoves: ['e2e5'] })).rejects.toThrow(/not a legal move/);
    await expect(engine.search({ fen: STARTPOS })).rejects.toThrow(/depth, movetimeMs or nodes/);
    const r = await engine.search({ fen: STARTPOS, depth: 5 });
    expect(r.lines.length).toBe(1);
  });

  it('supports movetime and nodes limits and newGame', async () => {
    await engine.newGame();
    const t = await engine.search({ fen: MIDDLEGAME, movetimeMs: 200 });
    expect(t.lines.length).toBe(1);
    expect(t.timeMs).toBeLessThan(2000);
    const n = await engine.search({ fen: MIDDLEGAME, nodes: 20_000 });
    expect(n.lines.length).toBe(1);
  });

  it('times out with a clear error and recovers', async () => {
    const p = engine.search({ fen: MIDDLEGAME, depth: 60, timeoutMs: 300 });
    await expect(p).rejects.toBeInstanceOf(EngineTimeoutError);
    await expect(p).rejects.toThrow(/did not answer "go depth 60" within 300 ms/);
    const r = await engine.search({ fen: STARTPOS, depth: 6, multipv: 2 });
    expectWellFormed(STARTPOS, r, 2);
  });

  it('abort() stops the running search and cancels queued ones; later searches are unaffected (M4)', async () => {
    const t0 = performance.now();
    const running = engine.search({ fen: MIDDLEGAME, depth: 60, multipv: 3 });
    const queued = engine.search({ fen: STARTPOS, depth: 8 });
    await new Promise((r) => setTimeout(r, 300));
    engine.abort();
    const after = engine.search({ fen: STARTPOS, depth: 6, multipv: 2 });
    await expect(running).rejects.toBeInstanceOf(SearchAbortedError);
    await expect(queued).rejects.toBeInstanceOf(SearchAbortedError);
    expect(performance.now() - t0).toBeLessThan(5_000);
    expectWellFormed(STARTPOS, await after, 2);
    engine.abort(); // idle: no-op
    expectWellFormed(STARTPOS, await engine.search({ fen: STARTPOS, depth: 6, multipv: 2 }), 2);
  });
});

describe.skipIf(!engineAvailable())('Engine crash + restart', () => {
  it('rejects the pending search when the process dies and restarts on the next call', async () => {
    const engine = await Engine.start({ threads: 2, hashMb: 16 });
    try {
      const p = engine.search({ fen: MIDDLEGAME, depth: 60, timeoutMs: 30_000 });
      const queued = engine.search({ fen: STARTPOS, depth: 6 });
      await new Promise((r) => setTimeout(r, 300));
      engine.killInstance();
      await expect(p).rejects.toBeInstanceOf(EngineCrashedError);
      // the already-queued search runs on a fresh process
      const r = await queued;
      expect(r.lines.length).toBe(1);
      expect(engine.alive).toBe(true);
    } finally {
      await engine.quit();
    }
    await expect(engine.search({ fen: STARTPOS, depth: 2 })).rejects.toThrow(/quit/);
  });

  it('reports a missing binary clearly', async () => {
    await expect(Engine.start({ path: 'C:/definitely/not/here/stockfish.exe' })).rejects.toThrow(/not found/);
  });
});
