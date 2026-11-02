import { describe, expect, it } from 'vitest';
import { capturedBy } from './chess';

describe('captured pieces', () => {
  it('nothing at the start', () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    expect(capturedBy(start, 'white')).toEqual([]);
    expect(capturedBy(start, 'black')).toEqual([]);
  });

  it("lists the opponent's missing pieces, cheapest first", () => {
    // Black is missing the queen and a pawn; White is missing a knight
    const fen = 'rnb1kbnr/ppp1pppp/8/8/8/8/PPPPPPPP/R1BQKBNR w KQkq - 0 1';
    expect(capturedBy(fen, 'white')).toEqual(['pawn', 'queen']);
    expect(capturedBy(fen, 'black')).toEqual(['knight']);
  });

  it('a promoted piece stands in for a pawn, not for nothing', () => {
    // White has two queens and seven pawns: no white piece was taken
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/1PPPPPPP/RNBQKBNQ w Qkq - 0 1';
    expect(capturedBy(fen, 'black')).toEqual(['rook']);
  });
});
