// Unit tests for analysis/classify.ts (synthetic engine data on real, legal positions).
import { DEFAULT_SETTINGS, type AnalysisSettings, type Label, winPercent } from '@chess-coach/shared';
import { INITIAL_FEN } from 'chessops/fen';
import { describe, expect, it } from 'vitest';
import {
  LABEL_SEVERITY,
  classifyMove,
  countLegalMoves,
  findHung,
  lostInLine,
  hungSeeLoss,
  materialBaseline,
  guardCp,
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
    [0, 'excellent'], // Best is only the engine's #1 move (classifyMove), never a win-chance band
    [0.5, 'excellent'],
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
    [0, 'excellent'], // scores as well as #1 but isn't #1
    [0.499, 'excellent'],
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

  it('a played move scored higher than the best move is Excellent, not Best (winLoss clamped at 0)', () => {
    const r = byLoss(60, -3);
    expect(r).toMatchObject({ label: 'excellent', winLoss: 0 });
  });

  it('already lost: losses are compressed by the clamp', () => {
    const r = classifyMove(mkInput({ best: line('d2d4', { cp: -900 }), played: line('e2e4', { cp: -1500 }) }), S);
    expect(r.winLoss).toBeLessThan(2);
    expect(r.label).toBe('excellent');
  });
});

