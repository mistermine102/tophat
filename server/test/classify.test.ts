// Unit tests for analysis/classify.ts (synthetic engine data on real, legal positions).
import { DEFAULT_SETTINGS, type AnalysisSettings, type Label, winPercent } from '@chess-coach/shared';
import { INITIAL_FEN } from 'chessops/fen';
import { describe, expect, it } from 'vitest';
import {
  LABEL_SEVERITY,
  classifyMove,
  countLegalMoves,
  findHung,
  labelFromWinLoss,
  materialCheck,
  sameMoveUci,
  worseLabel,
} from '../src/analysis/classify';
import { lineMaterial } from '../src/chess/material';
import { cpForWin, legalFen, line, mkInput, playUci, scoreForWin } from './helpers/classifyHelpers';

const S = DEFAULT_SETTINGS;
const after = (moves: string) => playUci(INITIAL_FEN, moves.split(' ').filter(Boolean));
const withSettings = (patch: (s: AnalysisSettings) => void): AnalysisSettings => {
  const s = structuredClone(DEFAULT_SETTINGS);
  patch(s);
  return s;
};

/** Classify the start position: best d2d4 at `winBest`, played e2e4 at `winBest - loss` (quiet 1-ply PVs). */
const byLoss = (winBest: number, loss: number, over: Parameters<typeof mkInput>[0] = {}) =>
  classifyMove(mkInput({ best: line('d2d4', scoreForWin(winBest)), played: line('e2e4', scoreForWin(winBest - loss)), ...over }), S);

// Positions (all verified legal in the first test)
const MAT = 'r5k1/ppp2pp1/7p/8/8/5N2/PPPQ1PPP/4R1K1 w - - 0 1'; // White Q+R+N vs R, +12 material
const E4E5 = after('e2e4 e7e5');
const SMOTHER = '5r1k/6pp/7N/8/2Q5/8/5PPP/6K1 w - - 0 1'; // Qg8+! Rxg8 Nf7#
const TRADE = '3q1rk1/ppp2ppp/8/8/8/8/PPP2PPP/R2Q1RK1 w - - 0 1'; // White up a rook, queens face each other
const RUY_BXC6_BEFORE = after('e2e4 e7e5 g1f3 b8c6 f1b5 a7a6');
const RUY_BXC6 = after('e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5c6');
const SCANDI_TAKE = after('e2e4 d7d5 e4d5'); // Black recaptures with Qxd5
const OPPOSITION = '8/8/3k4/8/3PK3/8/8/8 b - - 0 1';

describe('test positions', () => {
  it('are legal', () => {
    for (const fen of [MAT, E4E5, SMOTHER, TRADE, RUY_BXC6_BEFORE, RUY_BXC6, SCANDI_TAKE, OPPOSITION]) expect(() => legalFen(fen)).not.toThrow();
  });
  it('cpForWin inverts winPercent', () => {
    for (const w of [3, 10, 50, 70, 97]) expect(winPercent(cpForWin(w))).toBeCloseTo(w, 9);
  });
});

describe('labelFromWinLoss (SPEC bands)', () => {
  const cases: [number, Label][] = [
    [0, 'best'],
    [0.5, 'best'],
    [0.51, 'excellent'],
    [2, 'excellent'],
    [2.01, 'good'],
    [5, 'good'],
    [5.01, 'inaccuracy'],
    [10, 'inaccuracy'],
    [10.01, 'mistake'],
    [20, 'mistake'],
    [20.01, 'blunder'],
    [100, 'blunder'],
  ];
  it.each(cases)('winLoss %s -> %s', (wl, label) => {
    expect(labelFromWinLoss(wl, S)).toBe(label);
  });
  it('uses the thresholds from settings', () => {
    const s = withSettings((x) => (x.labels.mistakeMaxLoss = 30));
    expect(labelFromWinLoss(25, s)).toBe('mistake');
    expect(labelFromWinLoss(25, S)).toBe('blunder');
  });
});

