import { describe, expect, it } from 'vitest';
import { ANALYSIS_VERSION, winPercent } from '@chess-coach/shared';

describe('client can import @chess-coach/shared', () => {
  it('resolves the TS source package', () => {
    expect(ANALYSIS_VERSION).toBeGreaterThanOrEqual(1);
    expect(winPercent(0)).toBe(50);
  });
});