describe('classifyMove: mate scores', () => {
  it('had mate, still mates (slower) -> Excellent, not a mistake', () => {
    const r = classifyMove(mkInput({ best: line('d2d4', { mate: 2 }), played: line('e2e4', { mate: 9 }) }), S);
    expect(r).toMatchObject({ label: 'excellent', winLoss: 0 });
  });
  it('had a long mate and lost it -> classified by the remaining win%', () => {
    expect(classifyMove(mkInput({ best: line('d2d4', { mate: 5 }), played: line('e2e4', { cp: 900 }) }), S).label).toBe('excellent');
    expect(classifyMove(mkInput({ best: line('d2d4', { mate: 5 }), played: line('e2e4', { cp: 500 }) }), S).label).toBe('mistake');
    expect(classifyMove(mkInput({ best: line('d2d4', { mate: 5 }), played: line('e2e4', { cp: 0 }) }), S).label).toBe('blunder');
  });
  it('missed mate: had mate in <= 3 and played a non-mating move -> at least Miss (Blunder stays)', () => {
    const r = classifyMove(mkInput({ best: line('d2d4', { mate: 3 }), played: line('e2e4', { cp: 900 }) }), S);
    expect(r).toMatchObject({ label: 'miss', labelReason: { winChance: 'excellent', missedMate: { mateIn: 3 } } });
    expect(r.labelReason.miss).toBeUndefined(); // the "punish the opponent's mistake" Miss is a different rule
    expect(classifyMove(mkInput({ best: line('d2d4', { mate: 1 }), played: line('e2e4', { cp: 500 }) }), S).label).toBe('miss');
    const b = classifyMove(mkInput({ best: line('d2d4', { mate: 2 }), played: line('e2e4', { cp: 0 }) }), S);
    expect(b).toMatchObject({ label: 'blunder', labelReason: { missedMate: { mateIn: 2 } } });
    // a slower mate is not a missed mate; neither is a mate in 4 (outside missedMaxMoves)
    expect(classifyMove(mkInput({ best: line('d2d4', { mate: 1 }), played: line('e2e4', { mate: 6 }) }), S).labelReason.missedMate).toBeUndefined();
    expect(classifyMove(mkInput({ best: line('d2d4', { mate: 4 }), played: line('e2e4', { cp: 900 }) }), S).labelReason.missedMate).toBeUndefined();
    // setting
    const s5 = withSettings((x) => (x.mate.missedMaxMoves = 5));
    expect(classifyMove(mkInput({ best: line('d2d4', { mate: 5 }), played: line('e2e4', { cp: 900 }) }), s5).label).toBe('miss');
  });
  it('allowing a mate is a Blunder', () => {
    const r = classifyMove(mkInput({ best: line('d2d4', { cp: 50 }), played: line('e2e4', { mate: -3 }) }), S);
    expect(r.label).toBe('blunder');
  });
  it('getting mated a little faster when mated anyway is Excellent (no allowed-mate: not "much" longer)', () => {
    const r = classifyMove(mkInput({ best: line('d2d4', { mate: -4 }), played: line('e2e4', { mate: -2 }) }), S);
    expect(r).toMatchObject({ label: 'excellent', winLoss: 0 });
    expect(r.labelReason.allowedMate).toBeUndefined();
    // a long forced mate against the mover is "allowed" by any move
    expect(classifyMove(mkInput({ best: line('d2d4', { mate: -8 }), played: line('e2e4', { mate: -6 }) }), S).label).toBe('excellent');
  });
  it('allowed mate: a mate in <= 3 the best move avoids (or delays by >= 3 moves) -> Blunder even at ~0 %', () => {
    // already totally lost by win% (-10 vs mated: both ~2.5 %), but the move walks into mate in 2
    const r = classifyMove(mkInput({ best: line('d2d4', { cp: -1010 }), played: line('e2e4', { mate: -2 }) }), S);
    expect(r).toMatchObject({ label: 'blunder', labelReason: { winChance: 'excellent', allowedMate: { matedIn: 2 } } });
    expect(r.winLoss).toBeLessThan(0.5);
    // the best move is mated too, but much later
    const l = classifyMove(mkInput({ best: line('d2d4', { mate: -8 }), played: line('e2e4', { mate: -2 }) }), S);
    expect(l).toMatchObject({ label: 'blunder', labelReason: { allowedMate: { matedIn: 2, bestMatedIn: 8 } } });
    // mate in 4 is outside allowedMaxMoves (3): win% decides
    expect(classifyMove(mkInput({ best: line('d2d4', { cp: -1010 }), played: line('e2e4', { mate: -4 }) }), S).label).toBe('excellent');
    // the engine's own #1 move is never "allowing" (every move is at least as bad)
    const own = classifyMove(mkInput({ best: line('e2e4', { mate: -1 }), played: line('e2e4', { mate: -1 }), playedIsBest: true }), S);
    expect(own.label).toBe('best');
    // a single legal move stays Forced
    expect(classifyMove(mkInput({ legalMoveCount: 1, best: line('d2d4', { cp: -1010 }), played: line('e2e4', { mate: -1 }) }), S).label).toBe('forced');
    const s2 = withSettings((x) => (x.mate.allowedMaxMoves = 1));
    expect(classifyMove(mkInput({ best: line('d2d4', { cp: -1010 }), played: line('e2e4', { mate: -2 }) }), s2).label).toBe('excellent');
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
    expect(great(69.999, 55).label).toBe('great');
    // M3: winning (>= 70 after the best move) and still winning after the 2nd best -> the choice doesn't change the result
    expect(great(94, 82).label).toBe('best');
    expect(great(94, 69.9).label).toBe('great'); // ... unless the 2nd best throws the win away
  });
  it('M3: obvious only-moves are not Great (check evasion with <= 3 moves, free capture, combination continuation)', () => {
    // 11...g6 blocking Qh5+ (3 legal moves; Kd7/Ke7 lose) — vpfyow62
    const CHECK = 'r2qkbnr/pb4pp/2pp4/4p2Q/B3P3/2N5/PPP3PP/R3K1NR b KQkq - 1 11';
    const inCheck = (s = S) =>
      classifyMove(mkInput({ fenBefore: CHECK, legalMoveCount: countLegalMoves(CHECK), played: line('g7g6', { cp: -8 }), best: line('g7g6', { cp: -8 }), playedIsBest: true, second: line('e8d7', { cp: -163 }) }), s);
    expect(countLegalMoves(CHECK)).toBe(3);
    expect(inCheck().label).toBe('best');
    expect(inCheck(withSettings((x) => (x.great.maxLegalMovesInCheck = 2))).label).toBe('great');
    // taking a hanging knight (SEE +3)
    const FREE = '4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1';
    const take = classifyMove(mkInput({ fenBefore: FREE, legalMoveCount: countLegalMoves(FREE), played: line('d1d5', { cp: 600 }), best: line('d1d5', { cp: 600 }), playedIsBest: true, second: line('d1d2', { cp: 0 }) }), S);
    expect(take.label).toBe('best');
    // 24.Qe8+ (mate in 2) after the forced 23...Rxd8 — the combination began with 23.Rxd8+ (PuBQ0CoQ)
    const CONT = '3r2k1/5ppp/p7/8/4Q3/8/q4PPP/4R1K1 w - - 0 24';
    const prevFen = 'r2R2k1/5ppp/p7/8/4Q3/8/q4PPP/4R1K1 b - - 0 23';
    expect(countLegalMoves(prevFen)).toBe(1);
    const cont = (prevFenBefore: string | undefined) =>
      classifyMove(
        mkInput({
          fenBefore: CONT, legalMoveCount: countLegalMoves(CONT), played: line('e4e8', { mate: 2 }), best: line('e4e8', { mate: 2 }), playedIsBest: true, second: line('h2h4', { cp: -16 }),
          prev: { winLoss: 0, winBefore: 2.5, winAfter: 2.5, uci: 'a8d8', ...(prevFenBefore ? { fenBefore: prevFenBefore } : {}) },
        }),
        S,
      ).label;
    expect(cont(prevFen)).toBe('best');
    expect(cont(undefined)).toBe('great'); // (without the context it would be)
  });
  it('already winning (>= 70): Great only if the 2nd best throws away the win', () => {
    expect(great(97.5, 80).label).toBe('best'); // still winning after the 2nd best: choice irrelevant
    expect(great(97.5, 70.01).label).toBe('best');
    expect(great(97.5, 69.99).label).toBe('great'); // 2nd best throws away the win
  });
  it('requires the played move to be Best and a 2nd line', () => {
    expect(great(60, 30, { playedIsBest: false, played: line('g1f3', scoreForWin(60)) }).label).toBe('excellent'); // equal to #1 but not #1
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
    const noFree = withSettings((x) => (x.great.freeCaptureMinGain = 99)); // isolate the take-back rule (Qxd5 also wins a pawn)
    expect(classifyMove(mkInput(base), noFree).label).toBe('great'); // no prev info: the numbers say "only move"
    expect(classifyMove(mkInput(base), S).label).toBe('best'); // free pawn by SEE
    const prev = { winLoss: 0, winBefore: 50, winAfter: 50, uci: 'e4d5' };
    expect(classifyMove(mkInput({ ...base, prev }), noFree).label).toBe('best');
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
    expect(m).toMatchObject({ playedLine: 4, bestLine: 12, loss: 8, evalDropCp: 659, label: 'blunder', hung: { role: 'queen', square: 'g5', color: 'white' } });
  });
  it('eval drop uses unclamped cp: hanging the queen at +20 -> +11 is a Blunder', () => {
    expect(hangQueen(2000, 1100)).toMatchObject({ evalDropCp: 900, label: 'blunder' });
    expect(hangQueen(5000, 4800)).toMatchObject({ evalDropCp: 200, label: 'mistake' }); // tiny drop: guard (sacrifice-like)
  });
  it('mate scores map to large finite values decreasing with distance', () => {
    expect(guardCp({ mate: 1 })).toBe(99_900);
    expect(guardCp({ mate: 5 })).toBe(99_500);
    expect(guardCp({ mate: -3 })).toBe(-99_700);
    expect(guardCp({ mate: 0 })).toBe(-100_000);
    expect(guardCp({ cp: 2345 })).toBe(2345);
    // had a forced mate, hung the queen and no longer mates (still +15) -> Blunder
    const m = materialCheck(
      { fenBefore: MAT, playedPv: ['d2g5', 'h6g5', 'f3g5', 'a8d8'], bestPv: ['e1e7', 'b7b5'], playedScore: { cp: 1500 }, bestScore: { mate: 4 } },
      S,
    );
    expect(m.evalDropCp).toBe(99_600 - 1500);
    expect(m.label).toBe('blunder');
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
    expect(m).toMatchObject({ playedLine: 4, bestLine: 8, loss: 4, evalDropCp: 99_800 - 400, label: 'blunder', hung: { role: 'queen', square: 'f7' } });
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

describe('M3: material baseline and already-lost positions', () => {
  it('materialBaseline: a pending recapture keeps the entitlement, an unanswerable capture does not', () => {
    // 1.Qxd5 (Black can recapture exd5): Black's baseline is the balance before the capture
    expect(materialBaseline('k7/8/4p3/3Q4/8/8/8/4K3 b - - 0 1', 'k7/8/4p3/3p4/8/8/8/3QK3 w - - 0 1', -8)).toBe(-7);
    // 1.Kxe2 took an undefended queen (regression: 1ciG1v60 42.Kxe3 — every later Black move "threw away" 8)
    expect(materialBaseline('k7/8/8/8/8/8/4K3/8 b - - 0 1', 'k7/8/8/8/8/8/4q3/4K3 w - - 0 1', 0)).toBe(0);
    // the opponent's move didn't change the material
    expect(materialBaseline(after('e2e4 e7e5'), after('e2e4'), 0)).toBe(0);
  });
  it('already lost (best <= -10): only a piece hung right after the move fires the rule', () => {
    // 1.Kg1 lets ...a1=Q, the best line (Kg2) is cut before the promotion: a horizon effect, not thrown material
    const fen = '7k/8/8/8/8/8/p7/7K w - - 0 1';
    const mc = (bestCp: number) => materialCheck({ fenBefore: fen, playedPv: ['h1g1', 'a2a1q'], bestPv: ['h1g2'], playedScore: { cp: bestCp - 800 }, bestScore: { cp: bestCp } }, S);
    expect(mc(-500)).toMatchObject({ loss: 8, label: 'blunder' });
    expect(mc(-1200).label).toBeUndefined();
    expect(mc(-1200).loss).toBe(8); // the data is still there
    // a real hang still counts when lost: 1.Qd5?? exd5 at -12
    const q = materialCheck({ fenBefore: '4k3/8/4p3/3p4/8/8/8/3QK3 w - - 0 1', playedPv: ['d1d5', 'e6d5'], bestPv: ['e1e2'], playedScore: { cp: -2000 }, bestScore: { cp: -1200 } }, S);
    expect(q).toMatchObject({ label: 'blunder', hung: { role: 'queen' } });
  });
});

describe('findHung / lostInLine', () => {
  const moves = (fen: string, pv: string[]) => lineMaterial(fen, pv, { horizonPlies: 99 }).moves;
  const hung = (fen: string, pv: string[], mover: 'white' | 'black' = 'white') => findHung(fen, moves(fen, pv), mover);
  it('queen takes a defended pawn -> hung queen', () => {
    const fen = '4k3/8/4p3/3p4/8/8/8/3QK3 w - - 0 1';
    expect(hung(fen, ['d1d5', 'e6d5'])).toEqual({ role: 'queen', square: 'd5', color: 'white' });
    expect(lostInLine(moves(fen, ['d1d5', 'e6d5']), 'white')).toEqual([{ role: 'queen', square: 'd5', color: 'white', ply: 2 }]);
  });
  it('a quiet move that leaves another piece en prise -> that piece is hung', () => {
    // 1.Ke2?? leaves the undefended rook on a5 en prise to the black rook (SEE > 0 right after the move)
    const fen = '4k3/8/8/R6r/8/8/8/4K3 w - - 0 1';
    expect(hung(fen, ['e1e2', 'h5a5'])).toEqual({ role: 'rook', square: 'a5', color: 'white' });
  });
  it('hungSeeLoss / MaterialCheck.hungLoss = the static-exchange number (as the Immediate "hangs" fact)', () => {
    expect(hungSeeLoss('4k3/8/4p3/3p4/8/8/8/3QK3 w - - 0 1', 'd1d5', 'd5')).toBe(8); // Q for a pawn
    expect(hungSeeLoss('4k3/8/8/R6r/8/8/8/4K3 w - - 0 1', 'e1e2', 'a5')).toBe(5);
    const m = materialCheck({ fenBefore: '4k3/8/4p3/3p4/8/8/8/3QK3 w - - 0 1', playedPv: ['d1d5', 'e6d5'], bestPv: ['e1e2'], playedScore: { cp: -800 }, bestScore: { cp: 0 } }, S);
    expect(m).toMatchObject({ hung: { role: 'queen', square: 'd5' }, hungLoss: 8, loss: 8, label: 'blunder' });
  });
  it('even trades and mover-favourable exchanges are not hung pieces', () => {
    expect(hung(TRADE, ['d1d8', 'f8d8', 'a1d1'])).toBeUndefined();
    expect(lostInLine(moves(TRADE, ['d1d8', 'f8d8', 'a1d1']), 'white')).toEqual([]);
    expect(hung('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', ['e4d5', 'e8d7'])).toBeUndefined();
  });
  it('no captures -> undefined', () => {
    expect(hung(INITIAL_FEN, ['e2e4', 'e7e5'])).toBeUndefined();
  });
  it('regression (Opera game 10...cxb5): a piece lost later in the line is not "hung" right after the move', () => {
    // 10...cxb5 11.Bxb5+ Kd8 12.O-O-O+ Kc8 13.Rd3 Qb4 14.Rc3+ Nc6 15.Rxc6+: the knight only reaches c6 at ply 9
    const fen = 'rn2kb1r/p3qppp/2p2n2/1N2p1B1/2B1P3/1Q6/PPP2PPP/R3K2R b KQkq - 0 10';
    const pv = ['c6b5', 'c4b5', 'e8d8', 'e1c1', 'd8c8', 'd1d3', 'e7b4', 'd3c3', 'b8c6', 'c3c6', 'c8b7', 'b3f7', 'f8e7'];
    expect(hung(fen, pv, 'black')).toBeUndefined();
    expect(lostInLine(moves(fen, pv), 'black')).toEqual([{ role: 'knight', square: 'c6', color: 'black', ply: 10 }, { role: 'pawn', square: 'f7', color: 'black', ply: 12 }]);
    const m = materialCheck({ fenBefore: fen, playedPv: pv, bestPv: ['e7b4', 'b3b4', 'f8b4'], playedScore: { cp: -717 }, bestScore: { cp: -540 } }, S);
    expect(m.hung).toBeUndefined();
    expect(m.lostInLine?.[0]).toMatchObject({ role: 'knight', square: 'c6', ply: 10 });
  });
  it('a piece that is attacked right after the move but moved before it is lost is not "hung"', () => {
    // 1.Ke2 (rook a5 en prise) Rh2+ 2.Kd3 ... the rook later goes to a4 and is lost there: lost, but not hung on a4
    const fen = '4k3/8/8/R6r/8/8/8/4K3 w - - 0 1';
    const pv = ['e1e2', 'h5h2', 'e2d3', 'h2h3', 'd3c4', 'e8d7', 'a5a4', 'h3h4', 'c4b5', 'h4a4'];
    expect(hung(fen, pv)).toBeUndefined();
    expect(lostInLine(moves(fen, pv), 'white')).toEqual([{ role: 'rook', square: 'a4', color: 'white', ply: 10 }]);
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