describe('severity / worse of', () => {
  it('orders Blunder > Miss > Mistake > Inaccuracy > Good > Excellent > Best/Great/Book/Forced', () => {
    const order: Label[] = ['excellent', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder'];
    for (let i = 1; i < order.length; i++) expect(LABEL_SEVERITY[order[i]!]).toBeGreaterThan(LABEL_SEVERITY[order[i - 1]!]);
    for (const l of ['best', 'great', 'book', 'forced'] as Label[]) expect(LABEL_SEVERITY[l]).toBeLessThan(LABEL_SEVERITY.excellent);
  });
  it('worseLabel picks the more severe', () => {
    expect(worseLabel('excellent', 'blunder')).toBe('blunder');
    expect(worseLabel('blunder', 'mistake')).toBe('blunder');
    expect(worseLabel('miss', 'mistake')).toBe('miss');
    expect(worseLabel('miss', 'blunder')).toBe('blunder');
    expect(worseLabel('great', undefined)).toBe('great');
    expect(worseLabel('best', 'best')).toBe('best');
  });
});

describe('helpers', () => {
  it('countLegalMoves', () => {
    expect(countLegalMoves(INITIAL_FEN)).toBe(20);
    expect(countLegalMoves('7k/8/8/8/8/8/6q1/7K w - - 0 1')).toBe(1);
    expect(countLegalMoves('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')).toBe(26); // 2 castles counted once each
    expect(countLegalMoves('8/P7/8/8/8/8/8/k3K3 w - - 0 1')).toBe(4 + 5); // a8=Q/R/B/N + 5 king moves
    expect(countLegalMoves('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1')).toBe(0);
  });
  it('sameMoveUci treats e1g1 and e1h1 as the same castle', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    expect(sameMoveUci(fen, 'e1g1', 'e1h1')).toBe(true);
    expect(sameMoveUci(fen, 'e1c1', 'e1a1')).toBe(true);
    expect(sameMoveUci(fen, 'e1g1', 'e1c1')).toBe(false);
    expect(sameMoveUci(INITIAL_FEN, 'e2e4', 'e2e4')).toBe(true);
    expect(sameMoveUci(INITIAL_FEN, 'e2e4', 'e2e3')).toBe(false);
  });
});

describe('classifyMove: win-chance labels', () => {
  const bounds: [number, Label][] = [
    [0.499, 'best'],
    [0.501, 'excellent'],
    [1.999, 'excellent'],
    [2.001, 'good'],
    [4.999, 'good'],
    [5.001, 'inaccuracy'],
    [9.999, 'inaccuracy'],
    [10.001, 'mistake'],
    [19.999, 'mistake'],
    [20.001, 'blunder'],
  ];
  it.each(bounds)('winLoss %s -> %s', (loss, label) => {
    const r = byLoss(60, loss);
    expect(r.winLoss).toBeCloseTo(loss, 6);
    expect(r.label).toBe(label);
    expect(r.labelReason.winChance).toBe(label);
    expect(r.labelReason.material?.label).toBeUndefined();
  });

  it('engine #1 is Best even if its own search reported a different (worse) score', () => {
    const r = classifyMove(mkInput({ played: line('e2e4', { cp: -300 }), best: line('e2e4', { cp: 40 }), playedIsBest: true }), S);
    expect(r).toMatchObject({ label: 'best', winLoss: 0 });
    expect(r.winPlayed).toBe(r.winBest);
    expect(r.labelReason.material).toBeUndefined(); // no material rule for the best move itself
  });

  it('same move detected without the flag (castling given as king-takes-rook)', () => {
    const fen = 'r3k2r/pppq1ppp/8/8/8/8/PPPQ1PPP/R3K2R w KQkq - 0 1';
    const r = classifyMove(mkInput({ fenBefore: fen, legalMoveCount: countLegalMoves(fen), played: line('e1h1', { cp: -50 }), best: line('e1g1', { cp: 20 }) }), S);
    expect(r).toMatchObject({ label: 'best', winLoss: 0 });
  });

  it('a played move scored higher than the best move is Best (winLoss clamped at 0)', () => {
    const r = byLoss(60, -3);
    expect(r).toMatchObject({ label: 'best', winLoss: 0 });
  });

  it('already lost: losses are compressed by the clamp', () => {
    const r = classifyMove(mkInput({ best: line('d2d4', { cp: -900 }), played: line('e2e4', { cp: -1500 }) }), S);
    expect(r.winLoss).toBeLessThan(2);
    expect(r.label).toBe('excellent');
  });
});

