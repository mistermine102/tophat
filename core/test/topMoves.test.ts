// (Engine arrows) Which of the engine's lines become "Show best move" arrows, and their win-chance loss.
import { DEFAULT_SETTINGS } from '@chess-coach/shared';
import { describe, expect, it } from 'vitest';
import { TOP_MAX, addBrilliants, brilliantSearchWorthIt, emptyTopMoves, pickTopMoves, sacrificeCandidates, topParams } from '../src/analysis/topMoves';
import type { SearchParams } from '../src/analysis/searchCache';
import type { PvLine, SearchResult } from '../src/engine/uci';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

function result(moves: [string, number][]): SearchResult {
  const lines: PvLine[] = moves.map(([move, cp], i) => ({ multipv: i + 1, move, score: { cp }, depth: 14, pv: [move] }));
  return { lines, bestmove: moves[0]?.[0] ?? null, depth: 14, nodes: 0, timeMs: 0 };
}

describe('pickTopMoves', () => {
  it('an opening with many equal moves: every move almost as good as the best, at most TOP_MAX (5)', () => {
    const r = result([['e2e4', 30], ['d2d4', 28], ['g1f3', 25], ['c2c4', 22], ['e2e3', 15], ['b1c3', 10]]);
    const top = pickTopMoves(START, r, DEFAULT_SETTINGS);
    expect(top.map((m) => m.san)).toEqual(['e4', 'd4', 'Nf3', 'c4', 'e3']);
    expect(TOP_MAX).toBe(5);
    expect(top[0]).toMatchObject({ winLoss: 0, gap: 0 });
    expect(top.every((m) => m.gap <= DEFAULT_SETTINGS.labels.excellentMaxLoss)).toBe(true);
  });

  it('one clear best move: still three, the weaker two with their (large) gap, nothing beyond', () => {
    const r = result([['e2e4', 300], ['d2d4', 0], ['g1f3', -50], ['c2c4', -60]]);
    const top = pickTopMoves(START, r, DEFAULT_SETTINGS);
    expect(top.map((m) => m.uci)).toEqual(['e2e4', 'd2d4', 'g1f3']);
    expect(top[1]!.gap).toBeGreaterThan(20);
  });

  it('a lost position: letting the pawn queen hardly moves win%, but the centipawns punish it', () => {
    // Black at −6: Ke7 stops f8=Q, the rest lose another queen's worth
    const r = result([['e7e5', -620], ['d7d5', -1450], ['c7c5', -1500], ['b7b5', -1520]]);
    const top = pickTopMoves(AFTER_E4, r, DEFAULT_SETTINGS);
    expect(top).toHaveLength(3);
    expect(top[1]!.winLoss).toBeLessThan(10);
    expect(top[1]!.gap).toBeGreaterThan(10); // centipawns are capped at ±1000: still the faintest arrow
  });

  it('a more than slightly worse move beyond the third is left out', () => {
    const r = result([['e2e4', 30], ['d2d4', 28], ['g1f3', 25], ['c2c4', -40], ['e2e3', -45]]);
    expect(pickTopMoves(START, r, DEFAULT_SETTINGS).map((m) => m.san)).toEqual(['e4', 'd4', 'Nf3']);
  });

  it("Black to move: scores are White's point of view, losses Black's", () => {
    const r = result([['e7e5', 20], ['c7c5', 0]]);
    const top = pickTopMoves(AFTER_E4, r, DEFAULT_SETTINGS);
    expect(top[0]!.score).toEqual({ cp: -20 });
    expect(top[1]!.winLoss).toBeGreaterThan(0);
  });

  it('skips illegal and repeated lines', () => {
    const r = result([['e2e4', 30], ['e2e4', 30], ['e2e5', 20], ['d2d4', 28]]);
    expect(pickTopMoves(START, r, DEFAULT_SETTINGS).map((m) => m.uci)).toEqual(['e2e4', 'd2d4']);
  });
});

