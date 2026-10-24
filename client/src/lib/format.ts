// Eval / number formatting for display. All evals given here are White POV (MoveAnalysis.evalBefore/After,
// Candidate.score).
import type { Color, Score } from '@chess-coach/shared';
import { winPercentFromScore } from '@chess-coach/shared';

/** "+1.2", "-0.4", "0.0", "M3" (White mates in 3), "-M3" (Black mates in 3), "#" (mate on the board). */
export function formatScore(score: Score | null | undefined): string {
  if (!score) return '…';
  if (score.mate !== undefined) {
    if (score.mate === 0) return '#';
    return score.mate > 0 ? `M${score.mate}` : `-M${-score.mate}`;
  }
  if (score.cp === undefined) return '…';
  const pawns = (Math.sign(score.cp) * Math.round(Math.abs(score.cp) / 10)) / 10; // symmetric rounding
  if (pawns === 0) return '0.0';
  return `${pawns > 0 ? '+' : '-'}${Math.abs(pawns).toFixed(1)}`;
}

/** Like formatScore, but a position that is checkmate on the board shows the result ("1-0" / "0-1"). */
export function formatPositionEval(score: Score | null | undefined, mated: Color | null): string {
  if (mated) return mated === 'white' ? '0-1' : '1-0';
  return formatScore(score);
}

/** Short text for the eval bar label (no "+" sign, absolute value, like most GUIs). */
export function formatBarScore(score: Score | null | undefined, mated: Color | null): string {
  if (mated) return mated === 'white' ? '0-1' : '1-0';
  if (!score) return '';
  if (score.mate !== undefined) return score.mate === 0 ? '#' : `M${Math.abs(score.mate)}`;
  const pawns = Math.abs(Math.round((score.cp ?? 0) / 10) / 10);
  return pawns.toFixed(1);
}

/** White's win% (0..100) for a White POV score; checkmate on the board overrides. */
export function whiteWinPercent(score: Score | null | undefined, mated: Color | null = null): number {
  if (mated) return mated === 'white' ? 0 : 100;
  if (!score) return 50;
  if (score.mate === 0) return 0; // White POV "mate 0" = White is mated
  return winPercentFromScore(score);
}

/** Which side is better according to a White POV score (null = equal / unknown). */
export function scoreLeader(score: Score | null | undefined, mated: Color | null = null): Color | null {
  if (mated) return mated === 'white' ? 'black' : 'white';
  if (!score) return null;
  if (score.mate !== undefined) return score.mate > 0 ? 'white' : 'black';
  if (!score.cp) return null;
  return score.cp > 0 ? 'white' : 'black';
}

/** Explains the sign convention wherever a White-POV eval is shown. */
export const EVAL_POV_HINT = 'Engine evaluation in pawns from White’s side: + means White is better, − means Black is better. M3 = White mates in 3, -M3 = Black mates in 3.';

/** Plain-words verdict for a White POV score, e.g. "White is winning", "Black mates in 2", "about equal". */
export function positionVerdict(score: Score | null | undefined, mated: Color | null = null): string {
  if (mated) return `${mated === 'white' ? 'Black' : 'White'} won by checkmate`;
  if (!score) return '';
  if (score.mate !== undefined) {
    if (score.mate === 0) return 'Black won by checkmate'; // White POV mate 0 = White is mated
    return `${score.mate > 0 ? 'White' : 'Black'} mates in ${Math.abs(score.mate)}`;
  }
  const w = whiteWinPercent(score);
  const side = w >= 50 ? 'White' : 'Black';
  const d = Math.abs(w - 50);
  if (d < 10) return 'about equal';
  if (d < 25) return `${side} is better`;
  return `${side} is winning`;
}

/** "13.2%" (one decimal, no sign). */
export function formatPercent(x: number, digits = 1): string {
  return `${x.toFixed(digits)}%`;
}

/** Signed material in pawns, e.g. "+2", "-9". */
export function formatMaterial(n: number): string {
  if (n === 0) return '0';
  const r = Math.round(n * 10) / 10;
  return `${r > 0 ? '+' : '-'}${Math.abs(r)}`;
}

export function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}
