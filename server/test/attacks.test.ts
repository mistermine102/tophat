import { describe, expect, it } from 'vitest';
import { makeSquare, parseSquare, type SquareSet } from 'chessops';
import {
  absolutelyPinned,
  attackedPieces,
  attackersOf,
  defendersOf,
  legalMobility,
  legalMoveCount,
  lineBehind,
  pinsAgainst,
} from '../src/chess/attacks';
import { positionFromFen } from '../src/chess/material';

const sq = (s: string) => parseSquare(s)!;
const names = (set: SquareSet) => [...set].map(makeSquare).sort();

describe('attackersOf / defendersOf / attackedPieces', () => {
  const pos = positionFromFen('4k3/8/4p3/3p4/4P3/2N5/8/3RK3 w - - 0 1');

  it('finds pawn, knight and rook attackers', () => {
    expect(names(attackersOf(pos.board, sq('d5'), 'white'))).toEqual(['c3', 'd1', 'e4']);
    expect(names(attackersOf(pos.board, sq('d5'), 'black'))).toEqual(['e6']);
  });

  it('defenders are the own attackers of an occupied square', () => {
    expect(names(defendersOf(pos.board, sq('d5')))).toEqual(['e6']);
    expect(names(defendersOf(pos.board, sq('e4')))).toEqual(['c3']);
    expect(names(defendersOf(pos.board, sq('a5')))).toEqual([]); // empty square
  });

  it('lists enemy pieces attacked by a piece', () => {
    expect(names(attackedPieces(pos.board, sq('e4')))).toEqual(['d5']);
    expect(names(attackedPieces(pos.board, sq('d5')))).toEqual(['e4']);
  });

  it('x-ray option includes batteries behind direct attackers', () => {
    const p = positionFromFen('4k3/8/8/3p4/8/3R4/8/3QK3 w - - 0 1');
    expect(names(attackersOf(p.board, sq('d5'), 'white'))).toEqual(['d3']);
    expect(names(attackersOf(p.board, sq('d5'), 'white', { xray: true }))).toEqual(['d1', 'd3']);
  });

  it('respects a custom occupancy', () => {
    const p = positionFromFen('4k3/8/8/3p4/8/3R4/8/3QK3 w - - 0 1');
    const occ = p.board.occupied.without(sq('d3'));
    expect(names(attackersOf(p.board, sq('d5'), 'white', { occupied: occ }))).toEqual(['d1']);
  });
});

describe('pins', () => {
  it('detects an absolute pin (rook pins knight to king)', () => {
    const p = positionFromFen('4k3/4r3/8/8/8/8/4N3/4K3 w - - 0 1');
    const pins = pinsAgainst(p.board, 'white');
    expect(pins).toEqual([{ pinner: sq('e7'), pinned: sq('e2'), behind: sq('e1'), absolute: true }]);
    expect(names(absolutelyPinned(p.board, 'white'))).toEqual(['e2']);
    expect(pinsAgainst(p.board, 'black')).toEqual([]);
  });

  it('detects relative pins only when asked (bishop pins knight to queen)', () => {
    const p = positionFromFen('4k3/8/8/1b6/8/3N4/8/5Q1K w - - 0 1');
    expect(pinsAgainst(p.board, 'white')).toEqual([]);
    expect(pinsAgainst(p.board, 'white', { relative: true })).toEqual([
      { pinner: sq('b5'), pinned: sq('d3'), behind: sq('f1'), absolute: false },
    ]);
  });

  it('a less valuable piece behind is not a relative pin', () => {
    const p = positionFromFen('4k3/8/8/1b6/8/3Q4/8/5N1K w - - 0 1');
    expect(pinsAgainst(p.board, 'white', { relative: true })).toEqual([]);
  });

  it('lineBehind finds the next piece on the line', () => {
    const p = positionFromFen('4k3/8/8/1b6/8/3N4/8/5Q1K w - - 0 1');
    expect(lineBehind(p.board, sq('b5'), sq('d3'))).toBe(sq('f1'));
    expect(lineBehind(p.board, sq('d3'), sq('b5'))).toBeUndefined(); // knight is not a slider
  });
});

describe('mobility', () => {
  it('counts legal moves per piece', () => {
    const p = positionFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(legalMoveCount(p)).toBe(20);
    expect(legalMobility(p).get(sq('g1'))).toBe(2);
    expect(legalMoveCount(p, 'black')).toBe(20);
  });

  it('pinned pieces have no moves off the pin line', () => {
    const p = positionFromFen('4k3/4r3/8/8/8/8/4N3/4K3 w - - 0 1');
    expect(legalMobility(p).get(sq('e2'))).toBe(0);
  });
});
