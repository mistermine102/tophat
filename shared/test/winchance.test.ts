import { describe, expect, it } from 'vitest';
import {
  CP_CEILING,
  flipScore,
  fromWhitePov,
  gameAccuracy,
  gameAccuracyFromScores,
  harmonicMean,
  moveAccuracy,
  scoreToCp,
  standardDeviation,
  toWhitePov,
  weightedMean,
  winPercent,
  winPercentForColor,
  winPercentFromScore,
} from '../src/winchance';

describe('scoreToCp', () => {
  it('passes cp through and clamps to +-1000', () => {
    expect(scoreToCp({ cp: 37 })).toBe(37);
    expect(scoreToCp({ cp: -250 })).toBe(-250);
    expect(scoreToCp({ cp: 5000 })).toBe(1000);
    expect(scoreToCp({ cp: -5000 })).toBe(-1000);
  });
  it('maps mate to +-1000 (mate for POV side = +)', () => {
    expect(scoreToCp({ mate: 1 })).toBe(CP_CEILING);
    expect(scoreToCp({ mate: 12 })).toBe(1000);
    expect(scoreToCp({ mate: -3 })).toBe(-1000);
    expect(scoreToCp({ mate: 0 })).toBe(-1000); // POV side is checkmated
  });
  it('throws on an empty score', () => {
    expect(() => scoreToCp({})).toThrow();
  });
});

describe('winPercent', () => {
  it('known values', () => {
    expect(winPercent(0)).toBe(50);
    expect(winPercent(100)).toBeCloseTo(59.1, 1);
    expect(winPercent(-100)).toBeCloseTo(40.9, 1);
    expect(winPercent(300)).toBeCloseTo(75.11, 2);
    expect(winPercent(1000)).toBeCloseTo(97.54, 2);
  });
  it('clamps beyond the ceiling', () => {
    expect(winPercent(1000)).toBe(winPercent(1001));
    expect(winPercent(99999)).toBe(winPercent(1000));
    expect(winPercent(-99999)).toBe(winPercent(-1000));
  });
  it('is symmetric: win(cp) + win(-cp) = 100', () => {
    for (const cp of [0, 1, 15, 50, 123, 400, 999, 1000, 4000]) {
      expect(winPercent(cp) + winPercent(-cp)).toBeCloseTo(100, 10);
    }
  });
  it('is strictly monotonic within the ceiling and bounded in [0, 100]', () => {
    let prev = -Infinity;
    for (let cp = -1000; cp <= 1000; cp += 10) {
      const w = winPercent(cp);
      expect(w).toBeGreaterThan(prev);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(100);
      prev = w;
    }
  });
  it('from score: mate equals the ceiling', () => {
    expect(winPercentFromScore({ mate: 2 })).toBe(winPercent(1000));
    expect(winPercentFromScore({ mate: -2 })).toBe(winPercent(-1000));
    expect(winPercentFromScore({ cp: 0 })).toBe(50);
  });
});

describe('POV helpers', () => {
  it('flipScore', () => {
    expect(flipScore({ cp: 42 })).toEqual({ cp: -42 });
    expect(flipScore({ cp: 0 })).toEqual({ cp: 0 });
    expect(Object.is(flipScore({ cp: 0 }).cp, -0)).toBe(false);
    expect(flipScore({ mate: 3 })).toEqual({ mate: -3 });
    expect(flipScore({ mate: -1 })).toEqual({ mate: 1 });
    // mated -> delivered mate for the other side, expressed as the cp ceiling
    expect(flipScore({ mate: 0 })).toEqual({ cp: 1000 });
  });
  it('toWhitePov / fromWhitePov', () => {
    expect(toWhitePov({ cp: 50 }, 'white')).toEqual({ cp: 50 });
    expect(toWhitePov({ cp: 50 }, 'black')).toEqual({ cp: -50 });
    expect(fromWhitePov({ mate: 2 }, 'black')).toEqual({ mate: -2 });
    expect(winPercentForColor({ cp: 200 }, 'white') + winPercentForColor({ cp: 200 }, 'black')).toBeCloseTo(100, 10);
  });
});

describe('moveAccuracy (Lichess AccuracyPercent.fromWinPercents)', () => {
  it('is 100 when win% does not drop', () => {
    expect(moveAccuracy(50, 50)).toBe(100);
    expect(moveAccuracy(40, 60)).toBe(100);
  });
  it('known values (incl. +1 uncertainty bonus)', () => {
    const f = (d: number) => 103.1668100711649 * Math.exp(-0.04354415386753951 * d) - 3.166924740191411 + 1;
    expect(moveAccuracy(50, 40)).toBeCloseTo(f(10), 10);
    expect(moveAccuracy(50, 40)).toBeCloseTo(64.58, 1);
    expect(moveAccuracy(60, 55)).toBeCloseTo(f(5), 10);
    // tiny loss: raw > 100 -> clamped to 100
    expect(moveAccuracy(50, 49.99)).toBe(100);
  });
  it('is monotonic decreasing in the loss and clamped at 0', () => {
    let prev = Infinity;
    for (let d = 0.5; d <= 100; d += 0.5) {
      const a = moveAccuracy(100, 100 - d);
      expect(a).toBeLessThanOrEqual(prev);
      expect(a).toBeGreaterThanOrEqual(0);
      prev = a;
    }
    expect(moveAccuracy(100, 0)).toBe(0);
  });
});

