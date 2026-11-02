import { describe, expect, it } from 'vitest';
import { ANALYSIS_VERSION, DEFAULT_SETTINGS, settingsHash, stableStringify, type AnalysisSettings } from '../src/settings';
// also check the package entry point resolves
import * as shared from '@chess-coach/shared';

describe('settings', () => {
  it('has the spec defaults', () => {
    expect(ANALYSIS_VERSION).toBe(6);
    const s = DEFAULT_SETTINGS;
    expect([s.labels.excellentMaxLoss, s.labels.goodMaxLoss, s.labels.inaccuracyMaxLoss, s.labels.mistakeMaxLoss]).toEqual([2, 5, 10, 20]);
    expect(s.material).toMatchObject({ blunderMinLoss: 3, blunderMinEvalDropCp: 250, mistakeMinLoss: 2, mistakeMinEvalDropCp: 150 });
    expect(s.suggest).toMatchObject({ winningMin: 70, drawishMin: 30, candidates: 5 });
    expect(s.budget.deep).toEqual({ depth: 14, multipv: 5, maxMs: 5000 });
    expect(s.budget.shallow).toEqual({ depth: 8, multipv: 5, maxMs: 500 });
    expect(s.budget.threat).toEqual({ depth: 12, multipv: 1, maxMs: 500 });
    expect(s.budget.forcedness).toEqual({ depth: 12, multipv: 2, maxMs: 500 });
  });

  it('settingsHash is stable and key-order independent', () => {
    const h = settingsHash(DEFAULT_SETTINGS);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(settingsHash(structuredClone(DEFAULT_SETTINGS))).toBe(h);
    const reordered = Object.fromEntries(Object.entries(DEFAULT_SETTINGS).reverse()) as unknown as AnalysisSettings;
    expect(settingsHash(reordered)).toBe(h);
  });

  it('settingsHash changes when any value changes', () => {
    const h = settingsHash(DEFAULT_SETTINGS);
    const s = structuredClone(DEFAULT_SETTINGS);
    s.budget.deep.depth = 19;
    expect(settingsHash(s)).not.toBe(h);
    const t = structuredClone(DEFAULT_SETTINGS);
    t.labels.excellentMaxLoss = 2.1;
    expect(settingsHash(t)).not.toBe(h);
  });

  it('stableStringify sorts keys recursively', () => {
    expect(stableStringify({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe('{"a":{"c":null,"d":[1,{"x":1,"y":2}]},"b":1}');
  });

  it('package entry re-exports everything', () => {
    expect(shared.DEFAULT_SETTINGS).toBe(DEFAULT_SETTINGS);
    expect(shared.winPercent(0)).toBe(50);
  });
});