describe('classifyMove: mate scores', () => {
  it('had mate, still mates (slower) -> Best, not a mistake', () => {
    const r = classifyMove(mkInput({ best: line('d2d4', { mate: 2 }), played: line('e2e4', { mate: 9 }) }), S);
    expect(r).toMatchObject({ label: 'best', winLoss: 0 });
  });
  it('had mate and lost it -> classified by the remaining win%', () => {
    expect(classifyMove(mkInput({ best: line('d2d4', { mate: 3 }), played: line('e2e4', { cp: 900 }) }), S).label).toBe('excellent');
    expect(classifyMove(mkInput({ best: line('d2d4', { mate: 3 }), played: line('e2e4', { cp: 500 }) }), S).label).toBe('mistake');
    expect(classifyMove(mkInput({ best: line('d2d4', { mate: 3 }), played: line('e2e4', { cp: 0 }) }), S).label).toBe('blunder');
  });
  it('allowing a mate is a Blunder', () => {
    const r = classifyMove(mkInput({ best: line('d2d4', { cp: 50 }), played: line('e2e4', { mate: -3 }) }), S);
    expect(r.label).toBe('blunder');
  });
  it('getting mated faster when mated anyway is Best', () => {
    const r = classifyMove(mkInput({ best: line('d2d4', { mate: -8 }), played: line('e2e4', { mate: -2 }) }), S);
    expect(r).toMatchObject({ label: 'best', winLoss: 0 });
  });
  it('a move that delivers checkmate is Best, whatever the engine data says', () => {
    const fen = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
    const r = classifyMove(
      mkInput({ fenBefore: fen, legalMoveCount: countLegalMoves(fen), played: line('a1a8', { cp: -500 }), best: line('g1f2', { mate: 3 }), second: line('g1g2', { cp: 0 }) }),
      S,
    );
    expect(r).toMatchObject({ label: 'best', checkmate: true, winLoss: 0 });
  });
});

describe('classifyMove: Forced', () => {
  const FORCED = '7k/8/8/8/8/8/6q1/7K w - - 0 1';
  it('the only legal move is Forced', () => {
    const r = classifyMove(mkInput({ fenBefore: FORCED, legalMoveCount: 1, played: line('h1g2', { cp: 0 }), best: line('h1g2', { cp: 0 }), playedIsBest: true }), S);
    expect(r.label).toBe('forced');
  });
  it('overrides everything (even a huge loss, book, great)', () => {
    const r = classifyMove(
      mkInput({
        fenBefore: FORCED,
        legalMoveCount: 1,
        played: line('h1g2', { mate: -1 }),
        best: line('h1g2', { cp: 900 }),
        book: { after: { eco: 'A00', name: 'X' }, beforeIsStartOrBook: true },
      }),
      S,
    );
    expect(r.label).toBe('forced');
  });
});

