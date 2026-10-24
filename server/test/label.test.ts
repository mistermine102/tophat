// analysis/label.ts with a fake searcher: the label pipeline (deep + searchmoves + classify) and the near-threshold
// verification search (settings.budget.verify).
import { DEFAULT_SETTINGS, type AnalysisSettings, type Score } from '@chess-coach/shared';
import { INITIAL_FEN } from 'chessops/fen';
import { describe, expect, it } from 'vitest';
import { labelMove, type SearchFn } from '../src/analysis/label';
import type { SearchParams } from '../src/analysis/searchCache';
import type { PvLine, SearchResult } from '../src/engine/uci';
import { scoreForWin } from './helpers/classifyHelpers';

const pv = (multipv: number, move: string, score: Score): PvLine => ({ multipv, move, score, depth: 18, pv: [move] });
const result = (lines: PvLine[]): SearchResult => ({ lines, bestmove: lines[0]?.move ?? null, depth: 18, nodes: 1, timeMs: 1 });

/** Fake engine: deep MultiPV lines, searchmoves=[x] answers, and a 'verify' answer (searchmoves of 2 moves). */
function fake(deep: PvLine[], verify?: PvLine[]) {
  const calls: { name: string; p: SearchParams }[] = [];
  const search: SearchFn = async (name, _fen, p) => {
    calls.push({ name, p });
    if (p.searchmoves?.length === 2) {
      if (!verify) throw new Error('unexpected verify search');
      return result(verify);
    }
    if (p.searchmoves?.length === 1) {
      const l = deep.find((x) => x.move === p.searchmoves![0]);
      return result(l ? [{ ...l, multipv: 1 }] : []);
    }
    return result(deep.slice(0, p.multipv));
  };
  return { search, calls };
}

const S: AnalysisSettings = DEFAULT_SETTINGS;
// (earlierMovesAllBook: false = no Book label for these opening moves)
// best e2e4 at 60 %; candidates d2d4 / c2c4 / g1f3 at chosen losses (quiet 1-ply PVs: the material rule stays silent)
const deepWith = (playedLoss: number, secondLoss = 0.2) => [
  pv(1, 'e2e4', scoreForWin(60)),
  pv(2, 'g1f3', scoreForWin(60 - secondLoss)),
  pv(3, 'd2d4', scoreForWin(60 - playedLoss)),
];

describe('labelMove: near-threshold verification', () => {
  it('far from every threshold: no verification search', async () => {
    const f = fake(deepWith(7.5));
    const w = await labelMove(S, f.search, { fenBefore: INITIAL_FEN, uci: 'd2d4', earlierMovesAllBook: false });
    expect(w.cr.label).toBe('inaccuracy');
    expect(w.verified).toBe(false);
    expect(f.calls.map((c) => c.name)).toEqual(['deep']);
  });

  it('within the margin of the Mistake bound: the deeper two-move search decides, in both directions', async () => {
    // deep says 9.6 (Inaccuracy, 0.4 below the bound); the verification says 12 -> Mistake
    const up = fake(deepWith(9.6), [pv(1, 'e2e4', scoreForWin(61)), pv(2, 'd2d4', scoreForWin(49))]);
    const a = await labelMove(S, up.search, { fenBefore: INITIAL_FEN, uci: 'd2d4', earlierMovesAllBook: false });
    expect(a.verified).toBe(true);
    expect(a.cr.label).toBe('mistake');
    expect(a.cr.winLoss).toBeCloseTo(12, 6);
    const v = up.calls.find((c) => c.name === 'verify')!;
    expect(v.p).toMatchObject({ depth: S.budget.deep.depth + S.budget.verify.depthPlus, multipv: 2, maxMs: S.budget.verify.maxMs });
    expect([...v.p.searchmoves!].sort()).toEqual(['d2d4', 'e2e4']);
    // deep says 10.4 (Mistake); the verification says 8 -> Inaccuracy (not hysteresis: no bias to the milder label)
    const down = fake(deepWith(10.4), [pv(1, 'e2e4', scoreForWin(60)), pv(2, 'd2d4', scoreForWin(52))]);
    const b = await labelMove(S, down.search, { fenBefore: INITIAL_FEN, uci: 'd2d4', earlierMovesAllBook: false });
    expect(b.cr.label).toBe('inaccuracy');
  });

  it('the verification may find the played move best', async () => {
    const f = fake(deepWith(4.6), [pv(1, 'd2d4', scoreForWin(61)), pv(2, 'e2e4', scoreForWin(60.5))]);
    const w = await labelMove(S, f.search, { fenBefore: INITIAL_FEN, uci: 'd2d4', earlierMovesAllBook: false });
    expect(w.cr).toMatchObject({ label: 'best', winLoss: 0 });
  });

  it('Great: the 2nd best loss near the Great bound is verified with [best, 2nd]', async () => {
    // played = best e2e4; 2nd best g1f3 loses 9.5 (just short of Great's 10); verified: loses 11 -> Great
    const f = fake(deepWith(20, 9.5), [pv(1, 'e2e4', scoreForWin(60)), pv(2, 'g1f3', scoreForWin(49))]);
    const w = await labelMove(S, f.search, { fenBefore: INITIAL_FEN, uci: 'e2e4', earlierMovesAllBook: false });
    expect(w.cr.label).toBe('great');
    expect([...f.calls.find((c) => c.name === 'verify')!.p.searchmoves!].sort()).toEqual(['e2e4', 'g1f3']);
    // ... and if the verification puts the 2nd move on top, the played move is no longer the best
    const g = fake(deepWith(20, 9.5), [pv(1, 'g1f3', scoreForWin(62)), pv(2, 'e2e4', scoreForWin(60))]);
    const x = await labelMove(S, g.search, { fenBefore: INITIAL_FEN, uci: 'e2e4', earlierMovesAllBook: false });
    expect(x.cr.label).toBe('excellent');
    expect(x.cr.winLoss).toBeCloseTo(2 - 0, 0);
  });

  it('margin 0 disables it; mate scores are never verified', async () => {
    const off = structuredClone(DEFAULT_SETTINGS);
    off.budget.verify.margin = 0;
    const f = fake(deepWith(9.6));
    expect((await labelMove(off, f.search, { fenBefore: INITIAL_FEN, uci: 'd2d4', earlierMovesAllBook: false })).verified).toBe(false);
    const m = fake([pv(1, 'e2e4', { mate: 5 }), pv(2, 'd2d4', { cp: 1500 })]);
    expect((await labelMove(S, m.search, { fenBefore: INITIAL_FEN, uci: 'd2d4', earlierMovesAllBook: false })).verified).toBe(false);
  });
});
