// (Brilliant like chess.com) The board half of the rule (analysis/brilliant.ts staticSacrifice) and the gate
// (classify.ts brilliantCheck): a piece left en prise counts as a sacrifice even when the opponent mustn't take it or
// the material comes back.
import { DEFAULT_SETTINGS } from '@chess-coach/shared';
import { describe, expect, it } from 'vitest';
import { staticSacrifice } from '../src/analysis/brilliant';
import { brilliantCheck, classifyMove, countLegalMoves } from '../src/analysis/classify';
import { line } from './helpers/classifyHelpers';

const S = DEFAULT_SETTINGS;
const pv = (s: string) => s.split(' ');
const OPERA = '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16';
// Legal's mate: 1.e4 e5 2.Nf3 d6 3.Bc4 Bg4 4.Nc3 g6 — 5.Nxe5!! leaves the queen to ...Bxd1 (6.Bxf7+ Ke7 7.Nd5#)
const LEGAL = 'rn1qkbnr/ppp2p1p/3p2p1/4p3/2B1P1b1/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 5';

describe('staticSacrifice', () => {
  it('a piece offered: the queen on b8 (Opera), the queen left on d1 (Legal)', () => {
    expect(staticSacrifice(OPERA, 'b3b8')).toMatchObject({ piece: { role: 'queen', square: 'b8' }, value: 9 });
    // the knight took a pawn: the queen is offered, worth 9 - 1
    expect(staticSacrifice(LEGAL, 'f3e5')).toMatchObject({ piece: { role: 'queen', square: 'd1' }, value: 8 });
  });

  it('quiet moves and plain trades are no sacrifice', () => {
    expect(staticSacrifice(OPERA, 'c2c3')).toEqual({ reject: 'no-unsafe-piece' });
    expect(staticSacrifice('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e4')).toEqual({ reject: 'no-unsafe-piece' });
    // 1.e4 d5 2.exd5: a pawn takes a pawn
    expect(staticSacrifice('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'e4d5')).toEqual({ reject: 'no-unsafe-piece' });
  });

  it('a counter-threat is no sacrifice: taking the knight leaves the queen to the bishop', () => {
    // Bg5 (defended by h4) already hits the queen on d8; Nd5 walks into ...exd5, after which the queen still hangs
    expect(staticSacrifice('3q2k1/3p1ppp/4p3/6B1/7P/2N5/PPP2PP1/6K1 w - - 0 1', 'c3d5')).toEqual({ reject: 'danger-levels' });
  });

  it('a promotion is never Brilliant', () => {
    expect(staticSacrifice('8/P5k1/8/8/8/8/6K1/8 w - - 0 1', 'a7a8q')).toEqual({ reject: 'promotion' });
  });
});

describe('brilliantCheck (chess.com gate)', () => {
  const input = (fen: string, played: ReturnType<typeof line>, second: ReturnType<typeof line> | null) => ({
    fenBefore: fen,
    legalMoveCount: countLegalMoves(fen),
    played,
    playedIsBest: true,
    best: played,
    second,
  });

  it("Legal's mate 5.Nxe5: Brilliant, though the line wins the material back (the old rule wanted it to end down)", () => {
    const nxe5 = line('f3e5', { cp: 190 }, pv('f3e5 d6e5 d1g4 g8f6 g4e2'));
    const r = classifyMove(input(LEGAL, nxe5, line('h2h3', { cp: 40 }, pv('h2h3 g4f3 d1f3'))), S);
    expect(r.label).toBe('brilliant');
    expect(r.labelReason.brilliant).toMatchObject({ piece: { role: 'queen', square: 'd1' } });
  });

  it('not when the alternative keeps >= 700 cp (completely winning anyway), nor when worse after', () => {
    const nxe5 = line('f3e5', { cp: 900 }, pv('f3e5 d6e5 d1g4'));
    expect(brilliantCheck(input(LEGAL, nxe5, line('h2h3', { cp: 720 }, pv('h2h3'))), true, 95, 0, S)).toEqual({ reject: 'winning-anyway' });
    expect(brilliantCheck(input(LEGAL, line('f3e5', { cp: -50 }, pv('f3e5')), line('h2h3', { cp: -80 }, pv('h2h3'))), true, 45, 0, S)).toEqual({ reject: 'worse-after' });
  });

  it('not out of check (the move had to be played)', () => {
    const fen = '4k3/8/8/8/8/8/3q4/R3K3 w - - 0 1';
    const kxd2 = line('e1d2', { cp: 500 }, pv('e1d2'));
    expect(brilliantCheck(input(fen, kxd2, line('e1f1', { cp: -900 }, pv('e1f1'))), true, 85, 0, S)).toEqual({ reject: 'in-check' });
  });
});

describe('staticSacrifice: an even exchange is no sacrifice', () => {
  it('Qxe8+ Qxe8 Rxe8+ Rxe8 (the a8 rook x-rays e8): a trade, not a queen offer (Lichess 57RP5sCb 15.Qxe8+)', () => {
    expect(staticSacrifice('r2qr1k1/pbp2p1p/1p3p2/8/3n4/5NP1/PP2QPBP/R3R1K1 w - - 0 15', 'e2e8')).toEqual({ reject: 'even-exchange' });
  });

  it('a bishop for a pawn into a pawn is still one (Lichess 6Vvx9xNI 28.Bxg5)', () => {
    expect(staticSacrifice('6k1/1p3rb1/p2Q1p2/2pP1Pp1/3p4/3P4/P1qB2P1/4R1K1 w - - 0 28', 'd2g5')).toMatchObject({ piece: { role: 'bishop', square: 'g5' }, value: 2 });
  });
});

describe('staticSacrifice: a piece left hanging is not offered', () => {
  // mistermine102's game, side line 32.Ra7: the b6 bishop was en prise to …Nxb6 already with the rook on a8
  const RA7 = 'R7/4bkp1/1Bp1b3/3nPp1p/7P/2P2N2/5PP1/6K1 w - - 0 32';
  it('Ra7 leaves the already-hanging bishop where it was: no sacrifice', () => {
    expect(staticSacrifice(RA7, 'a8a7')).toEqual({ reject: 'already-hanging' });
    // still hanging before the opponent's last move too (…h6-h5: the knight was already on d5)
    expect(staticSacrifice(RA7, 'a8a7', 'R7/4bkp1/1Bp1b2p/3nPp2/7P/2P2N2/5PP1/6K1 b - - 0 31')).toEqual({ reject: 'already-hanging' });
  });
  it('ignoring a fresh threat is an offer: …Nd5 just attacked the bishop, Ra7 lets it go', () => {
    const r = staticSacrifice(RA7, 'a8a7', 'R7/4bkp1/1Bp1bn2/4Pp1p/7P/2P2N2/5PP1/6K1 b - - 0 31');
    expect(r).toMatchObject({ piece: { role: 'bishop', square: 'b6' } });
  });
});
