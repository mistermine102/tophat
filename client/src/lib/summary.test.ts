import type { MoveAnalysis } from '@chess-coach/shared';
import { gameAccuracyFromScores } from '@chess-coach/shared';
import { describe, expect, it } from 'vitest';
import { fixtureGame } from '../fixtures/game';
import { computeSummary } from './summary';

const { game, analyses } = fixtureGame();

describe('computeSummary', () => {
  it('is empty before any analysis', () => {
    const s = computeSummary(game, {});
    expect(s).toEqual({ white: { accuracy: null, counts: {} }, black: { accuracy: null, counts: {} }, done: 0, total: 72 });
  });

  it('counts labels per side and computes Lichess game accuracy', () => {
    const s = computeSummary(game, analyses);
    expect(s.done).toBe(72);
    const total = (c: Record<string, number | undefined>) => Object.values(c).reduce<number>((a, b) => a + (b ?? 0), 0);
    expect(total(s.white.counts)).toBe(36);
    expect(total(s.black.counts)).toBe(36);
    expect(s.white.counts.book).toBe(5);
    expect(s.white.counts.forced).toBe(3);
    expect(s.white.counts.great).toBe(1);
    expect(s.black.counts.miss).toBe(1);
    expect(s.black.counts.blunder).toBe(1);
    expect(s.white.counts.blunder).toBe(2);

    const scores = [analyses[1]!.evalBefore, ...game.moves.map((m) => analyses[m.ply]!.evalAfter)];
    const expected = gameAccuracyFromScores(scores, 'white');
    expect(s.white.accuracy).toBeCloseTo(expected.white!, 6);
    expect(s.black.accuracy).toBeCloseTo(expected.black!, 6);
    expect(s.black.accuracy!).toBeGreaterThan(s.white.accuracy!);
  });

  it('works on partial results (in-order prefix, plus focused plies out of order)', () => {
    const partial: Record<number, MoveAnalysis> = {};
    for (let p = 1; p <= 24; p++) partial[p] = analyses[p]!;
    for (const p of [31, 32]) partial[p] = analyses[p]!;
    const s = computeSummary(game, partial);
    expect(s.done).toBe(26);
    expect(s.total).toBe(72);
    expect(s.white.counts.blunder).toBe(1);
    expect(s.black.counts.miss).toBe(1);
    expect(s.white.counts.great).toBe(1);
    for (const acc of [s.white.accuracy, s.black.accuracy]) {
      expect(acc).not.toBeNull();
      expect(acc!).toBeGreaterThan(0);
      expect(acc!).toBeLessThanOrEqual(100);
    }
  });

  it('isolated plies alone give no accuracy yet (Lichess skips windows with unknown evals)', () => {
    const s = computeSummary(game, { 40: analyses[40]! });
    expect(s.done).toBe(1);
    expect(s.black.counts.mistake).toBe(1);
    expect(s.black.accuracy).toBeNull();
  });
});
