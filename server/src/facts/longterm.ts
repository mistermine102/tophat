// Long-term level facts of a move (pure; engine scores are passed in).
//
// - positional: `positionalDelta(fenBefore, fenAfter)` (the move itself) plus changes that only appear at the end
//   of the narrated short line (`positionalDelta(fenBefore, lineEndFen)`, marked `at: 'line-end'`, only for
//   feature/side pairs the move itself didn't already change). Filters (noise that reads wrong to a beginner):
//     * `development` dropped when the Immediate level already says develop/castle, and when negative (a piece
//       back home or the king leaving its castled square — the fact can't tell which);
//     * `king-safety` dropped when its only component is "open files" next to a king on the c–f files (central
//       pawn trades in the opening open files next to an uncastled king on every move);
//     * `open-file-rook` dropped for a side whose rook count went down (a captured rook "losing its file");
//     * line-end facts: LINE_END_FEATURES only, and not the opponent's improvements (not the move's doing).
//   Sorted by POSITIONAL_ORDER, at most MAX_POSITIONAL facts, of which at most one MINOR_FEATURES fact (only when
//   fewer than 2 major ones).
// - positional-gain: deep eval gain for the mover not explained by material in the short line, for moves that
//   give material up (the Immediate level has a new `hangs` or a capture that `loses-material`):
//   `gain = (cp(move) - cp(best)) - 100 * line.materialDelta` (mover POV, unclamped cp as in the material rule's
//   guard; skipped when a mate score is involved). Reported when `gain >= explain.positionalGainMinCp`: the
//   material goes but the engine's eval doesn't drop accordingly (compensation: gambits, sacrifices). Restricting
//   it to moves that give material up avoids calling an unavoidable loss in the engine line "compensation".
// - deep-payoff: the deep search rates the move well (winLoss <= labels.goodMaxLoss) but the shallow search
//   rates it at least `explain.deepPayoffMinGap` win% lower than the deep search does.
// - necessary: only legal move (`onlyMove`), or the move is the engine's #1 and the 2nd best loses >=
//   explain.necessaryMinGap win% — and nothing else long-term is notable (only MINOR_FEATURES changes).
// - nothing-notable: the level would otherwise be empty.

import type { AnalysisSettings, Color, Fact, PositionalFeature, Score } from '@chess-coach/shared';
import { winPercentFromScore } from '@chess-coach/shared';
import { guardCp } from '../analysis/classify';
import { positionFromFen } from '../chess/material';
import { positionalDelta } from './positional';

export const POSITIONAL_ORDER: readonly PositionalFeature[] = [
  'king-safety', 'passed-pawn', 'bishop-pair', 'isolated-pawn', 'doubled-pawn', 'open-file-rook', 'development',
  'centre-control', 'mobility', 'space',
];
export const MAX_POSITIONAL = 3;
/**
 * Features reported at the end of the short line: structure and king safety only (captures in the line make
 * mobility/space/rook-file/bishop-pair changes there mostly a restatement of the material result).
 */
export const LINE_END_FEATURES: ReadonlySet<PositionalFeature> = new Set<PositionalFeature>(['king-safety', 'passed-pawn', 'isolated-pawn', 'doubled-pawn']);
/** Small, frequent changes that don't count as a "notable long-term change" for `necessary`. */
export const MINOR_FEATURES: ReadonlySet<PositionalFeature> = new Set<PositionalFeature>(['mobility', 'space', 'centre-control']);

type PositionalFact = Extract<Fact, { type: 'positional' }>;

export interface LongTermInput {
  fenBefore: string;
  fenAfter: string;
  /** Position at the end of the narrated short line (may equal fenAfter). */
  lineEndFen: string;
  mover: Color;
  /** Immediate facts of the move (redundant `development`; does the move give material up?). */
  immediate: readonly Fact[];
  /** Short line material change (line fact `materialDelta`). */
  lineMaterialDelta: number;
  /** Deep score of the move and of the engine's best move, mover POV. */
  score: Score;
  bestScore: Score;
  /** Shallow score of the move, mover POV (if known). */
  shallowScore?: Score | null;
  /** The move is the engine's #1. */
  isBest: boolean;
  /** winLoss of the engine's 2nd-best move (null if there is none). */
  secondBestLoss?: number | null;
  legalMoves: number;
  settings: AnalysisSettings;
}

const order = (f: PositionalFact) => {
  const i = POSITIONAL_ORDER.indexOf(f.feature);
  return i < 0 ? POSITIONAL_ORDER.length : i;
};

