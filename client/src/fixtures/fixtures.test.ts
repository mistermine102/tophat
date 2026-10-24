import type { Fact, Label, MoveAnalysis } from '@chess-coach/shared';
import { describe, expect, it } from 'vitest';
import { playUci, uciLineToSan } from '../lib/chess';
import { LABEL_ORDER } from '../lib/labels';
import { winChanceLabel } from './assemble';
import { fixtureGame, FIXTURE_PGN, FIXTURE_USERNAME } from './game';
import { genericAnalysis } from './generic';
import { pgnToGame } from './pgnGame';

const { game, analyses } = fixtureGame();
const all = game.moves.map((m) => analyses[m.ply]!);

function collectFacts(a: MoveAnalysis): Fact[] {
  const out: Fact[] = [];
  const visit = (f: Fact) => {
    out.push(f);
    if (f.type === 'threat') f.facts.forEach(visit);
    if (f.type === 'line') f.steps.forEach((s) => s.facts.forEach(visit));
  };
  for (const c of [a.played, a.best, a.pick, ...a.candidates]) {
    const e = c?.explanation;
    if (!e) continue;
    for (const lvl of [e.immediate, e.short, e.long]) lvl.facts.forEach(visit);
  }
  return out;
}

describe('fixture game', () => {
  it('parses the PGN (with clock comments) into 72 plies ending in mate', () => {
    expect(game.moves).toHaveLength(72);
    expect(game.moves[71]!.san).toBe('Rd3#');
    expect(game.headers.Black).toBe(FIXTURE_USERNAME);
    expect(game.you).toBe('black');
    expect(game.orientation).toBe('black');
    expect(FIXTURE_PGN).toContain('[%clk');
  });

  it('has a consistent, legal analysis for every ply', () => {
    for (const m of game.moves) {
      const a = analyses[m.ply]!;
      expect(a, `ply ${m.ply}`).toBeDefined();
      expect(a.fenBefore).toBe(m.fenBefore);
      expect(a.fenAfter).toBe(m.fenAfter);
      expect(a.uci).toBe(m.uci);
      expect(a.san).toBe(m.san);
      expect(a.color).toBe(m.color);
      expect(a.played.uci).toBe(m.uci);
      for (const c of a.candidates) {
        expect(uciLineToSan(a.fenBefore, c.pvUci)).toEqual(c.pv);
        expect(playUci(a.fenBefore, c.uci)?.san).toBe(c.san);
      }
      for (const e of [a.played.explanation!, a.best.explanation!]) {
        for (const lvl of [e.immediate, e.short, e.long]) expect(lvl.text.length).toBe(lvl.facts.length);
      }
    }
  });

  it('labels follow the win-chance thresholds unless a rule overrides them', () => {
    for (const a of all) {
      expect(a.labelReason.winChance).toBe(winChanceLabel(a.played.rank, a.winLoss));
      const overridden = ['book', 'forced', 'great', 'miss'].includes(a.label) || a.labelReason.material?.label;
      if (!overridden) expect(a.label, `${a.san}`).toBe(a.labelReason.winChance);
    }
  });

  it('covers every label, material-rule blunders (one still winning), pick≠best and deepOnly', () => {
    const labels = new Set<Label>(all.map((a) => a.label));
    for (const l of LABEL_ORDER) expect(labels.has(l), l).toBe(true);
    const materialBlunders = all.filter((a) => a.label === 'blunder' && a.labelReason.material?.label === 'blunder');
    expect(materialBlunders.length).toBeGreaterThanOrEqual(2);
    const stillWinning = materialBlunders.find((a) => a.winAfter > 80);
    expect(stillWinning?.san).toBe('Re1');
    expect(all.some((a) => a.pick && !a.pickIsBest)).toBe(true);
    expect(all.some((a) => a.deepOnly && a.pick === null)).toBe(true);
    expect(all.find((a) => a.label === 'great')?.labelReason.great?.secondBestLoss).toBeGreaterThan(10);
    expect(all.find((a) => a.label === 'book')?.labelReason.book?.name).toBeTruthy();
    const kinds = new Set(all.flatMap((a) => a.arrows.map((x) => x.kind)));
    expect([...kinds].sort()).toEqual(['best', 'pick', 'played', 'threat']);
  });

  it('covers every Fact type (fixture + generic side-line analyses)', () => {
    const types = new Set(all.flatMap(collectFacts).map((f) => f.type));
    // Promotion and skewer don't occur in the game; the generic side-line generator detects promotions.
    const promo = genericAnalysis({ fenBefore: '8/4P3/8/8/8/k7/8/K7 w - - 0 1', uci: 'e7e8q' });
    collectFacts(promo).forEach((f) => types.add(f.type));
    const expected: Fact['type'][] = [
      'check', 'checkmate', 'capture', 'promotion', 'castle', 'develop', 'attack', 'fork', 'pin',
      'discovered-attack', 'escape', 'defend', 'block-check', 'escape-check', 'hangs', 'allows-mate', 'threat', 'line',
      'forced-reply', 'positional', 'positional-gain', 'deep-payoff', 'necessary', 'nothing-notable',
    ];
    for (const t of expected) expect(types.has(t), t).toBe(true);
  });

  it('pgnToGame orients to the user and rejects bad PGNs', () => {
    expect(pgnToGame(FIXTURE_PGN, null).orientation).toBe('white');
    expect(() => pgnToGame('', null)).toThrow(/empty/);
    expect(() => pgnToGame('1. e4 e5 2. Ke3 Ke6', null)).toThrow(/Illegal/);
  });
});
