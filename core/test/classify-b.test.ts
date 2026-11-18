// Session B: Miss for missed free material (B1) and Brilliant (B2). Pure: engine lines are fixed (as Stockfish gave
// them at d14), so the tests don't depend on search noise.
import { DEFAULT_SETTINGS, type Fact } from '@chess-coach/shared';
import { INITIAL_FEN } from 'chessops/fen';
import { describe, expect, it } from 'vitest';
import { brilliantSacrifice, classifyMove, countLegalMoves, missedMaterial } from '../src/analysis/classify';
import { labelText, renderExplanation } from '../src/analysis/explain';
import { line, playUci } from './helpers/classifyHelpers';

const S = DEFAULT_SETTINGS;
const pv = (s: string) => s.split(' ');

describe('B1: missing a free queen is at least Miss, at any eval', () => {
  // mistermine102 vs M1_2_3M (chess.com, 2026-11-06): 1.e4 e5 2.Nf3 Nf6 3.Nc3 Bc5 4.Bc4 d6 5.d3 Nxe4 6.dxe4 Qh4?? 7.O-O
  const moves = pv('e2e4 e7e5 g1f3 g8f6 b1c3 f8c5 f1c4 d7d6 d2d3 f6e4 d3e4 d8h4');
  const prevFen = playUci(INITIAL_FEN, moves.slice(0, -1));
  const fen = playUci(INITIAL_FEN, moves);
  const best = line('f3h4', { cp: 1045 }, pv('f3h4 e8g8 c1d2 b8c6 c4b3 c6b4 h4f5 d6d5 c3d5 c8f5 e4f5 b4d5 b3d5'));
  const second = line('c4b5', { cp: 1016 }, pv('c4b5 c7c6 f3h4 c6b5 c3d5 e8g8 h4f5 c8f5 e4f5 e5e4 f5f6 f8e8 d5c7'));
  const castles = line('e1g1', { cp: 766 }, pv('e1g1 h4g4 b2b4 c5b6 a2a4 c8e6 c4e2 b8d7'));
  const prev = { winLoss: 6.6, winBefore: 9.1, winAfter: 2.5, fenBefore: prevFen, uci: 'd8h4' };
  const input = (played = castles) => ({ fenBefore: fen, legalMoveCount: countLegalMoves(fen), played, playedIsBest: false, best, second, prev });

  it('7.O-O (+10.5 -> +7.7, win-chance "Good") is a Miss: Nxh4 wins the queen for free', () => {
    const r = classifyMove(input(), S);
    expect(r.labelReason.winChance).toBe('good'); // the win% hardly moves at +10
    expect(r.label).toBe('miss');
    expect(r.labelReason.missedMaterial).toMatchObject({ piece: { role: 'queen', square: 'h4', color: 'black' }, free: true });
    expect(r.labelReason.missedMaterial!.gain).toBeGreaterThanOrEqual(3);
  });

  it('the label text names the free piece', () => {
    const r = classifyMove(input(), S);
    const t = labelText({ label: r.label, labelReason: r.labelReason, color: 'white', evalBefore: { cp: 1045 }, evalAfter: { cp: 766 }, winBefore: r.winBest, winAfter: r.winPlayed, winLoss: r.winLoss, uci: 'e1g1', bestSan: 'Nxh4', bestUci: 'f3h4', san: 'O-O' }, S);
    expect(t).toBe('Miss — Nxh4 wins the queen on h4 for free, and this move doesn\'t.');
  });

  it('a move that wins the queen another way is no Miss (Bxf7+ Kxf7 Nxh4)', () => {
    const bxf7 = line('c4f7', { cp: 953 }, pv('c4f7 e8f7 f3h4 c5b6 d1f3 f7e8 h4f5 g7g6'));
    expect(missedMaterial(input(bxf7), S)).toBeUndefined();
    expect(classifyMove(input(bxf7), S).label).not.toBe('miss');
  });

  it('a recapture the mover is entitled to is not "free material" (baseline before the opponent\'s capture)', () => {
    // 5...Nxe4: 6.dxe4 takes the knight back — the material only returns to the baseline
    const fen5 = playUci(INITIAL_FEN, moves.slice(0, 10));
    const fen5Before = playUci(INITIAL_FEN, moves.slice(0, 9));
    const r = missedMaterial({
      fenBefore: fen5,
      legalMoveCount: countLegalMoves(fen5),
      played: line('e1g1', { cp: 0 }, pv('e1g1 e4c3 b2c3')),
      playedIsBest: false,
      best: line('d3e4', { cp: 250 }, pv('d3e4 e8g8 e1g1')),
      second: null,
      prev: { winLoss: 15, winBefore: 50, winAfter: 35, fenBefore: fen5Before, uci: 'f6e4' },
    }, S);
    expect(r).toBeUndefined();
  });

  it('the Immediate sentence says what was missed, and the threat it also stops', () => {
    const misses: Fact = { type: 'misses', san: 'Nxh4', uci: 'f3h4', facts: [], free: { role: 'queen', square: 'h4', color: 'black' }, alsoStops: 'Qxf2#' };
    const defends: Fact = { type: 'defends-threat', move: 'h4f2', san: 'Qxf2#', gain: 0, mateIn: 1, facts: [{ type: 'checkmate' }] };
    const e = renderExplanation({ immediate: [defends, { type: 'castle', side: 'king' }, misses], short: [], long: [] }, { mover: 'white', label: 'miss', uci: 'e1g1' });
    expect(e.immediate.text[0]).toBe("Misses Nxh4, which wins Black's queen on h4 for free (and also stops Qxf2#).");
    expect(e.immediate.tones![0]).toBe('bad');
  });
});

