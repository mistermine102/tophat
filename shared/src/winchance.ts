// Win chance and accuracy, following Lichess.
//
// Sources (lichess-org, AGPL/MIT code, formulas re-implemented here):
//  - scalachess core/src/main/scala/eval.scala: WinPercent.fromCentiPawns / winningChances, Cp.CEILING = 1000
//    (MULTIPLIER = -0.00368208, https://github.com/lichess-org/lila/pull/11148)
//  - lila modules/analyse/src/main/AccuracyPercent.scala: fromWinPercents, gameAccuracy
//  - scalalib lila/src/main/scala/Maths.scala: standardDeviation (population), weightedMean, harmonicMean
//
// Conventions: `Score` is from some side's point of view (POV); mate > 0 means that side mates.
// `mate: 0` means the side to move is already mated (as printed by UCI engines), i.e. a loss for that POV.

import type { Color, Score } from './types';

/** Centipawn ceiling used by Lichess; mate scores map to +-CP_CEILING. */
export const CP_CEILING = 1000;

const WIN_MULTIPLIER = -0.00368208;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Score -> centipawns in the same POV, clamped to [-1000, 1000]; mate for that POV = +1000, mated = -1000. */
export function scoreToCp(score: Score): number {
  if (score.mate !== undefined) return score.mate > 0 ? CP_CEILING : -CP_CEILING;
  if (score.cp !== undefined) return clamp(score.cp, -CP_CEILING, CP_CEILING);
  throw new Error('scoreToCp: score has neither cp nor mate');
}

/** Lichess winning chances in [-1, 1] for (unclamped) cp; clamps cp to the ceiling first. */
export function winningChances(cp: number): number {
  const c = clamp(cp, -CP_CEILING, CP_CEILING);
  return clamp(2 / (1 + Math.exp(WIN_MULTIPLIER * c)) - 1, -1, 1);
}

/** Win% in [0, 100] for the POV of `cp`: 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1), cp clamped to +-1000. */
export function winPercent(cp: number): number {
  return 50 + 50 * winningChances(cp);
}

/** Win% for a score (same POV as the score). Mate = +-1000 cp. */
export function winPercentFromScore(score: Score): number {
  return winPercent(scoreToCp(score));
}

/**
 * Flip a score to the other side's POV: cp -> -cp, mate N -> mate -N.
 * Special case: `mate: 0` (POV side is already checkmated) flips to `{ cp: CP_CEILING }` (a delivered mate),
 * because a signed "mate 0" can't be expressed. Win% is identical (+1000 cp); detect checkmate on the board for
 * display ("#"). Consequently flipScore(flipScore({mate:0})) is { cp: -1000 }, not { mate: 0 }.
 */
export function flipScore(score: Score): Score {
  if (score.mate !== undefined) {
    // mate 0 = POV side is mated. For the other side that is a delivered mate: best representable as cp ceiling.
    if (score.mate === 0) return { cp: CP_CEILING };
    return { mate: -score.mate };
  }
  if (score.cp !== undefined) return { cp: score.cp === 0 ? 0 : -score.cp };
  throw new Error('flipScore: score has neither cp nor mate');
}

/**
 * Convert a side-to-move POV score to White POV. `sideToMove` is the side the score is relative to.
 */
export function toWhitePov(score: Score, sideToMove: Color): Score {
  return sideToMove === 'white' ? score : flipScore(score);
}

/** Convert a White POV score to the POV of `color`. */
export function fromWhitePov(score: Score, color: Color): Score {
  return color === 'white' ? score : flipScore(score);
}

/** Win% for `pov` from a White-POV score. */
export function winPercentForColor(whiteScore: Score, pov: Color): number {
  return winPercentFromScore(fromWhitePov(whiteScore, pov));
}

/**
 * Per-move accuracy (Lichess AccuracyPercent.fromWinPercents). Both win% from the mover's POV:
 * winBefore = position before the move, winAfter = position after the move.
 * 100 if the move didn't lose win%, else 103.1668100711649 * exp(-0.04354415386753951 * diff) - 3.166924740191411
 * plus Lichess' +1 "uncertainty bonus", clamped to [0, 100].
 */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100;
  const winDiff = winBefore - winAfter;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * winDiff) + -3.166924740191411;
  return clamp(raw + 1, 0, 100);
}

// --- scalalib Maths -------------------------------------------------------------------------------------------

function mean(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Population standard deviation (scalalib Maths.standardDeviation). */
export function standardDeviation(xs: readonly number[]): number | null {
  const m = mean(xs);
  if (m === null) return null;
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / xs.length);
}

