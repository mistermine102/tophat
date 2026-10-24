import { describe, expect, it } from 'vitest';
import { squareSegments } from './squares';

const squares = (t: string) => squareSegments(t).filter((s) => s.square).map((s) => s.square);

describe('squareSegments', () => {
  it('finds plain squares and SAN destinations', () => {
    expect(squares('Leaves the knight on f6 hanging (−2).')).toEqual(['f6']);
    expect(squares('Nxd7 takes back → Qb8+ → Nxb8 wins the queen → Rd8# is checkmate.')).toEqual(['d7', 'b8', 'b8', 'd8']);
    expect(squares('exd5, Nbd7, Rae1 and e8=Q')).toEqual(['d5', 'd7', 'e1', 'e8']);
  });

  it('ignores digits and ordinary words', () => {
    expect(squares('(+12.0 → +3.1), 25% → 26%, M9, 1-0, a10')).toEqual([]);
    expect(squares('Black is still winning, but this is the habit to fix.')).toEqual([]);
  });

  it('keeps the text intact', () => {
    const t = 'Bg5 pins the knight on f6 to the queen on d8.';
    expect(squareSegments(t).map((s) => s.text).join('')).toBe(t);
  });
});