describe('classifyMove: Great', () => {
  const great = (winBest: number, winSecond: number, over: Parameters<typeof mkInput>[0] = {}) =>
    classifyMove(
      mkInput({ played: line('e2e4', scoreForWin(winBest)), best: line('e2e4', scoreForWin(winBest)), playedIsBest: true, second: line('d2d4', scoreForWin(winSecond)), ...over }),
      S,
    );

  it('only move (2nd best is a Mistake) -> Great', () => {
    const r = great(60, 49.99);
    expect(r.label).toBe('great');
    expect(r.labelReason.great!.secondBestLoss).toBeCloseTo(10.01, 6);
    expect(r.labelReason.winChance).toBe('best');
  });
  it('2nd best just below the mistake threshold -> Best', () => {
    expect(great(60, 50.01).label).toBe('best');
  });
  it('win% after best at the window edges -> Great; outside -> Best', () => {
    // win% can't drop below 2.45 (cp clamp), so with the defaults the lower edge (10) is never the binding one
    expect(great(12.5, 2.45).label).toBe('great');
    const s = withSettings((x) => (x.great.minWinAfterBest = 20));
    const g = (wb: number, ws: number) =>
      classifyMove(mkInput({ played: line('e2e4', scoreForWin(wb)), best: line('e2e4', scoreForWin(wb)), playedIsBest: true, second: line('d2d4', scoreForWin(ws)) }), s).label;
    expect(g(20.001, 5)).toBe('great');
    expect(g(19.999, 5)).toBe('best'); // already lost: the choice is irrelevant
    expect(great(96.999, 80).label).toBe('great');
  });
  it('already totally winning: Great only if the 2nd best throws away the win', () => {
    expect(great(97.5, 80).label).toBe('best'); // still winning after the 2nd best: choice irrelevant
    expect(great(97.5, 70.01).label).toBe('best');
    expect(great(97.5, 69.99).label).toBe('great'); // 2nd best throws away the win
  });
  it('requires the played move to be Best and a 2nd line', () => {
    expect(great(60, 30, { playedIsBest: false, played: line('g1f3', scoreForWin(60)) }).label).toBe('best'); // equal to #1 but not #1
    expect(great(60, 30, { second: null }).label).toBe('best');
  });
  it('requires >= minLegalMoves legal moves (setting)', () => {
    const s = withSettings((x) => (x.great.minLegalMoves = 25));
    const r = classifyMove(
      mkInput({ played: line('e2e4', scoreForWin(60)), best: line('e2e4', scoreForWin(60)), playedIsBest: true, second: line('d2d4', scoreForWin(30)) }),
      s,
    );
    expect(r.label).toBe('best');
  });
  it('interpretation: an obvious take-back (recapture on the square just captured on) is not Great', () => {
    const base = {
      fenBefore: SCANDI_TAKE,
      legalMoveCount: countLegalMoves(SCANDI_TAKE),
      played: line('d8d5', { cp: 0 }),
      best: line('d8d5', { cp: 0 }),
      playedIsBest: true,
      second: line('g8f6', { cp: -150 }),
    };
    expect(classifyMove(mkInput(base), S).label).toBe('great'); // no prev info: the numbers say "only move"
    const prev = { winLoss: 0, winBefore: 50, winAfter: 50, uci: 'e4d5' };
    expect(classifyMove(mkInput({ ...base, prev }), S).label).toBe('best');
    // a non-capturing only move after the same previous move stays Great
    const r = classifyMove(mkInput({ ...base, played: line('g8f6', { cp: 0 }), best: line('g8f6', { cp: 0 }), second: line('d8d5', { cp: -150 }), prev }), S);
    expect(r.label).toBe('great');
  });
});

describe('classifyMove: Miss', () => {
  // opponent POV: 30% before their move, 15% after -> they gave the mover 15 win% (mover: 70 -> 85)
  const prev = { winLoss: 15, winBefore: 30, winAfter: 15 };

  it('fails to punish a Mistake with a Mistake-sized loss -> Miss', () => {
    const r = byLoss(85, 12, { prev });
    expect(r.labelReason.winChance).toBe('mistake');
    expect(r.labelReason.miss).toBe(true);
    expect(r.label).toBe('miss');
  });
  it('replaces Inaccuracy too (winLoss just above the floor)', () => {
    expect(byLoss(85, 5.01, { prev }).label).toBe('miss');
  });
  it('winLoss at the floor (5) is Good, not Miss', () => {
    const r = byLoss(85, 5, { prev });
    expect(r.label).toBe('good');
    expect(r.labelReason.miss).toBeUndefined();
  });
  it('a Blunder stays a Blunder (miss flag still reported)', () => {
    const r = byLoss(85, 25, { prev });
    expect(r.label).toBe('blunder');
    expect(r.labelReason.miss).toBe(true);
  });
  it('opponent move below the mistake threshold -> no Miss', () => {
    expect(byLoss(85, 12, { prev: { ...prev, winLoss: 9.99 } }).label).toBe('mistake');
    expect(byLoss(85, 12, { prev: { ...prev, winLoss: 10 } }).label).toBe('miss'); // >= threshold
  });
  it('best move must keep at least half of the gain', () => {
    // mover had 70 before the opponent's mistake; gain 15 -> best must reach >= 77.5
    expect(byLoss(77.6, 8, { prev }).label).toBe('miss');
    expect(byLoss(77.4, 8, { prev }).label).toBe('inaccuracy');
  });
  it('no previous move context -> no Miss', () => {
    expect(byLoss(85, 12).label).toBe('mistake');
    expect(byLoss(85, 12, { prev: null }).label).toBe('mistake');
  });
});

