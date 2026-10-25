import { INITIAL_FEN } from 'chessops/fen';
import { describe, expect, it } from 'vitest';
import { INITIAL_KEY, bookInfo, bookLoadMs, buildBook, isBookMove, loadBook, lookupBook, positionKey } from '../src/analysis/book';
import { playUci } from './helpers/classifyHelpers';

const after = (moves: string) => playUci(INITIAL_FEN, moves.split(' ').filter(Boolean));

describe('opening book (Lichess chess-openings)', () => {
  it('loads once, fast', () => {
    const t0 = performance.now();
    const book = loadBook();
    const ms = performance.now() - t0;
    expect(book.size).toBeGreaterThan(3000);
    expect(bookLoadMs()).toBeLessThan(3000) // ~0.3 s normally; generous for a loaded CPU;
    expect(ms).toBeLessThan(3000);
    const t1 = performance.now();
    expect(loadBook()).toBe(book); // cached
    expect(performance.now() - t1).toBeLessThan(5);
  });

  it('finds the Ruy Lopez (C60) after 1.e4 e5 2.Nf3 Nc6 3.Bb5', () => {
    expect(lookupBook(after('e2e4 e7e5 g1f3 b8c6 f1b5'))).toMatchObject({ eco: 'C60', name: 'Ruy Lopez', ply: 5 });
  });

  it('names other well-known openings', () => {
    expect(lookupBook(after('e2e4 c7c5'))).toMatchObject({ eco: 'B20', name: 'Sicilian Defense' });
    expect(lookupBook(after('d2d4 d7d5 c2c4'))).toMatchObject({ eco: 'D06', name: "Queen's Gambit" });
    expect(lookupBook(after('e2e4 e7e6'))).toMatchObject({ eco: 'C00', name: 'French Defense' });
  });

  it('finds transpositions (keyed by position, not move order)', () => {
    const ruy = lookupBook(after('g1f3 b8c6 e2e4 e7e5 f1b5'));
    expect(ruy).toMatchObject({ eco: 'C60', name: 'Ruy Lopez' });
    // QGD reached via 1.c4 e6 2.Nc3 d5 3.d4
    const viaEnglish = lookupBook(after('c2c4 e7e6 b1c3 d7d5 d2d4'));
    const direct = lookupBook(after('d2d4 d7d5 c2c4 e7e6 b1c3'));
    expect(viaEnglish).not.toBeNull();
    expect(viaEnglish).toEqual(direct);
  });

  it('ignores move clocks and an en-passant square that cannot be used', () => {
    const withEp = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    const withoutEp = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 5 9';
    expect(positionKey(withEp)).toBe(positionKey(withoutEp));
    expect(lookupBook(withEp)).toMatchObject({ eco: 'B00', name: "King's Pawn Game" });
    expect(lookupBook(withoutEp)).toEqual(lookupBook(withEp));
  });

  it('every position along a book line is in the book', () => {
    const moves = 'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f6e4 d2d4 b7b5 a4b3 d7d5 d4e5 c8e6'.split(' ');
    for (let i = 1; i <= moves.length; i++) {
      expect(lookupBook(playUci(INITIAL_FEN, moves.slice(0, i))), `ply ${i}`).not.toBeNull();
    }
    expect(lookupBook(playUci(INITIAL_FEN, moves))!.name).toMatch(/^Ruy Lopez: Open/);
  });

  it('isBookMove: after in book and before is start or book', () => {
    expect(isBookMove(INITIAL_FEN, after('e2e4'))).toBe(true);
    expect(isBookMove(after('e2e4 e7e5 g1f3 b8c6'), after('e2e4 e7e5 g1f3 b8c6 f1b5'))).toBe(true);
    // 2.Ba6?? is not book
    expect(isBookMove(after('e2e4 e7e5'), after('e2e4 e7e5 f1a6'))).toBe(false);
    // a position outside the book that happens to lead back into it is still not a book move (before not in book)
    const outside = '4k3/8/8/8/8/8/8/4K2R w K - 0 1';
    expect(isBookMove(outside, after('e2e4'))).toBe(false);
    expect(bookInfo(INITIAL_FEN, after('e2e4'))).toEqual({ after: expect.objectContaining({ eco: 'B00' }), beforeIsStartOrBook: true });
  });

  it('initial position key, invalid FENs', () => {
    expect(INITIAL_KEY).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
    expect(positionKey('garbage')).toBeNull();
    expect(lookupBook('garbage')).toBeNull();
    expect(isBookMove('garbage', 'garbage')).toBe(false);
  });

  it('buildBook: shortest line names a position, intermediate positions inherit their opening', () => {
    const content = [
      'eco\tname\tpgn',
      'X01\tLong Way\t1. Nf3 Nc6 2. Ng1 Nb8 3. e4 e5 4. Nf3 Nc6',
      'X02\tShort\t1. e4 e5 2. Nf3 Nc6',
      'X04\tTie Later\t1. Nf3 Nc6 2. e4 e5',
      'X03\tKing Pawn\t1. e4',
    ].join('\n');
    const book = buildBook([{ file: 't.tsv', content }]);
    const key = (m: string) => positionKey(after(m))!;
    // reached by 8, 4 and 4 plies: the shortest wins, ties -> first in file order
    expect(book.get(key('e2e4 e7e5 g1f3 b8c6'))).toEqual({ eco: 'X02', name: 'Short', ply: 4 });
    expect(book.get(key('e2e4'))).toEqual({ eco: 'X03', name: 'King Pawn', ply: 1 });
    // 1.e4 e5 is unnamed: inherits its deepest named ancestor (1.e4) on the line reaching it soonest
    expect(book.get(key('e2e4 e7e5'))).toEqual({ eco: 'X03', name: 'King Pawn', ply: 2 });
    // 1.Nf3 has no named ancestor: named after its own line
    expect(book.get(key('g1f3'))).toEqual({ eco: 'X01', name: 'Long Way', ply: 1 });
  });

  it('buildBook rejects illegal SAN', () => {
    expect(() => buildBook([{ file: 'x.tsv', content: 'eco\tname\tpgn\nA00\tBad\t1. e5' }])).toThrow(/illegal SAN/);
  });
});
