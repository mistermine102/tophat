// (D1) Fast, then final: the quick, provisional analysis and the sticky-label rule.
import { DEFAULT_SETTINGS } from '@chess-coach/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STICKY_MARGIN, stickyLabel } from '../src/analysis/analyzeMove';
import { quickAnalysis, quickSettings } from '../src/analysis/quick';
import { SearchCache } from '../src/analysis/searchCache';
import { Engine, engineAvailable } from '../src/engine/node';
import { MemoryStore } from '../src/store';

const S = DEFAULT_SETTINGS;

describe('stickyLabel', () => {
  it('a neighbour near the threshold between them keeps the shown label', () => {
    // Inaccuracy | Mistake at 10% win chance
    expect(stickyLabel('mistake', 'inaccuracy', 'mistake', 11, S)).toBe('inaccuracy');
    expect(stickyLabel('inaccuracy', 'mistake', 'inaccuracy', 8, S)).toBe('mistake');
    // Excellent | Good at 2%
    expect(stickyLabel('good', 'excellent', 'good', 3.5, S)).toBe('excellent');
  });

  it('a real difference takes the full label', () => {
    expect(stickyLabel('blunder', 'good', 'blunder', 30, S)).toBe('blunder'); // not neighbours
    expect(stickyLabel('mistake', 'inaccuracy', 'mistake', 10 + STICKY_MARGIN + 1, S)).toBe('mistake'); // far from the threshold
    expect(stickyLabel('miss', 'mistake', 'mistake', 11, S)).toBe('miss'); // a rule decided the full label
    expect(stickyLabel('great', 'best', 'best', 0, S)).toBe('great');
    expect(stickyLabel('mistake', undefined, 'mistake', 11, S)).toBe('mistake');
  });

  it('a quick Best stays only within noise of the top move', () => {
    expect(stickyLabel('excellent', 'best', 'excellent', 0.6, S)).toBe('best');
    expect(stickyLabel('excellent', 'best', 'excellent', 1.8, S)).toBe('excellent');
  });
});

describe('quickSettings', () => {
  it('a light deep search, no verification, everything else unchanged', () => {
    const q = quickSettings(S);
    expect(q.budget.deep.depth).toBeLessThan(S.budget.deep.depth);
    expect(q.budget.deep.multipv).toBe(2);
    expect(q.budget.verify.margin).toBe(0);
    expect(q.labels).toEqual(S.labels);
  });
});

describe.skipIf(!engineAvailable())('quickAnalysis (Stockfish)', () => {
  let engine: Engine;
  beforeAll(async () => {
    engine = await Engine.start({ threads: 1, hashMb: 32 });
  }, 60_000);
  afterAll(() => engine?.quit());

  it('6.f3?: a provisional bad label in well under a second, no explanations, the best move after it', async () => {
    const ctx = { searcher: engine, cache: new SearchCache(new MemoryStore()), settings: S };
    const fenBefore = 'r1bqkbnr/ppp3pp/2n2p2/4p3/3p3P/1P4P1/PBPPPPB1/RN1QK1NR w KQkq - 0 6';
    const prev = { fenBefore: 'r1bqkbnr/ppp3pp/2n2p2/3pp3/7P/1P4P1/PBPPPPB1/RN1QK1NR b KQkq - 0 5', uci: 'd5d4' };
    const t = performance.now();
    const a = await quickAnalysis(ctx, { fenBefore, uci: 'f2f3', prev });
    expect(performance.now() - t).toBeLessThan(5000);
    expect(a.provisional).toBe(true);
    expect(['mistake', 'blunder']).toContain(a.label);
    expect(a.played.explanation).toBeUndefined();
    expect(a.labelText).toMatch(/^(Mistake|Blunder)/);
    expect(a.nextBest?.uci).toMatch(/^[a-h][1-8][a-h][1-8]/);
    expect(a.arrows.map((x) => x.kind)).toEqual(['played', 'best']);
  }, 60_000);
});