describe('materialCheck (SPEC material rule)', () => {
  const hangQueen = (bestCp: number, playedCp: number, s = S) =>
    materialCheck(
      { fenBefore: MAT, playedPv: ['d2g5', 'h6g5', 'f3g5', 'a8d8'], bestPv: ['e1e7', 'b7b5'], playedScore: { cp: playedCp }, bestScore: { cp: bestCp } },
      s,
    );

  it('hung queen while +12 -> Blunder, with the hung piece', () => {
    const m = hangQueen(1342, 683);
    expect(m).toMatchObject({ playedLine: 4, bestLine: 12, loss: 8, evalDropCp: 317, label: 'blunder', hung: { role: 'queen', square: 'g5', color: 'white' } });
  });
  it('eval drop is measured on clamped scores', () => {
    expect(hangQueen(5000, 1100).evalDropCp).toBe(0);
    expect(hangQueen(5000, 1100).label).toBeUndefined(); // still > +10: SPEC clamp exempts it
    expect(hangQueen(1342, 683).evalDropCp).toBe(1000 - 683);
  });
  it('eval-drop boundaries: 250 -> Blunder, 249 -> Mistake, 150 -> Mistake, 149 -> none', () => {
    expect(hangQueen(900, 650).label).toBe('blunder');
    expect(hangQueen(900, 651).label).toBe('mistake');
    expect(hangQueen(900, 750).label).toBe('mistake');
    expect(hangQueen(900, 751).label).toBeUndefined();
  });
  it('material-loss boundaries come from settings (>=)', () => {
    const at = (blunderMinLoss: number, mistakeMinLoss: number) =>
      hangQueen(900, 500, withSettings((x) => Object.assign(x.material, { blunderMinLoss, mistakeMinLoss }))).label;
    expect(at(8, 8)).toBe('blunder');
    expect(at(8.01, 8)).toBe('mistake');
    expect(at(8.01, 8.01)).toBeUndefined();
  });
  it('a hung bishop (loss 3) in an equal position', () => {
    const m = materialCheck({ fenBefore: E4E5, playedPv: ['f1a6', 'b8a6', 'g1f3'], bestPv: ['g1f3', 'b8c6'], playedScore: { cp: -300 }, bestScore: { cp: 30 } }, S);
    expect(m).toMatchObject({ playedLine: -3, bestLine: 0, loss: 3, evalDropCp: 330, label: 'blunder', hung: { role: 'bishop', square: 'a6' } });
  });
  it('loss of 3 with a small eval drop (a sound sacrifice) is exempt', () => {
    const m = materialCheck({ fenBefore: E4E5, playedPv: ['f1a6', 'b8a6', 'g1f3'], bestPv: ['g1f3', 'b8c6'], playedScore: { cp: -100 }, bestScore: { cp: 30 } }, S);
    expect(m.loss).toBe(3);
    expect(m.label).toBeUndefined();
  });
  it('an even queen trade loses no material', () => {
    const m = materialCheck({ fenBefore: TRADE, playedPv: ['d1d8', 'f8d8', 'a1d1'], bestPv: ['d1f3', 'b7b6'], playedScore: { cp: 300 }, bestScore: { cp: 900 } }, S);
    expect(m).toMatchObject({ playedLine: 5, bestLine: 5, loss: 0 });
    expect(m.label).toBeUndefined();
    expect(m.hung).toBeUndefined();
  });
  it('interpretation: failing to win material is not "throwing it away" (reference capped at the baseline)', () => {
    const fen = after('e2e4 e7e5 f1a6'); // Black can take the bishop
    const m = materialCheck({ fenBefore: fen, playedPv: ['g8f6', 'a6e2'], bestPv: ['b8a6', 'g1f3'], playedScore: { cp: 0 }, bestScore: { cp: 400 } }, S);
    expect(lineMaterial(fen, ['b8a6', 'g1f3'], { horizonPlies: 12 }).balance).toBe(3);
    expect(m).toMatchObject({ playedLine: 0, bestLine: 0, loss: 0 });
    expect(m.label).toBeUndefined();
  });
  it('a pending recapture counts: not recapturing loses the piece (baseline before the opponent\'s capture)', () => {
    const input = { fenBefore: RUY_BXC6, playedPv: ['g8f6', 'e1g1'], bestPv: ['d7c6', 'e1g1'], playedScore: { cp: -300 }, bestScore: { cp: 0 } };
    const withoutPrev = materialCheck(input, S);
    expect(withoutPrev.loss).toBe(0); // without context the bishop on c6 looks like a gain the mover failed to make
    const withPrev = materialCheck({ ...input, prevFenBefore: RUY_BXC6_BEFORE }, S);
    expect(withPrev).toMatchObject({ playedLine: -3, bestLine: 0, loss: 3, label: 'blunder' });
  });
  it('best line is a mating sacrifice: the reference is the baseline, not the sacrificed material', () => {
    const bestPv = ['c4g8', 'f8g8', 'h6f7'];
    expect(lineMaterial(SMOTHER, bestPv, { horizonPlies: 12 })).toMatchObject({ mate: 'mover', balance: -1, startBalance: 8 });
    // played: Qf7?? Rxf7 Nxf7+ Kg8 -> down the queen for a rook
    const m = materialCheck({ fenBefore: SMOTHER, playedPv: ['c4f7', 'f8f7', 'h6f7', 'h8g8', 'f7g5'], bestPv, playedScore: { cp: 400 }, bestScore: { mate: 2 } }, S);
    expect(m).toMatchObject({ playedLine: 4, bestLine: 8, loss: 4, evalDropCp: 600, label: 'blunder', hung: { role: 'queen', square: 'f7' } });
  });
  it('a played move that still mates is never flagged (even with sacrifices in its line)', () => {
    const m = materialCheck(
      { fenBefore: SMOTHER, playedPv: ['h6f7', 'h8g8', 'f7h6', 'g8h8', 'c4g8', 'f8g8', 'h6f7'], bestPv: ['c4g8', 'f8g8', 'h6f7'], playedScore: { mate: 4 }, bestScore: { mate: 2 } },
      S,
    );
    expect(m.loss).toBe(0);
    expect(m.label).toBeUndefined();
  });
  it('tolerates illegal PV tails', () => {
    const m = materialCheck({ fenBefore: E4E5, playedPv: ['f1a6', 'b8a6', 'zzzz', 'e1e8'], bestPv: ['g1f3', 'a1a8'], playedScore: { cp: -300 }, bestScore: { cp: 30 } }, S);
    expect(m).toMatchObject({ playedLine: -3, bestLine: 0, loss: 3, label: 'blunder' });
  });
});

