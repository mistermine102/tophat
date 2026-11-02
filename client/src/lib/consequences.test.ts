import type { Fact, MoveAnalysis, PieceRef } from '@chess-coach/shared';
import { describe, expect, it } from 'vitest';
import { attackersOf, moveConsequences } from './consequences';

const P = (role: PieceRef['role'], square: string, color: PieceRef['color']): PieceRef => ({ role, square, color });
const level = (facts: Fact[]) => ({ facts, text: [] });

function analysis(color: 'white' | 'black', fenAfter: string, facts: Fact[], extra: Partial<MoveAnalysis> = {}): MoveAnalysis {
  return {
    color,
    fenAfter,
    labelReason: { winChance: 'good' },
    played: { explanation: { immediate: level(facts), short: level([]), long: level([]) } },
    ...extra,
  } as unknown as MoveAnalysis;
}

describe('move consequences on the board', () => {
  it('finds the attackers of a square', () => {
    expect(attackersOf('4k3/8/3n4/8/2B5/8/8/4K3 b - - 0 1', 'c4', 'black')).toEqual(['d6']);
    expect(attackersOf('4k3/8/3n4/8/2B5/8/8/4K3 b - - 0 1', 'c4', 'white')).toEqual([]);
  });

  it('a hanging piece: red square tagged "hanging" and a red arrow from the piece that can take it', () => {
    const c = moveConsequences(analysis('white', '4k3/8/3n4/8/2B5/8/8/4K3 b - - 0 1', [{ type: 'hangs', piece: P('bishop', 'c4', 'white'), loss: 3 }]));
    expect(c.marks).toEqual([{ square: 'c4', tone: 'bad', tag: 'hanging' }]);
    expect(c.arrows).toEqual([{ from: 'd6', to: 'c4', tone: 'bad' }]);
  });

  it("the material rule's hung piece is marked even without a 'hangs' fact (once)", () => {
    const fen = '4k3/8/3n4/8/2B5/8/8/4K3 b - - 0 1';
    const hung = P('bishop', 'c4', 'white');
    const c = moveConsequences(
      analysis('white', fen, [{ type: 'hangs', piece: hung, loss: 3 }], {
        labelReason: { winChance: 'blunder', material: { playedLine: -3, bestLine: 0, loss: 3, evalDropCp: 300, hung } },
      }),
    );
    expect(c.marks).toHaveLength(1);
    expect(moveConsequences(analysis('white', fen, [], { labelReason: { winChance: 'blunder', material: { playedLine: -3, bestLine: 0, loss: 3, evalDropCp: 300, hung } } })).marks).toEqual([
      { square: 'c4', tone: 'bad', tag: 'hanging' },
    ]);
  });

  it("the mover's fork is green: arrows to every target, tags on the pieces (not the king)", () => {
    const c = moveConsequences(
      analysis('black', '4k3/8/8/8/8/8/2n5/R3K3 w - - 0 1', [{ type: 'fork', attacker: P('knight', 'c2', 'black'), targets: [P('king', 'e1', 'white'), P('rook', 'a1', 'white')] }]),
    );
    expect(c.arrows).toEqual([
      { from: 'c2', to: 'e1', tone: 'good' },
      { from: 'c2', to: 'a1', tone: 'good' },
    ]);
    expect(c.marks).toEqual([{ square: 'a1', tone: 'good', tag: 'forked' }]);
  });

  it("an allowed reply is a red arrow and the pieces it hits are 'in danger'", () => {
    const c = moveConsequences(
      analysis('white', '4k3/8/3n4/8/2B5/8/8/4K3 b - - 0 1', [
        { type: 'allows', reply: { san: 'Nxc4', uci: 'd6c4' }, facts: [], targets: [P('bishop', 'c4', 'white')], gain: 3 },
      ]),
    );
    expect(c.arrows).toEqual([{ from: 'd6', to: 'c4', tone: 'bad' }]);
    expect(c.marks).toEqual([{ square: 'c4', tone: 'bad', tag: 'in danger' }]);
  });

  it('a forced mate in the engine score tags the king that gets mated, on every move of the line', () => {
    const fen = '6k1/5ppp/8/8/8/8/8/R5K1 b - - 0 1';
    // White (the mover) keeps a mate in 2: green on the black king
    expect(moveConsequences(analysis('white', fen, [], { evalBefore: { mate: 3 }, evalAfter: { mate: 2 } })).marks).toEqual([
      { square: 'g8', tone: 'good', tag: 'mate in 2' },
    ]);
    // Black is being mated: red on its own king even when nothing new was allowed
    const black = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
    expect(moveConsequences(analysis('black', black, [], { evalBefore: { mate: 3 }, evalAfter: { mate: 2 } })).marks).toEqual([
      { square: 'g8', tone: 'bad', tag: 'mate in 2' },
    ]);
  });

  it('a mate the mover had and let go: "missed mate in N" on the enemy king', () => {
    const fen = '6k1/5ppp/8/8/8/8/8/R5K1 b - - 0 1';
    expect(moveConsequences(analysis('white', fen, [], { evalBefore: { mate: 1 }, evalAfter: { cp: 500 } })).marks).toEqual([
      { square: 'g8', tone: 'bad', tag: 'missed mate in 1' },
    ]);
    // delivering the mate is not "missed"
    const mated = 'R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1';
    const c = moveConsequences(analysis('white', mated, [{ type: 'checkmate' } as Fact], { evalBefore: { mate: 1 }, evalAfter: { cp: 1000 } }));
    expect(c.marks).toEqual([{ square: 'g8', tone: 'good', tag: 'checkmate' }]);
  });

  it('a check is left to the board (no tag on the king)', () => {
    const c = moveConsequences(
      analysis('white', '4k3/8/8/8/8/8/8/4RK2 b - - 0 1', [{ type: 'attack', attacker: P('rook', 'e1', 'white'), target: P('king', 'e8', 'black'), reason: 'king' }]),
    );
    expect(c).toEqual({ marks: [], arrows: [] });
  });
});
