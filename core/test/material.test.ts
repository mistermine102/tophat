import { Chess } from 'chessops/chess';
import { INITIAL_FEN, parseFen } from 'chessops/fen';
import { describe, expect, it } from 'vitest';
import { PIECE_VALUES, lineMaterial, materialBalance, materialOf, positionFromFen } from '../src/chess/material';

const board = (fen: string) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap().board;

describe('PIECE_VALUES / materialOf / materialBalance', () => {
  it('uses P=1 N=3 B=3 R=5 Q=9 K=0', () => {
    expect(PIECE_VALUES).toEqual({ pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 });
  });

  it('counts the initial position', () => {
    const b = board(INITIAL_FEN);
    expect(materialOf(b, 'white')).toBe(39);
    expect(materialOf(b, 'black')).toBe(39);
    expect(materialBalance(b, 'white')).toBe(0);
  });

  it('balance is color minus opponent', () => {
    const b = board('r5k1/ppp2pp1/7p/8/8/5N2/PPPQ1PPP/4R1K1 w - - 0 1'); // Q+R+N+6p vs R+6p
    expect(materialOf(b, 'white')).toBe(9 + 5 + 3 + 6);
    expect(materialOf(b, 'black')).toBe(5 + 6);
    expect(materialBalance(b, 'white')).toBe(12);
    expect(materialBalance(b, 'black')).toBe(-12);
  });

  it('positionFromFen rejects invalid and illegal FENs', () => {
    expect(() => positionFromFen('not a fen')).toThrow(/invalid FEN/);
    expect(() => positionFromFen('8/8/8/8/8/8/8/8 w - - 0 1')).toThrow(/illegal position/);
  });
});

describe('lineMaterial', () => {
  // White Q+P vs Black Q+P; e4xd5 Qxd5 Qxd5 wins the queen
  const EXCH = '3qk3/8/8/3p4/4P3/8/8/3QK3 w - - 0 1';

  it('horizon 0 measures the start position', () => {
    const r = lineMaterial(EXCH, ['e4d5'], { horizonPlies: 0 });
    expect(r).toMatchObject({ mover: 'white', startBalance: 0, balance: 0, plies: 0, quiet: true, mate: null });
  });

  it('extends through captures until a quiet move', () => {
    const r = lineMaterial(EXCH, ['e4d5', 'd8d5', 'd1d5', 'e8e7', 'd5d4'], { horizonPlies: 1 });
    expect(r.plies).toBe(4); // e4xd5, Qxd5, Qxd5 (captures) then the quiet Ke7 ends the extension
    expect(r.balance).toBe(9);
    expect(r.delta).toBe(9);
    expect(r.quiet).toBe(true);
    expect(r.moves.map((m) => m.captured?.role ?? null)).toEqual(['pawn', 'pawn', 'queen', null]);
    expect(r.moves.map((m) => m.balanceAfter)).toEqual([1, 0, 9, 9]);
    expect(r.moves[0]).toMatchObject({ ply: 1, uci: 'e4d5', color: 'white', role: 'pawn', captured: { role: 'pawn', square: 'd5', color: 'black' } });
  });

  it('reports a non-quiet end when the PV runs out mid-exchange', () => {
    const r = lineMaterial(EXCH, ['e4d5', 'd8d5'], { horizonPlies: 1 });
    expect(r.plies).toBe(2);
    expect(r.balance).toBe(0);
    expect(r.quiet).toBe(false);
  });

  it('stops at the horizon when the last move was quiet', () => {
    const r = lineMaterial(EXCH, ['e1e2', 'e8e7', 'e4d5', 'd8d5'], { horizonPlies: 2 });
    expect(r.plies).toBe(2);
    expect(r.balance).toBe(0);
  });

  it('measures from the side to move at fen (black mover)', () => {
    const fen = '3qk3/8/8/3p4/4P3/8/8/3QK3 b - - 0 1';
    const r = lineMaterial(fen, ['d5e4', 'd1d8', 'e8d8'], { horizonPlies: 1 });
    expect(r.mover).toBe('black');
    expect(r.plies).toBe(3);
    expect(r.balance).toBe(1); // won a pawn, queens traded
  });

  it('extends through promotions', () => {
    const fen = '8/P7/8/8/8/8/k7/4K3 w - - 0 1';
    const r = lineMaterial(fen, ['a7a8q', 'a2b3', 'e1d2'], { horizonPlies: 1 });
    expect(r.plies).toBe(2);
    expect(r.startBalance).toBe(1);
    expect(r.balance).toBe(9);
    expect(r.moves[0]!.promotion).toBe('queen');
  });

  it('handles en passant captures', () => {
    const fen = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';
    const r = lineMaterial(fen, ['e5d6', 'e8d7'], { horizonPlies: 1 });
    expect(r.moves[0]!.captured).toEqual({ role: 'pawn', square: 'd5', color: 'black' });
    expect(r.balance).toBe(1);
    expect(r.plies).toBe(2);
  });

  it('castling (king-to-square or king-takes-rook) is not a capture', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    for (const uci of ['e1g1', 'e1h1']) {
      const r = lineMaterial(fen, [uci, 'e8c8'], { horizonPlies: 1 });
      expect(r.moves[0]!.captured).toBeUndefined();
      expect(r.plies).toBe(1);
      expect(r.balance).toBe(0);
    }
  });

  it('detects a mate delivered by the mover', () => {
    const r = lineMaterial('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', ['a1a8', 'g8h8'], { horizonPlies: 12 });
    expect(r.mate).toBe('mover');
    expect(r.plies).toBe(1);
    expect(r.quiet).toBe(true);
  });

  it('detects the mover getting mated', () => {
    const r = lineMaterial('1r4k1/5ppp/8/8/8/8/P4PPP/6K1 w - - 0 1', ['a2a3', 'b8b1'], { horizonPlies: 12 });
    expect(r.mate).toBe('opponent');
    expect(r.plies).toBe(2);
  });

  it('detects stalemate', () => {
    const r = lineMaterial('7k/8/6Q1/8/8/8/8/6K1 w - - 0 1', ['g6f7'], { horizonPlies: 12 });
    expect(r.stalemate).toBe(true);
    expect(r.mate).toBeNull();
  });

  it('cuts the line at an illegal or garbage move', () => {
    const r = lineMaterial(EXCH, ['e4d5', 'd8d1', 'zz'], { horizonPlies: 12 });
    expect(r.illegalAt).toBe(1);
    expect(r.plies).toBe(1);
    expect(r.balance).toBe(1);
    const g = lineMaterial(EXCH, ['xx'], { horizonPlies: 12 });
    expect(g.illegalAt).toBe(0);
    expect(g.plies).toBe(0);
  });

  it('handles an empty PV and returns the final FEN', () => {
    const r = lineMaterial(EXCH, [], { horizonPlies: 12 });
    expect(r.plies).toBe(0);
    expect(r.finalFen).toBe(EXCH);
    const r2 = lineMaterial(EXCH, ['e4d5'], { horizonPlies: 1 });
    expect(r2.finalFen).toBe('3qk3/8/8/3P4/8/8/8/3QK3 b - - 0 1');
  });

  it('throws only for an invalid start FEN', () => {
    expect(() => lineMaterial('bad', [], { horizonPlies: 1 })).toThrow();
  });
});
