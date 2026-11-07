// (Why round) facts/cause.ts — causes read from the played move's own engine line — and their wording.
import { DEFAULT_SETTINGS } from '@chess-coach/shared';
import { describe, expect, it } from 'vitest';
import { labelText, loosensPhrase, renderExplanation, tradesDownPhrase } from '../src/analysis/explain';
import { fineAlternatives, loosensFact, tradesDownFact } from '../src/facts/cause';

// shiniimini–mistermine102: 6.f3? leaves g3 without the f2 pawn; Black's knight comes to f5, White's king to f2
const F3_FEN = 'r1bqkbnr/ppp3pp/2n2p2/4p3/3p3P/1P4P1/PBPPPPB1/RN1QK1NR w KQkq - 0 6';
const F3_PV = ['f2f3', 'g8h6', 'g2h3', 'h6f5', 'e1f2', 'c8e6', 'h3f5', 'e6f5'];
// 41.Qe3+? Qxe3+ Kxe3: a lost pawn ending (Qe7+ keeps the queens and a draw)
const QE3_FEN = '8/8/8/p1Q2pk1/PpP5/1q6/5KP1/8 w - - 0 41';
// 42.Rxd4? Rxd4 cxd4+ Kxd4: a won rook ending becomes a drawn pawn ending
const RXD4_FEN = '3r4/8/8/p1k4p/3pP3/1PPR2P1/1PK5/8 w - - 0 42';

describe('loosensFact', () => {
  it('6.f3: g3 loses its only defender, the knight goes after it, the king has to defend it', () => {
    const f = loosensFact(F3_FEN, F3_PV)!;
    expect(f).toMatchObject({
      type: 'loosens',
      moved: { role: 'pawn', square: 'f2', color: 'white' },
      target: { role: 'pawn', square: 'g3', color: 'white' },
      undefended: true,
      attacker: { role: 'knight', square: 'f5', color: 'black' },
      route: ['Nh6', 'Nf5'],
      answer: { san: 'Kf2', how: 'king' },
      castlingLost: true,
    });
    expect(f.won).toBeUndefined();
  });

  it('nothing when the line never goes after the loosened piece', () => {
    expect(loosensFact(F3_FEN, ['f2f3', 'a7a6', 'a2a3', 'a6a5'])).toBeNull();
    // a move that defended nothing loosens nothing
    expect(loosensFact(F3_FEN, ['a2a3', 'g8h6', 'g2h3', 'h6f5'])).toBeNull();
  });

  it('words it with the route, the king walk and castling', () => {
    const f = loosensFact(F3_FEN, F3_PV)!;
    expect(loosensPhrase(f, 'white')).toBe("leaves the pawn on g3 undefended: Black's knight heads for f5 to attack it (…Nh6, …Nf5), and White's king has to defend it from f2, giving up castling");
    expect(loosensPhrase(f, 'white', { short: true })).toBe("leaves the pawn on g3 undefended, and Black's knight heads for f5 to attack it");
  });
});

describe('tradesDownFact', () => {
  it('41.Qe3+: the queens come off into a lost pawn ending', () => {
    const f = tradesDownFact({ fenBefore: QE3_FEN, pv: ['c5e3', 'b3e3', 'f2e3', 'g5f6', 'g2g3', 'f6e6'], bestPv: ['c5e7', 'g5f4', 'e7d6', 'f4g5'], winBest: 50, winPlayed: 12 })!;
    expect(f).toEqual({ type: 'trades-down', trade: 'pieces', ending: 'pawn', verdict: 'lost', line: ['Qe3+', 'Qxe3+', 'Kxe3'] });
    expect(tradesDownPhrase(f, 'white')).toBe('leads to a lost pawn ending for White: after …Qxe3+ Kxe3 only the kings and pawns are left');
  });

  it('42.Rxd4: a won position slips into a drawn pawn ending', () => {
    const f = tradesDownFact({ fenBefore: RXD4_FEN, pv: ['d3d4', 'd8d4', 'c3d4', 'c5d4', 'e4e5', 'd4e5'], bestPv: ['d3d1', 'd8d7', 'd1d2', 'd7d6', 'd2h2', 'c5b6'], winBest: 87, winPlayed: 50 })!;
    expect(f).toMatchObject({ trade: 'pieces', ending: 'pawn', verdict: 'draw', line: ['Rxd4', 'Rxd4', 'cxd4+', 'Kxd4'] });
  });

  it('nothing when the best line trades too, or when the eval hardly changes', () => {
    const pv = ['c5e3', 'b3e3', 'f2e3', 'g5f6'];
    expect(tradesDownFact({ fenBefore: QE3_FEN, pv, bestPv: pv, winBest: 50, winPlayed: 12 })).toBeNull();
    expect(tradesDownFact({ fenBefore: QE3_FEN, pv, bestPv: ['c5e7', 'g5f4'], winBest: 50, winPlayed: 45 })).toBeNull();
  });
});

