import type { Fact, MoveAnalysis, PieceRef } from '@chess-coach/shared';
import { describe, expect, it } from 'vitest';
import { attackersOf, moveConsequences, toneFor } from './consequences';

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

/** Just square → tone, for the POV checks. */
const tones = (c: ReturnType<typeof moveConsequences>) => Object.fromEntries(c.marks.map((m) => [m.square, m.tone]));

describe('move consequences on the board', () => {
  it('finds the attackers of a square', () => {
    expect(attackersOf('4k3/8/3n4/8/2B5/8/8/4K3 b - - 0 1', 'c4', 'black')).toEqual(['d6']);
    expect(attackersOf('4k3/8/3n4/8/2B5/8/8/4K3 b - - 0 1', 'c4', 'white')).toEqual([]);
  });

  it('tones are for you: the side that is favoured, or neutral', () => {
    expect(toneFor('white', 'white')).toBe('good');
    expect(toneFor('black', 'white')).toBe('bad');
    expect(toneFor(null, 'black')).toBe('neutral');
  });

  it('your hanging piece: red square tagged "hanging" and a red arrow from the piece that can take it', () => {
    const c = moveConsequences(analysis('white', '4k3/8/3n4/8/2B5/8/8/4K3 b - - 0 1', [{ type: 'hangs', piece: P('bishop', 'c4', 'white'), loss: 3 }]), 'white');
    expect(c.marks).toEqual([{ square: 'c4', tone: 'bad', kind: 'hanging', tag: 'hanging' }]);
    expect(c.arrows).toEqual([{ from: 'd6', to: 'c4', tone: 'bad' }]);
  });

  it("the opponent's hanging piece is green for you", () => {
    const c = moveConsequences(analysis('white', '4k3/8/3n4/8/2B5/8/8/4K3 b - - 0 1', [{ type: 'hangs', piece: P('bishop', 'c4', 'white'), loss: 3 }]), 'black');
    expect(c.marks).toEqual([{ square: 'c4', tone: 'good', kind: 'hanging', tag: 'hanging' }]);
    expect(c.arrows).toEqual([{ from: 'd6', to: 'c4', tone: 'good' }]);
  });

  it("the material rule's hung piece is marked even without a 'hangs' fact (once)", () => {
    const fen = '4k3/8/3n4/8/2B5/8/8/4K3 b - - 0 1';
    const hung = P('bishop', 'c4', 'white');
    const material = { playedLine: -3, bestLine: 0, loss: 3, evalDropCp: 300, hung };
    const c = moveConsequences(analysis('white', fen, [{ type: 'hangs', piece: hung, loss: 3 }], { labelReason: { winChance: 'blunder', material } }), 'white');
    expect(c.marks).toHaveLength(1);
    expect(moveConsequences(analysis('white', fen, [], { labelReason: { winChance: 'blunder', material } }), 'white').marks).toEqual([
      { square: 'c4', tone: 'bad', kind: 'hanging', tag: 'hanging' },
    ]);
  });

  it('a fork: arrows to every target, tags on the pieces (not the king); green if it is yours, red if it is against you', () => {
    const a = analysis('black', '4k3/8/8/8/8/8/2n5/R3K3 w - - 0 1', [{ type: 'fork', attacker: P('knight', 'c2', 'black'), targets: [P('king', 'e1', 'white'), P('rook', 'a1', 'white')] }]);
    const mine = moveConsequences(a, 'black');
    expect(mine.arrows).toEqual([
      { from: 'c2', to: 'e1', tone: 'good' },
      { from: 'c2', to: 'a1', tone: 'good' },
    ]);
    expect(mine.marks).toEqual([{ square: 'a1', tone: 'good', kind: 'forked', tag: 'forked' }]);
    // the opponent forked your rook: red, not green
    const theirs = moveConsequences(a, 'white');
    expect(theirs.marks).toEqual([{ square: 'a1', tone: 'bad', kind: 'forked', tag: 'forked' }]);
    expect(theirs.arrows.map((x) => x.tone)).toEqual(['bad', 'bad']);
  });

  it('"defended" and "safe now" are neutral (blue) for either side', () => {
    const fen = '4k3/8/8/8/2B5/1P6/8/4K3 b - - 0 1';
    const facts: Fact[] = [
      { type: 'defend', defender: P('pawn', 'b3', 'white'), piece: P('bishop', 'c4', 'white') } as Fact,
      { type: 'escape', piece: P('king', 'e1', 'white') } as Fact,
    ];
    for (const you of ['white', 'black'] as const) {
      const c = moveConsequences(analysis('white', fen, facts), you);
      expect(c.marks).toEqual([
        { square: 'c4', tone: 'neutral', kind: 'defended', tag: 'defended' },
        { square: 'e1', tone: 'neutral', kind: 'safe', tag: 'safe now' },
      ]);
      expect(c.arrows).toEqual([{ from: 'b3', to: 'c4', tone: 'neutral' }]);
    }
  });

  it('an attack on an undefended piece is told apart from a plain attack', () => {
    const fen = '4k3/8/3n4/8/2B5/8/8/4K3 w - - 0 1';
    const c = moveConsequences(analysis('black', fen, [{ type: 'attack', attacker: P('knight', 'd6', 'black'), target: P('bishop', 'c4', 'white'), reason: 'undefended' }]), 'white');
    expect(c.marks).toEqual([{ square: 'c4', tone: 'bad', kind: 'undefended', tag: 'undefended' }]);
  });

  it("an allowed reply is an arrow against the mover and the pieces it hits are 'in danger'", () => {
    const a = analysis('white', '4k3/8/3n4/8/2B5/8/8/4K3 b - - 0 1', [
      { type: 'allows', reply: { san: 'Nxc4', uci: 'd6c4' }, facts: [], targets: [P('bishop', 'c4', 'white')], gain: 3 },
    ]);
    const c = moveConsequences(a, 'white');
    expect(c.arrows).toEqual([{ from: 'd6', to: 'c4', tone: 'bad' }]);
    expect(c.marks).toEqual([{ square: 'c4', tone: 'bad', kind: 'danger', tag: 'in danger' }]);
    // the opponent's mistake: good news for you
    expect(tones(moveConsequences(a, 'black'))).toEqual({ c4: 'good' });
  });

  it('a forced mate in the engine score tags the king that gets mated, on every move of the line', () => {
    const fen = '6k1/5ppp/8/8/8/8/8/R5K1 b - - 0 1';
    // White keeps a mate in 2: green on the black king when you are White, red when you are Black
    const a = analysis('white', fen, [], { evalBefore: { mate: 3 }, evalAfter: { mate: 2 } });
    expect(moveConsequences(a, 'white').marks).toEqual([{ square: 'g8', tone: 'good', kind: 'mate', tag: 'mate in 2' }]);
    expect(tones(moveConsequences(a, 'black'))).toEqual({ g8: 'bad' });
    // Black (you) is being mated: red on your king even on your own move, when nothing new was allowed
    const black = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
    expect(moveConsequences(analysis('black', black, [], { evalBefore: { mate: 3 }, evalAfter: { mate: 2 } }), 'black').marks).toEqual([
      { square: 'g8', tone: 'bad', kind: 'mate', tag: 'mate in 2' },
    ]);
  });

  it('a mate the mover had and let go: "missed mate in N" on the enemy king', () => {
    const fen = '6k1/5ppp/8/8/8/8/8/R5K1 b - - 0 1';
    const a = analysis('white', fen, [], { evalBefore: { mate: 1 }, evalAfter: { cp: 500 } });
    expect(moveConsequences(a, 'white').marks).toEqual([{ square: 'g8', tone: 'bad', kind: 'missed-mate', tag: 'missed mate in 1' }]);
    // the opponent missed a mate against you: a relief, green
    expect(tones(moveConsequences(a, 'black'))).toEqual({ g8: 'good' });
    // delivering the mate is not "missed"
    const mated = 'R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1';
    const c = moveConsequences(analysis('white', mated, [{ type: 'checkmate' } as Fact], { evalBefore: { mate: 1 }, evalAfter: { cp: 1000 } }), 'white');
    expect(c.marks).toEqual([{ square: 'g8', tone: 'good', kind: 'checkmate', tag: 'checkmate' }]);
  });

  it('a check is left to the board (no tag on the king)', () => {
    const c = moveConsequences(
      analysis('white', '4k3/8/8/8/8/8/8/4RK2 b - - 0 1', [{ type: 'attack', attacker: P('rook', 'e1', 'white'), target: P('king', 'e8', 'black'), reason: 'king' }]),
      'white',
    );
    expect(c).toEqual({ marks: [], arrows: [] });
  });
});