describe('Maths helpers', () => {
  it('population standard deviation', () => {
    expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    expect(standardDeviation([])).toBeNull();
  });
  it('weighted mean', () => {
    expect(weightedMean([[10, 1], [20, 3]])).toBe(17.5);
    expect(weightedMean([])).toBeNull();
    expect(weightedMean([[10, 0]])).toBeNull();
  });
  it('harmonic mean uses max(1, v)', () => {
    expect(harmonicMean([50, 100])).toBeCloseTo(2 / (1 / 50 + 1 / 100), 10);
    expect(harmonicMean([0, 100])).toBeCloseTo(2 / (1 + 0.01), 10);
    expect(harmonicMean([])).toBeNull();
  });
});

describe('gameAccuracy (Lichess AccuracyPercent.gameAccuracy)', () => {
  it('perfectly stable game -> 100 for both sides', () => {
    const acc = gameAccuracy(Array.from({ length: 30 }, () => 20));
    expect(acc.white).toBeCloseTo(100, 10);
    expect(acc.black).toBeCloseTo(100, 10);
  });

  it('matches a hand computation on a short game (window size 2)', () => {
    // positions: start, after W1, after B1, after W2, after B2 (White POV cp)
    const cps = [15, 20, 20, -300, -300];
    const w = cps.map(winPercent);
    // windowSize = clamp(trunc(4/10), 2, 8) = 2 -> windows are the consecutive pairs
    const weight = (a: number, b: number) => Math.min(12, Math.max(0.5, Math.abs(a - b) / 2));
    const white = [moveAccuracy(w[0]!, w[1]!), moveAccuracy(w[2]!, w[3]!)];
    const whiteW = [weight(w[0]!, w[1]!), weight(w[2]!, w[3]!)];
    // black: before/after in black POV = 100 - white win%, equivalently fromWinPercents(next, prev)
    const black = [moveAccuracy(w[2]!, w[1]!), moveAccuracy(w[4]!, w[3]!)];
    const blackW = [weight(w[1]!, w[2]!), weight(w[3]!, w[4]!)];
    const combine = (a: number[], ws: number[]) => {
      const wm = (a[0]! * ws[0]! + a[1]! * ws[1]!) / (ws[0]! + ws[1]!);
      const hm = 2 / (1 / Math.max(1, a[0]!) + 1 / Math.max(1, a[1]!));
      return (wm + hm) / 2;
    };
    const acc = gameAccuracy(cps);
    expect(acc.white).toBeCloseTo(combine(white, whiteW), 10);
    expect(acc.black).toBeCloseTo(combine(black, blackW), 10);
    expect(acc.black).toBeCloseTo(100, 10);
    expect(acc.white!).toBeLessThan(80);
  });

  it('uses window size floor((n-1)/10) clamped to [2, 8] with leading duplicate windows', () => {
    // 41 positions -> windowSize 4: weights = 2 copies of first window + 38 sliding windows = 40 = number of moves.
    const cps = Array.from({ length: 41 }, (_, i) => (i >= 20 ? 600 : 30));
    const acc = gameAccuracy(cps);
    expect(acc.white).not.toBeNull();
    expect(acc.black).not.toBeNull();
    // move index 19 (positions 19 -> 20) is odd -> Black (start White): Black blunders 30 -> +600
    expect(acc.black!).toBeLessThan(acc.white!);
  });

  it('assigns movers from startColor', () => {
    const cps = [0, -400, -400, -400, -400];
    const fromWhite = gameAccuracy(cps, 'white');
    const fromBlack = gameAccuracy(cps, 'black');
    expect(fromWhite.white!).toBeLessThan(100);
    expect(fromWhite.black).toBeCloseTo(100, 10);
    // when black moves first the first move (0 -> -400) is black's and is an improvement for black
    expect(fromBlack.black).toBeCloseTo(100, 10);
    expect(fromBlack.white).toBeCloseTo(100, 10);
  });

  it('skips moves touching unknown evals and returns null for empty input', () => {
    expect(gameAccuracy([])).toEqual({ white: null, black: null });
    expect(gameAccuracy([15])).toEqual({ white: null, black: null });
    const acc = gameAccuracy([15, null, 20, 20, 20]);
    // moves 0 (W) and 1 (B) touch null and are skipped; the windows containing null have no weight
    expect(acc.white).toBeCloseTo(100, 10);
    expect(acc.black).toBeCloseTo(100, 10);
  });

  it('accepts Scores (mate -> ceiling)', () => {
    const a = gameAccuracyFromScores([{ cp: 15 }, { cp: 20 }, { mate: 3 }]);
    const b = gameAccuracy([15, 20, 1000]);
    expect(a).toEqual(b);
  });
});
