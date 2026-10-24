// Engine line (PV) → displayable steps with move numbers and the position after each move.
import { moveNumberLabel, playUci, sideToMove } from './chess';

export interface PvStep {
  index: number;
  uci: string;
  san: string;
  /** "12." / "12..." shown before the move (only where a number is needed). */
  number: string | null;
  fenAfter: string;
}

export function pvSteps(fenBefore: string, pvUci: readonly string[], max = 12): PvStep[] {
  const out: PvStep[] = [];
  let fen = fenBefore;
  for (let i = 0; i < Math.min(max, pvUci.length); i++) {
    const m = playUci(fen, pvUci[i]!);
    if (!m) break;
    const white = sideToMove(fen) === 'white';
    out.push({ index: i, uci: m.uci, san: m.san, number: i === 0 || white ? moveNumberLabel(fen) : null, fenAfter: m.fenAfter });
    fen = m.fenAfter;
  }
  return out;
}
