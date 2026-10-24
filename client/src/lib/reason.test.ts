import { describe, expect, it } from 'vitest';
import { fixtureGame } from '../fixtures/game';
import { isMaterialLabel, labelReasonText } from './reason';

const { analyses } = fixtureGame();

describe('label reasons', () => {
  it('material-rule blunder while still winning', () => {
    const a = analyses[52]!; // 26... Re1??
    expect(isMaterialLabel(a)).toBe(true);
    expect(labelReasonText(a, { moverIsYou: true })).toBe(
      'You left the rook on e1 hanging (−5). You’re still winning (eval for Black: M9 → +6.7), but this is the habit to fix.'.replace('’', "'"),
    );
    expect(labelReasonText(a, { moverIsYou: false })).toMatch(/^Black left the rook on e1 hanging \(−5\)\. Black is still winning/);
  });

  it('material-rule escalation when not winning', () => {
    const a = analyses[33]!; // 17. Nxe5
    expect(a.labelReason.winChance).toBe('mistake');
    expect(a.label).toBe('blunder');
    expect(labelReasonText(a, { moverIsYou: false })).toBe('White left the knight on e5 hanging (−3).');
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
});