describe('findHung', () => {
  const moves = (fen: string, pv: string[]) => lineMaterial(fen, pv, { horizonPlies: 99 }).moves;
  it('queen takes a defended pawn -> hung queen', () => {
    const fen = '4k3/8/4p3/3p4/8/8/8/3QK3 w - - 0 1';
    expect(findHung(moves(fen, ['d1d5', 'e6d5']), 'white')).toEqual({ role: 'queen', square: 'd5', color: 'white' });
  });
  it('even trades and mover-favourable exchanges are not hung pieces', () => {
    expect(findHung(moves(TRADE, ['d1d8', 'f8d8', 'a1d1']), 'white')).toBeUndefined();
    expect(findHung(moves('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', ['e4d5', 'e8d7']), 'white')).toBeUndefined();
  });
  it('no captures -> undefined', () => {
    expect(findHung(moves(INITIAL_FEN, ['e2e4', 'e7e5']), 'white')).toBeUndefined();
  });
});

describe('classifyMove: material rule integration ("worse of")', () => {
  const MAT_INPUT = (playedCp: number, bestCp = 1342) =>
    mkInput({
      fenBefore: MAT,
      legalMoveCount: countLegalMoves(MAT),
      played: line('d2g5', { cp: playedCp }, ['d2g5', 'h6g5', 'f3g5', 'a8d8']),
      best: line('e1e7', { cp: bestCp }, ['e1e7', 'b7b5']),
    });

  it('hung queen at +12: win-chance Inaccuracy, material Blunder -> Blunder', () => {
    const r = classifyMove(MAT_INPUT(683), S);
    expect(r.labelReason.winChance).toBe('inaccuracy');
    expect(r.labelReason.material?.label).toBe('blunder');
    expect(r.label).toBe('blunder');
  });
  it('material Mistake vs win-chance Good -> Mistake', () => {
    const r = classifyMove(MAT_INPUT(800, 1000), S); // drop 200: material Mistake; winLoss ~2.5: Good
    expect(r.labelReason.winChance).toBe('good');
    expect(r.labelReason.material?.label).toBe('mistake');
    expect(r.label).toBe('mistake');
  });
  it('win-chance Blunder beats material Mistake', () => {
    const r = classifyMove(MAT_INPUT(-240, 0), S); // drop 240: material Mistake; 50% -> 29.3%: Blunder
    expect(r.labelReason.material?.label).toBe('mistake');
    expect(r.labelReason.winChance).toBe('blunder');
    expect(r.label).toBe('blunder');
  });
  it('Miss vs material: material Mistake keeps Miss, material Blunder wins', () => {
    const prev = { winLoss: 15, winBefore: 30, winAfter: 15 };
    // mover had 70%, best now 92.9% (cp 700), played 82.0% (cp 420): Mistake by win chance -> Miss; drop 280
    const missMistake = classifyMove({ ...MAT_INPUT(420, 700), prev }, withSettings((x) => (x.material.blunderMinEvalDropCp = 500)));
    expect(missMistake.labelReason.winChance).toBe('mistake');
    expect(missMistake.labelReason.material?.label).toBe('mistake');
    expect(missMistake.label).toBe('miss');
    const missBlunder = classifyMove({ ...MAT_INPUT(420, 700), prev }, S);
    expect(missBlunder.labelReason.material?.label).toBe('blunder');
    expect(missBlunder.labelReason.miss).toBe(true);
    expect(missBlunder.label).toBe('blunder');
  });
  it('a PV that does not start with the played move is replaced by the move alone', () => {
    const r = classifyMove(mkInput({ fenBefore: MAT, legalMoveCount: 40, played: line('d2g5', { cp: 683 }, ['e1e7']), best: line('e1e7', { cp: 1342 }, ['e1e7']) }), S);
    expect(r.labelReason.material?.playedLine).toBe(12); // only Qg5 played: nothing captured yet
  });
  it('rejects an illegal played move', () => {
    expect(() => classifyMove(mkInput({ played: line('e2e5', { cp: 0 }) }), S)).toThrow(/illegal move/);
  });
});

