import { describe, expect, it } from 'vitest';
import { fixtureGame } from '../fixtures/game';
import type { MoveAnalysis } from '@chess-coach/shared';
import { isMateLabel, isMaterialLabel, labelReasonText } from './reason';

const { analyses } = fixtureGame();

describe('label reasons', () => {
  it('material-rule blunder while still winning', () => {
    const a = analyses[52]!; // 26... Re1??
    expect(isMaterialLabel(a)).toBe(true);
    expect(labelReasonText(a, { moverIsYou: true })).toBe(
      'You left the rook on e1 hanging (−5 points). You’re still winning (eval for Black: M9 → +6.7), but this is the habit to fix.'.replace('’', "'"),
    );
    expect(labelReasonText(a, { moverIsYou: false })).toMatch(/^Black left the rook on e1 hanging \(−5 points\)\. Black is still winning/);
  });

  it('material-rule escalation when not winning', () => {
    const a = analyses[33]!; // 17. Nxe5
    expect(a.labelReason.winChance).toBe('mistake');
    expect(a.label).toBe('blunder');
    expect(labelReasonText(a, { moverIsYou: false })).toBe('White took a pawn with the knight, but the knight can be taken back (−3 points).');
  });

  it('material rule: a hanging piece is named only when it is the whole loss; captures say what was taken', () => {
    const a = analyses[52]!; // 26... Re1??
    const m = a.labelReason.material!;
    // the line loses more than the hung piece (e.g. a pawn left hanging, then a promotion): told as the line comparison
    const bigger: MoveAnalysis = { ...a, labelReason: { ...a.labelReason, material: { ...m, loss: 8, hung: { ...m.hung!, role: 'pawn' }, hungLoss: 1 } } };
    expect(labelReasonText(bigger, { moverIsYou: false })).toMatch(/^Black lost material: with best play it ends 8 points worse than after Rxf2. Black is still winning/);
    // a capture whose capturing piece is lost: "took a pawn with the queen, but the queen can be taken back"
    const capture: MoveAnalysis = {
      ...a,
      fenBefore: '4k3/3p4/8/1Q2K3/8/8/8/8 w - - 0 1',
      uci: 'b5d7',
      san: 'Qxd7+',
      color: 'white',
      winAfter: 50,
      labelReason: { ...a.labelReason, material: { ...m, loss: 8, hung: { role: 'queen', square: 'd7', color: 'white' }, hungLoss: 8 } },
    };
    expect(labelReasonText(capture, { moverIsYou: true })).toBe('You took a pawn with the queen, but the queen can be taken back (−8 points).');
  });

  it('great, miss, book, forced and win-chance labels', () => {
    expect(labelReasonText(analyses[23]!, { moverIsYou: false })).toMatch(/only good move — the next best, Nxf3, would have thrown away 31% win chance/);
    expect(labelReasonText(analyses[32]!, { moverIsYou: true, prevMove: '16. e5' })).toMatch(
      /^Missed the chance to punish 16\. e5: Nxe5 would have kept the advantage/,
    );
    expect(labelReasonText(analyses[5]!, { moverIsYou: false })).toBe('Opening theory: Italian Game (C50).');
    expect(labelReasonText(analyses[57]!, { moverIsYou: false })).toBe('The only legal move.');
    expect(labelReasonText(analyses[29]!, { moverIsYou: false })).toBe('White gave away 13% win chance — b4 was much better.');
    expect(labelReasonText(analyses[21]!, { moverIsYou: false })).toBe('White lost 5.6% win chance — Kh1 was better.');
  });

  it('mate rules (M3): allowed mate in a lost position, missed mate', () => {
    const base = analyses[29]!;
    // Opera game 15...Nxd7??: Black was already lost (win chance ~0 either way), but Qxd7 avoided mate in 2
    const allowed: MoveAnalysis = {
      ...base,
      color: 'black',
      label: 'blunder',
      winLoss: 0.1,
      labelReason: { winChance: 'best', allowedMate: { matedIn: 2 } },
      best: { ...base.best, san: 'Qxd7', uci: 'e7d7' },
    };
    expect(isMateLabel(allowed)).toBe(true);
    expect(labelReasonText(allowed, { moverIsYou: false })).toBe('Black allowed a forced mate in 2. Black was already losing, but Qxd7 would have avoided it — watch for mating threats.');
    expect(labelReasonText(allowed, { moverIsYou: true })).toBe('You allowed a forced mate in 2. You were already losing, but Qxd7 would have avoided it — watch for mating threats.');
    const longer = { ...allowed, labelReason: { winChance: 'blunder' as const, allowedMate: { matedIn: 1, bestMatedIn: 6 } } };
    expect(isMateLabel(longer)).toBe(false); // win chance alone already says Blunder
    expect(labelReasonText(longer, { moverIsYou: false })).toBe('Black allowed mate in one. Qxd7 would have lasted 6 moves.');
    const missed: MoveAnalysis = { ...base, label: 'miss', winLoss: 1.2, labelReason: { winChance: 'excellent', missedMate: { mateIn: 2 } }, best: { ...base.best, san: 'Qh5' } };
    expect(isMateLabel(missed)).toBe(true);
    expect(labelReasonText(missed, { moverIsYou: true })).toBe("Missed a forced mate in 2: Qh5 forces mate, this move doesn't (1.2% win chance given back).");
  });
});