describe('fineAlternatives', () => {
  const cands = [
    { san: 'c3', uci: 'c2c3', winLoss: 0 },
    { san: 'd3', uci: 'd2d3', winLoss: 0.1 },
    { san: 'a3', uci: 'a2a3', winLoss: 1.3 },
    { san: 'Nf3', uci: 'g1f3', winLoss: 2.8 },
  ];
  it('several moves about as good as the best one, the played move left out', () => {
    expect(fineAlternatives(cands, 'f2f3', 23.8)).toEqual(['c3', 'd3', 'a3']);
    expect(fineAlternatives(cands, 'd2d3', 6)).toEqual(['c3', 'a3']);
  });
  it('none when the best move stands alone', () => {
    expect(fineAlternatives([{ san: 'Bxe5', uci: 'b2e5', winLoss: 0 }, { san: 'e3', uci: 'e2e3', winLoss: 12 }], 'g2g3', 14)).toEqual([]);
  });
});

describe('wording', () => {
  const base = { color: 'white' as const, evalBefore: { cp: -5 }, evalAfter: { cp: -270 }, winBefore: 50, winAfter: 27, uci: 'f2f3', bestSan: 'c3', bestUci: 'c2c3', san: 'f3' };
  it('the cause leads the label text, with the moves that kept the chances', () => {
    const cause = loosensFact(F3_FEN, F3_PV)!;
    const t = labelText({ ...base, label: 'blunder', labelReason: { winChance: 'blunder' }, winLoss: 24, cause, fine: ['c3', 'd3', 'a3'] }, DEFAULT_SETTINGS);
    expect(t).toBe("Blunder ?? — f3 leaves the pawn on g3 undefended, and Black's knight heads for f5 to attack it. White's winning chances go from 50% to 26%; c3, d3 or a3 would have kept them.");
  });
  it('an Inaccuracy without a reason names the moves that were a bit better', () => {
    const t = labelText({ ...base, label: 'inaccuracy', labelReason: { winChance: 'inaccuracy' }, winLoss: 7, fine: ['e3', 'c4', 'Nf3'] }, DEFAULT_SETTINGS);
    expect(t).toBe('Inaccuracy ?! — e3, c4 or Nf3 were a bit better (−7% winning chances).');
  });
  it('the Immediate level leads with the cause and adds no "X was much better"', () => {
    const cause = loosensFact(F3_FEN, F3_PV)!;
    const e = renderExplanation({ immediate: [cause, { type: 'misses', san: 'c3', uci: 'c2c3', facts: [], fine: ['c3', 'd3', 'a3'] }], short: [], long: [] }, { mover: 'white', label: 'blunder', uci: 'f2f3', hedge: { dropPawns: 2.8, bestSan: 'c3' } });
    expect(e.immediate.text).toEqual(["Leaves the pawn on g3 undefended: Black's knight heads for f5 to attack it (…Nh6, …Nf5), and White's king has to defend it from f2, giving up castling."]);
    expect(e.immediate.tones).toEqual(['bad']);
  });
  it('with no reason at all, the moves that were fine are named instead of one "X was much better"', () => {
    const e = renderExplanation({ immediate: [{ type: 'misses', san: 'c3', uci: 'c2c3', facts: [], fine: ['c3', 'd3'] }], short: [], long: [] }, { mover: 'white', label: 'mistake', uci: 'f2f3' });
    expect(e.immediate.text).toEqual(['c3 or d3 were both much better.']);
  });
});