describe('classifyMove: Book', () => {
  const book = { after: { eco: 'C60', name: 'Ruy Lopez' }, beforeIsStartOrBook: true };
  it('in book, before is book, chain intact -> Book (with the opening name)', () => {
    const r = byLoss(55, 3, { book });
    expect(r.label).toBe('book');
    expect(r.labelReason.book).toEqual({ eco: 'C60', name: 'Ruy Lopez' });
    expect(r.labelReason.winChance).toBe('good');
  });
  it('chain broken (an earlier move was not book) -> not Book', () => {
    expect(byLoss(55, 3, { book: { ...book, earlierMovesAllBook: false } }).label).toBe('good');
    expect(byLoss(55, 3, { book: { ...book, earlierMovesAllBook: true } }).label).toBe('book');
  });
  it('position before not start/book, or position after not in book -> not Book', () => {
    expect(byLoss(55, 3, { book: { ...book, beforeIsStartOrBook: false } }).label).toBe('good');
    const r = byLoss(55, 3, { book: { after: null, beforeIsStartOrBook: true } });
    expect(r.label).toBe('good');
    expect(r.labelReason.book).toBeUndefined();
  });
  it('interpretation: a dubious gambit (Mistake) stays Book, a trap victim (Blunder) does not', () => {
    expect(byLoss(55, 15, { book }).label).toBe('book');
    const r = byLoss(55, 30, { book });
    expect(r.label).toBe('blunder');
    expect(r.labelReason.book).toEqual({ eco: 'C60', name: 'Ruy Lopez' });
  });
  it('a material Blunder also loses Book', () => {
    const r = classifyMove(
      mkInput({
        fenBefore: MAT,
        legalMoveCount: 40,
        played: line('d2g5', { cp: 683 }, ['d2g5', 'h6g5', 'f3g5', 'a8d8']),
        best: line('e1e7', { cp: 1342 }, ['e1e7', 'b7b5']),
        book: { after: { eco: 'Z99', name: 'Imaginary' }, beforeIsStartOrBook: true },
      }),
      S,
    );
    expect(r.label).toBe('blunder');
  });
  it('the best move in book is Book (not Best/Great)', () => {
    const r = classifyMove(mkInput({ played: line('e2e4', { cp: 30 }), best: line('e2e4', { cp: 30 }), playedIsBest: true, second: line('d2d4', { cp: -900 }), book }), S);
    expect(r.label).toBe('book');
  });
});