/** scalalib Maths.weightedMean: sum(v*w) / sum(w); null if empty or total weight is 0. */
export function weightedMean(pairs: readonly (readonly [value: number, weight: number])[]): number | null {
  if (pairs.length === 0) return null;
  let sv = 0;
  let sw = 0;
  for (const [v, w] of pairs) {
    sv += v * w;
    sw += w;
  }
  return sw !== 0 ? sv / sw : null;
}

/** scalalib Maths.harmonicMean: n / sum(1 / max(1, v)); null if empty. */
export function harmonicMean(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  let s = 0;
  for (const v of xs) s += 1 / Math.max(1, v);
  return xs.length / s;
}

/** Scala `List.sliding(size)`: windows of `size` with step 1; a shorter non-empty list yields one window. */
function sliding<T>(xs: readonly T[], size: number): T[][] {
  if (xs.length === 0) return [];
  if (xs.length <= size) return [xs.slice()];
  const out: T[][] = [];
  for (let i = 0; i + size <= xs.length; i++) out.push(xs.slice(i, i + size));
  return out;
}

export interface GameAccuracy {
  white: number | null;
  black: number | null;
}

/**
 * Game accuracy per side, a faithful port of lila AccuracyPercent.gameAccuracy (Lichess):
 * "a mean of volatility-weighted mean and harmonic mean".
 *
 * @param whiteCps White-POV centipawn evals of every position of the game INCLUDING the initial position:
 *   `[evalOfStartPosition, evalAfterPly1, evalAfterPly2, ...]`. Mates should be passed as large values
 *   (they are clamped to +-1000 like Lichess' forceAsCp + ceiling) — or use `gameAccuracyFromScores`.
 *   `null` = unknown eval (moves touching it are skipped, like Lichess' Option handling).
 * @param startColor side to move in the initial position.
 *
 * Algorithm (identical to Lichess):
 *  - win% for each position (White POV).
 *  - windowSize = clamp(floor((n - 1) / 10), 2, 8) where n = number of positions.
 *  - windows = (min(windowSize, n) - 2) copies of the first window, followed by all sliding windows of windowSize.
 *  - weight of window = clamp(populationStdDev(win%s), 0.5, 12) (null if any win% in the window is unknown).
 *  - move i (positions i -> i+1) gets weight[i]; mover alternates starting with startColor; accuracy from the
 *    mover's POV via moveAccuracy.
 *  - per colour: (weightedMean(accuracy, weight) + harmonicMean(accuracy)) / 2.
 */
export function gameAccuracy(whiteCps: readonly (number | null)[], startColor: Color = 'white'): GameAccuracy {
  const wins: (number | null)[] = whiteCps.map((cp) => (cp === null ? null : winPercent(cp)));
  const n = wins.length;
  const windowSize = clamp(Math.trunc((n - 1) / 10), 2, 8);

  const first = wins.slice(0, windowSize);
  const windows: (number | null)[][] = [];
  for (let i = 0; i < Math.min(windowSize, n) - 2; i++) windows.push(first);
  windows.push(...sliding(wins, windowSize));

  const weights: (number | null)[] = windows.map((w) => {
    if (w.some((x) => x === null)) return null;
    const sd = standardDeviation(w as number[]) ?? 0;
    return clamp(sd, 0.5, 12);
  });

  const perColor: Record<Color, { weighted: [number, number][]; plain: number[] }> = {
    white: { weighted: [], plain: [] },
    black: { weighted: [], plain: [] },
  };
  const pairs = sliding(wins, 2).filter((p) => p.length === 2);
  const count = Math.min(pairs.length, weights.length);
  for (let i = 0; i < count; i++) {
    const [prev, next] = pairs[i]!;
    const weight = weights[i]!;
    const color: Color = (i % 2 === 0) === (startColor === 'white') ? 'white' : 'black';
    if (prev === null || prev === undefined || next === null || next === undefined || weight === null) continue;
    const acc = color === 'white' ? moveAccuracy(prev, next) : moveAccuracy(next, prev);
    perColor[color].weighted.push([acc, weight]);
    perColor[color].plain.push(acc);
  }

  const colorAccuracy = (c: Color): number | null => {
    const w = weightedMean(perColor[c].weighted);
    const h = harmonicMean(perColor[c].plain);
    return w === null || h === null ? null : (w + h) / 2;
  };
  return { white: colorAccuracy('white'), black: colorAccuracy('black') };
}

/** Same as gameAccuracy, taking White-POV Scores (mate -> +-1000 cp). */
export function gameAccuracyFromScores(whiteScores: readonly (Score | null)[], startColor: Color = 'white'): GameAccuracy {
  return gameAccuracy(
    whiteScores.map((s) => (s === null ? null : scoreToCp(s))),
    startColor,
  );
}