describe('B2: Brilliant', () => {
  const asBest = (fen: string, played: ReturnType<typeof line>, second: ReturnType<typeof line> | null, prev: { fenBefore: string; uci: string } | null = null) => ({
    fenBefore: fen,
    legalMoveCount: countLegalMoves(fen),
    played,
    playedIsBest: true,
    best: played,
    second,
    prev: prev ? { winLoss: 0, winBefore: 50, winAfter: 50, ...prev } : null,
  });

  it('Opera game 16.Qb8+!! Nxb8 17.Rd8#: Brilliant (the queen is given up, the position stays won)', () => {
    const fen = '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16';
    const qb8 = line('b3b8', { mate: 2 }, pv('b3b8 d7b8 d1d8'));
    const qb7 = line('b3b7', { cp: 449 }, pv('b3b7 f7f6 b7c8 e8e7 g5e3 h7h5 c2c4 h5h4 c1b1 h4h3 g2g3 a7a5 c4c5 d7c5 c8c5 e7f7 c5a5'));
    const r = classifyMove(asBest(fen, qb8, qb7, { fenBefore: '4kb1r/p2B1ppp/4qn2/4p1B1/4P3/1Q6/PPP2PPP/2KR4 b k - 0 15', uci: 'f6d7' }), S);
    expect(r.label).toBe('brilliant');
    expect(r.labelReason.brilliant).toMatchObject({ piece: { role: 'queen', square: 'b8', color: 'white' } });
    expect(r.labelReason.brilliant!.sacrifice).toBe(9);
    const t = labelText({ label: r.label, labelReason: r.labelReason, color: 'white', evalBefore: { mate: 2 }, evalAfter: { mate: 2 }, winBefore: r.winBest, winAfter: r.winPlayed, winLoss: 0, uci: 'b3b8', bestSan: 'Qb8+', bestUci: 'b3b8', san: 'Qb8+' }, S);
    expect(t).toBe('Brilliant !! — a sound sacrifice: Qb8+ offers the queen on b8, and White stays winning.');
  });

  it('…but not when the alternative was completely winning anyway', () => {
    const fen = '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16';
    const qb8 = line('b3b8', { mate: 2 }, pv('b3b8 d7b8 d1d8'));
    const winningAnyway = line('b3b7', { cp: 900 }, pv('b3b7 f7f6 b7c8 e8e7'));
    expect(classifyMove(asBest(fen, qb8, winningAnyway), S).label).not.toBe('brilliant');
  });

  it('Deep Blue – Kasparov 1997 g6, 8.Nxe6: Brilliant (a knight for a pawn, still better)', () => {
    const fen = 'r1bqkb1r/pp1n1pp1/2p1pn1p/6N1/3P4/3B1N2/PPP2PPP/R1BQK2R w KQkq - 0 8';
    const nxe6 = line('g5e6', { cp: 122 }, pv('g5e6 f7e6 d3g6 e8e7 c1f4 d8a5 c2c3 a5a6 f4c7 f6d5 c7g3 e7d8 g6d3 a6b6'));
    const r = classifyMove(asBest(fen, nxe6, line('g5e4', { cp: 28 }, pv('g5e4 f6e4 d3e4 c6c5 c2c3 f8d6'))), S);
    expect(r.label).toBe('brilliant');
    expect(r.labelReason.brilliant).toMatchObject({ piece: { role: 'knight', square: 'e6' } });
  });

  it('…and the next move (9.O-O, the knight still en prise) is no sacrifice of its own', () => {
    const fen = 'r1b1kb1r/pp1nqpp1/2p1Nn1p/8/3P4/3B1N2/PPP2PPP/R1BQK2R w KQkq - 1 9';
    const oo = line('e1g1', { cp: 151 }, pv('e1g1 f7e6 d3g6 e8d8 c2c4 e7d6 g2g3 d6c7 f1e1 f8b4'));
    const r = classifyMove(asBest(fen, oo, line('d4d5', { cp: -175 }, pv('d4d5 c6d5 e1g1 f7e6 d3g6 e8d8'))), S);
    expect(r.label).not.toBe('brilliant');
    expect(brilliantSacrifice(asBest(fen, oo, null), true, r.winPlayed, 0, S)).toBeUndefined();
  });

  it('a mating queen offer after a forced recapture is Brilliant (Lichess PuBQ0CoQ 23.Rxd8+ Rxd8 24.Qe8+!! Rxe8 25.Rxe8#)', () => {
    const fen = '3r2k1/5ppp/p7/8/4Q3/8/q4PPP/4R1K1 w - - 0 24';
    const qe8 = line('e4e8', { mate: 2 }, pv('e4e8 d8e8 e1e8'));
    const r = classifyMove(asBest(fen, qe8, line('g2g3', { cp: -12 }, pv('g2g3 a2a3 e1b1 a3c3')), { fenBefore: 'r2R2k1/5ppp/p7/8/4Q3/8/q4PPP/4R1K1 b - - 0 23', uci: 'a8d8' }), S);
    expect(r.label).toBe('brilliant');
  });

  it('a plain trade or a recapture is no sacrifice', () => {
    const fen = playUci(INITIAL_FEN, pv('e2e4 d7d5'));
    const trade = line('e4d5', { cp: 30 }, pv('e4d5 d8d5 b1c3 d5a5'));
    expect(classifyMove(asBest(fen, trade, line('b1c3', { cp: 0 }, pv('b1c3 d5e4 c3e4'))), S).label).not.toBe('brilliant');
  });
});
