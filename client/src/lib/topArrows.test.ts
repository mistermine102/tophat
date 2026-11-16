import { describe, expect, it } from 'vitest';
import { TOP_BRILLIANT, topArrowShapes, topBrushes, topStrength } from './topArrows';

describe('topArrowShapes', () => {
  it('as bright and thick as they are good: the best full, a close second nearly so, a worse one thin and faint', () => {
    const shapes = topArrowShapes([{ uci: 'e2e4', gap: 0 }, { uci: 'd2d4', gap: 0.3 }, { uci: 'g1f3', gap: 3 }, { uci: 'a2a3', gap: 20 }]);
    // drawn worst first, the best on top
    expect(shapes.map((s) => s.orig + (s.dest ?? ''))).toEqual(['a2a3', 'g1f3', 'd2d4', 'e2e4']);
    expect(shapes.map((s) => s.brush)).toEqual(['top0', 'top3', 'top8', 'top9']);
    expect(shapes.map((s) => s.modifiers!.lineWidth)).toEqual([2, 4, 6, 7]);
  });

  it('the gap (centipawn-aware) wins over the win-chance loss', () => {
    const [s] = topArrowShapes([{ uci: 'e2e4', winLoss: 1, gap: 20 }]);
    expect(s!.brush).toBe('top0');
  });

  it('ranks at the arrowheads when there are several, none for a single arrow', () => {
    const shapes = topArrowShapes([{ uci: 'e2e4', gap: 0 }, { uci: 'e2e3', gap: 1 }]);
    expect(shapes.map((s) => s.label?.text)).toEqual(['2', '1']);
    expect(topArrowShapes([{ uci: 'e2e4', gap: 0 }])[0]!.label).toBeUndefined();
  });

  it('unscored moves fade by rank', () => {
    const [third, second, best] = topArrowShapes([{ uci: 'e2e4' }, { uci: 'd2d4' }, { uci: 'g1f3' }]);
    expect(best!.brush).toBe('top9');
    expect(Number(second!.brush!.slice(3))).toBeGreaterThan(Number(third!.brush!.slice(3)));
  });

  it('a brilliant move in the Brilliant colour, never faint, its rank on a teal disc', () => {
    const shapes = topArrowShapes([{ uci: 'e2e4', gap: 0 }, { uci: 'f3f7', gap: 20, brilliant: { sacrifice: 3 } }]);
    const bril = shapes.find((s) => s.orig === 'f3')!;
    expect(bril.brush).toBe('bril6');
    expect(bril.label?.fill).toBe(TOP_BRILLIANT);
    expect(shapes.find((s) => s.orig === 'e2')!.brush).toBe('top9');
  });

  it('one brush per step, faintest to brightest', () => {
    const b = topBrushes();
    expect(Object.keys(b)).toHaveLength(20);
    expect(b.top0!.opacity).toBeLessThan(b.top9!.opacity);
    expect(topStrength(0)).toBe(1);
    expect(topStrength(2.5)).toBeCloseTo(Math.exp(-1));
  });
});