describe('topParams / emptyTopMoves', () => {
  it("is the analysis's own deep search (answered from the cache once a position is analysed)", () => {
    expect(topParams(DEFAULT_SETTINGS)).toMatchObject({ depth: DEFAULT_SETTINGS.budget.deep.depth, multipv: DEFAULT_SETTINGS.budget.deep.multipv });
  });

  it('no moves when the game is over, null otherwise', () => {
    const mated = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
    expect(emptyTopMoves(mated)).toEqual({ fen: mated, moves: [], depth: 0 });
    expect(emptyTopMoves(START)).toBeNull();
  });
});

// (Brilliant lines) The Opera game before 16.Qb8+!! Nxb8 17.Rd8#: the queen offer is the sound sacrifice.
describe('addBrilliants', () => {
  const OPERA = '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16';
  const QB8 = { move: 'b3b8', pv: ['b3b8', 'd7b8', 'd1d8'] };
  const quiet = (moves: [string, number][]): PvLine[] => moves.map(([move, cp], i) => ({ multipv: i + 1, move, score: { cp }, depth: 14, pv: [move] }));
  const res = (lines: PvLine[]): SearchResult => ({ lines, bestmove: lines[0]?.move ?? null, depth: 14, nodes: 0, timeMs: 0 });

  it('marks a sound sacrifice in the list and keeps its place', async () => {
    const r = res([{ multipv: 1, move: QB8.move, score: { mate: 2 }, depth: 14, pv: QB8.pv }, ...quiet([['c2c3', 150], ['a2a3', 120]]).map((l) => ({ ...l, multipv: l.multipv + 1 }))]);
    const top = await addBrilliants(OPERA, r, pickTopMoves(OPERA, r, DEFAULT_SETTINGS), DEFAULT_SETTINGS, null, null);
    expect(top.map((m) => m.uci)).toEqual(['b3b8', 'c2c3', 'a2a3']);
    expect(top[0]!.brilliant?.piece.role).toBe('queen');
    expect(top[0]!.extra).toBeUndefined();
    expect(top.slice(1).every((m) => !m.brilliant)).toBe(true);
  });

  it('a sacrifice outside the deep lines: one more search over the candidate sacrifices, appended as extra', async () => {
    const r = res(quiet([['c2c3', 60], ['a2a3', 58], ['h2h3', 57], ['g2g3', 56], ['f2f3', 55]]));
    expect(brilliantSearchWorthIt(OPERA, r, DEFAULT_SETTINGS)).toBe(true);
    const asked: SearchParams[] = [];
    const search = async (_fen: string, p: SearchParams) => {
      asked.push(p);
      return res([{ multipv: 1, move: QB8.move, score: { cp: 58 }, depth: 14, pv: QB8.pv }]);
    };
    const top = await addBrilliants(OPERA, r, pickTopMoves(OPERA, r, DEFAULT_SETTINGS), DEFAULT_SETTINGS, null, search);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.searchmoves).toContain('b3b8');
    expect(asked[0]!.searchmoves).not.toContain('c2c3');
    expect(top).toHaveLength(6);
    expect(top[5]).toMatchObject({ uci: 'b3b8', san: 'Qb8+', extra: true });
    expect(top[5]!.brilliant).toBeDefined();
  });

  it('no extra search when the last deep line is already clearly worse than the best', async () => {
    const r = res(quiet([['c2c3', 60], ['a2a3', 58], ['h2h3', 57], ['g2g3', 56], ['f2f3', -40]]));
    expect(brilliantSearchWorthIt(OPERA, r, DEFAULT_SETTINGS)).toBe(false);
    let called = false;
    const top = await addBrilliants(OPERA, r, pickTopMoves(OPERA, r, DEFAULT_SETTINGS), DEFAULT_SETTINGS, null, async () => {
      called = true;
      return res([]);
    });
    expect(called).toBe(false);
    expect(top.some((m) => m.brilliant)).toBe(false);
  });

  it('sacrifice candidates: moves that leave a piece en prise, not quiet pawn moves', () => {
    const c = sacrificeCandidates(OPERA, []);
    expect(c).toContain('b3b8');
    expect(c).not.toContain('c2c3');
    expect(sacrificeCandidates(OPERA, ['b3b8'])).not.toContain('b3b8');
  });
});