function rookCount(fen: string, color: Color): number {
  return positionFromFen(fen).board.pieces(color, 'rook').size();
}

/** Noise filters shared by move-level and line-end facts (see header). */
function keep(f: PositionalFact, fenBefore: string, fenAt: string, mover: Color): boolean {
  if (f.feature === 'king-safety' && f.detail && /^open files \d+->\d+$/.test(f.detail)) {
    const file = f.squares?.[0]?.[0];
    if (file && 'cdef'.includes(file)) return false;
  }
  if (f.feature === 'open-file-rook') {
    const color: Color = f.side === 'opponent' ? (mover === 'white' ? 'black' : 'white') : mover;
    if (rookCount(fenAt, color) < rookCount(fenBefore, color)) return false;
  }
  return true;
}

/** Positional facts of the move and of the line end (see header). */
export function positionalFacts(input: Pick<LongTermInput, 'fenBefore' | 'fenAfter' | 'lineEndFen' | 'mover' | 'immediate'>): PositionalFact[] {
  const { fenBefore, fenAfter, lineEndFen, mover } = input;
  const own = (positionalDelta(fenBefore, fenAfter, mover) as PositionalFact[]).filter((f) => keep(f, fenBefore, fenAfter, mover));
  const seen = new Set(own.map((f) => `${f.feature}|${f.side ?? ''}`));
  const atEnd: PositionalFact[] = [];
  if (lineEndFen !== fenAfter) {
    for (const f of positionalDelta(fenBefore, lineEndFen, mover) as PositionalFact[]) {
      if (seen.has(`${f.feature}|${f.side ?? ''}`) || !LINE_END_FEATURES.has(f.feature)) continue;
      if (f.side === 'opponent' && f.delta < 0) continue; // the opponent improving during the line isn't the move's doing
      if (!keep(f, fenBefore, lineEndFen, mover)) continue;
      atEnd.push({ ...f, at: 'line-end' });
    }
  }
  const saysDevelop = input.immediate.some((f) => f.type === 'develop' || f.type === 'castle');
  return [...own, ...atEnd]
    .filter((f) => !(f.feature === 'development' && (saysDevelop || f.delta < 0)))
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (a.f.at ? 1 : 0) - (b.f.at ? 1 : 0) || order(a.f) - order(b.f) || a.i - b.i)
    .map((x) => x.f);
}

/** The move gives material up right away: a new hanging piece or a capture that loses the exchange. */
export function givesMaterialUp(immediate: readonly Fact[]): boolean {
  return immediate.some((f) => (f.type === 'hangs' && !f.already) || (f.type === 'capture' && f.outcome === 'loses-material'));
}

export function longTermFacts(input: LongTermInput): Fact[] {
  const s = input.settings;
  // major features first; at most one minor (mobility / space / centre) and only if there is room
  const all = positionalFacts(input);
  const majors = all.filter((f) => !MINOR_FEATURES.has(f.feature)).slice(0, MAX_POSITIONAL);
  const minor = majors.length < MAX_POSITIONAL - 1 ? all.filter((f) => MINOR_FEATURES.has(f.feature) && !f.at).slice(0, 1) : [];
  const facts: Fact[] = [...majors, ...minor];

  const mateInvolved = input.score.mate !== undefined || input.bestScore.mate !== undefined;
  if (!mateInvolved && givesMaterialUp(input.immediate)) {
    const gain = guardCp(input.score) - guardCp(input.bestScore) - 100 * input.lineMaterialDelta;
    if (gain >= s.explain.positionalGainMinCp) facts.push({ type: 'positional-gain', cp: Math.round(gain) });
  }

  if (input.shallowScore) {
    const winDeep = winPercentFromScore(input.score);
    const winLoss = Math.max(0, winPercentFromScore(input.bestScore) - winDeep);
    const gap = winDeep - winPercentFromScore(input.shallowScore);
    if (winLoss <= s.labels.goodMaxLoss && gap >= s.explain.deepPayoffMinGap) facts.push({ type: 'deep-payoff' });
  }

  const only = input.legalMoves === 1;
  const necessary = only || (input.isBest && input.secondBestLoss != null && input.secondBestLoss >= s.explain.necessaryMinGap);
  const major = facts.filter((f) => !(f.type === 'positional' && MINOR_FEATURES.has(f.feature)));
  if (necessary && major.length === 0) return [only ? { type: 'necessary', onlyMove: true } : { type: 'necessary' }, ...facts];
  if (facts.length === 0) facts.push({ type: 'nothing-notable' });
  return facts;
}
