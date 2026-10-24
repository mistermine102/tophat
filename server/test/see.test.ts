import { describe, expect, it } from 'vitest';
import { parseSquare } from 'chessops';
import { positionFromFen } from '../src/chess/material';
import { hangingLoss, isHanging, see, seeCaptureWith, seeMove } from '../src/chess/see';

const sq = (s: string) => parseSquare(s)!;
const P = positionFromFen;

describe('see', () => {
  it('wins an undefended piece', () => {
    expect(see(P('4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1'), sq('d5'))).toBe(3);
  });

  it('returns 0 when every capture loses (rook takes pawn-defended knight)', () => {
    const pos = P('4k3/8/4p3/3n4/8/8/8/3RK3 w - - 0 1');
    expect(see(pos, sq('d5'))).toBe(0);
    expect(seeMove(pos, 'd1d5')).toBe(-2);
  });

  it('chooses the cheapest attacker first', () => {
    // pawn attacks a pawn-defended knight: exd5 exd5 = +2
    const pos = P('4k3/8/4p3/3n4/4P3/8/8/4K3 w - - 0 1');
    expect(see(pos, sq('d5'))).toBe(2);
    expect(seeMove(pos, 'e4d5')).toBe(2);
    // with the rook as well: exd5 exd5 Rxd5 = +3; starting with the rook loses
    const withRook = P('4k3/8/4p3/3n4/4P3/8/8/3RK3 w - - 0 1');
    expect(see(withRook, sq('d5'))).toBe(3);
    expect(seeCaptureWith(withRook, sq('d1'), sq('d5'))).toBe(-1); // Rxd5 exd5 exd5
  });

  it('counts x-ray batteries', () => {
    const pos = P('3rk3/8/8/3n4/8/8/3R4/3RK3 w - - 0 1');
    expect(see(pos, sq('d5'))).toBe(3);
    // without the second rook the knight is safe
    expect(see(P('3rk3/8/8/3n4/8/8/3R4/4K3 w - - 0 1'), sq('d5'))).toBe(0);
  });

  it('respects absolute pins of recapturers', () => {
    // the e6 bishop defends d5 but is pinned to its king by the e1 rook
    expect(see(P('4k3/8/4b3/3n4/8/8/8/3RR1K1 w - - 0 1'), sq('d5'))).toBe(3);
    // unpinned: Rxd5 Bxd5 loses the exchange
    expect(see(P('6k1/8/4b3/3n4/8/8/8/3R2K1 w - - 0 1'), sq('d5'))).toBe(0);
  });

  it('respects absolute pins of the first capturer', () => {
    // the d4 knight is pinned by the a7 bishop (a7-g1); it may not take e6
    const pos = P('4k3/b7/4p3/8/3N4/8/8/6K1 w - - 0 1');
    expect(seeCaptureWith(pos, sq('d4'), sq('e6'))).toBeUndefined();
    expect(see(pos, sq('e6'))).toBe(0);
  });

  it('the king only captures undefended pieces', () => {
    expect(see(P('4k3/8/8/8/8/8/3n4/4K3 w - - 0 1'), sq('d2'))).toBe(3);
    expect(see(P('4k3/8/8/8/8/2b5/3n4/4K3 w - - 0 1'), sq('d2'))).toBe(0);
  });

  it('handles promotion with capture', () => {
    expect(seeMove(P('1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1'), 'a7b8q')).toBe(13);
    // recaptured by the king: rook (5) + promotion (8) - queen (9)
    expect(seeMove(P('1rk5/P7/8/8/8/8/8/4K3 w - - 0 1'), 'a7b8q')).toBe(4);
    // a pawn capturing onto the last rank inside an exchange promotes
    expect(see(P('1r2k3/P7/8/8/8/8/8/1R2K3 w - - 0 1'), sq('b8'))).toBe(13);
  });

  it('handles en passant', () => {
    const pos = P('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    expect(seeMove(pos, 'e5d6')).toBe(1);
    expect(see(pos, sq('d5'))).toBe(1);
    const defended = P('4k3/2p5/8/3pP3/8/8/8/4K3 w - d6 0 1');
    expect(seeMove(defended, 'e5d6')).toBe(0);
  });

  it('quiet moves to attacked squares lose the piece', () => {
    expect(seeMove(P('4k3/8/8/3p4/8/8/8/4KQ2 w - - 0 1'), 'f1c4')).toBe(-9);
    expect(seeMove(P('4k3/8/8/3p4/8/8/8/4KQ2 w - - 0 1'), 'f1f3')).toBe(0);
    expect(seeMove(P('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), 'e1g1')).toBe(0);
  });

  it('a capture that does not resolve check is illegal inside the exchange', () => {
    // white is in check from the a5 bishop: the rook may not take d5 (it doesn't block or capture the checker)
    const pos = P('4k3/8/8/b2n4/8/8/8/3RK3 w - - 0 1');
    expect(see(pos, sq('d5'))).toBe(0);
  });

  it('throws on illegal moves', () => {
    expect(() => seeMove(P('4k3/8/8/8/8/8/8/4K3 w - - 0 1'), 'e1e3')).toThrow();
  });
});

describe('isHanging', () => {
  it('a queen attacked by a pawn hangs even if defended, whoever is to move', () => {
    const w = P('4k3/8/4q3/3P4/8/8/8/K7 w - - 0 1');
    expect(isHanging(w, sq('e6'))).toBe(true);
    expect(hangingLoss(w, sq('e6'))).toBe(9);
    const b = P('4k3/8/4q3/3P4/8/8/8/K7 b - - 0 1');
    expect(isHanging(b, sq('e6'))).toBe(true);
  });

  it('defended pieces attacked by equal or higher value do not hang', () => {
    expect(isHanging(P('4k3/8/4p3/3n4/8/8/8/3RK3 w - - 0 1'), sq('d5'))).toBe(false);
    expect(isHanging(P('4k3/8/8/3n4/8/8/8/4K3 w - - 0 1'), sq('d5'))).toBe(false); // not attacked
    expect(isHanging(P('4k3/8/8/8/8/8/8/4K3 w - - 0 1'), sq('d5'))).toBe(false); // empty
  });
});
