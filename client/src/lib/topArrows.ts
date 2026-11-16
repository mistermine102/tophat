// "Show best move" arrows: the engine's top moves in the position on the board, gold, as bright as they are good.
// Brightness and width follow how much worse than the best a move is (TopMove.gap: win-chance loss, or centipawns when
// a side is far ahead): the best is full gold and thick, a move almost as good almost as bright, and a move clearly
// worse a thin, faint trace (feedback round 4: punished harder, so a lone good move stands out). With several arrows each
// gets its rank at the arrowhead (chessground labels), so arrows along the same line stay readable; the best is drawn
// last, on top.
// (Brilliant lines) A brilliant move (a sound sacrifice, TopMove.brilliant) is drawn in the Brilliant colour instead
// of gold, never fainter than BRILLIANT_MIN_STRENGTH, so one appended after the list (TopMove.extra) still shows.
import type { DrawBrush, DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { LABELS } from './labels';

export const TOP_GOLD = '#e0a400';
/** The Brilliant !! colour. */
export const TOP_BRILLIANT = LABELS.brilliant.color;
/** A brilliant move's arrow is at least this bright (topStrength scale). */
const BRILLIANT_MIN_STRENGTH = 0.7;
const FAINT_GREY = '#9ca3af';
/** Opacity steps (brushes top0 … top9: chessground brushes have a fixed opacity). */
const STEPS = 10;
const MIN_OPACITY = 0.12;
const MAX_OPACITY = 0.95;
/** Gap (win%) at which a move is drawn at about a third of the best one's brightness. */
const FADE_GAP = 2.5;
/** Arrow width: the best move's, and the faintest's. */
const MAX_WIDTH = 7;
const MIN_WIDTH = 2;
/** Unscored moves (no top-moves search): rank 1, 2, 3 as if they were this much worse. */
const RANK_GAP = [0, 3, 8];

export interface TopArrowMove {
  uci: string;
  gap?: number | undefined;
  winLoss?: number | undefined;
  /** (Brilliant lines) A sound sacrifice: drawn in the Brilliant colour. */
  brilliant?: unknown;
}

/** 1 for the best move, falling towards 0 as the move is worse than it. */
export function topStrength(gap: number): number {
  return Math.exp(-Math.max(0, gap) / FADE_GAP);
}

function step(strength: number): number {
  return Math.round(strength * (STEPS - 1));
}

/** The brushes for ChessBoard (top0 = faintest … top9 = the best move; bril0 … bril9 the same for brilliant moves). */
export function topBrushes(): Record<string, DrawBrush> {
  const out: Record<string, DrawBrush> = {};
  for (let i = 0; i < STEPS; i++) {
    const opacity = MIN_OPACITY + ((MAX_OPACITY - MIN_OPACITY) * i) / (STEPS - 1);
    out[`top${i}`] = { key: `cc-top${i}`, color: TOP_GOLD, opacity: Math.round(opacity * 100) / 100, lineWidth: 6 };
    out[`bril${i}`] = { key: `cc-bril${i}`, color: TOP_BRILLIANT, opacity: Math.round(opacity * 100) / 100, lineWidth: 6 };
  }
  return out;
}

/** Mix two #rrggbb colours (t = 0: a, 1: b). */
function mix(a: string, b: string, t: number): string {
  const ch = (c: string, i: number) => parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** How bright move `i` (0 = best) is drawn: from its win-chance loss, or (unscored) its rank. */
function strengthAt(m: TopArrowMove, i: number): number {
  const s = topStrength(m.gap ?? m.winLoss ?? RANK_GAP[i] ?? 15);
  return m.brilliant ? Math.max(BRILLIANT_MIN_STRENGTH, s) : s;
}

/** The colour of move `i`'s rank label: grey for a faint move, gold for a good one (also the list next to the board). */
export function topLabelFill(m: TopArrowMove, i: number): string {
  if (m.brilliant) return TOP_BRILLIANT;
  return mix(FAINT_GREY, TOP_GOLD, Math.min(1, strengthAt(m, i) * 1.4));
}

/** Chessground shapes for the top moves (best first in, best drawn last). */
export function topArrowShapes(moves: readonly TopArrowMove[]): DrawShape[] {
  const labelled = moves.length > 1;
  return moves
    .map((m, i): DrawShape => {
      const s = strengthAt(m, i);
      const shape: DrawShape = {
        orig: m.uci.slice(0, 2) as Key,
        dest: m.uci.slice(2, 4) as Key,
        brush: `${m.brilliant ? 'bril' : 'top'}${step(s)}`,
        modifiers: { lineWidth: Math.round(MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * s) },
      };
      if (labelled) shape.label = { text: String(i + 1), fill: topLabelFill(m, i) };
      return shape;
    })
    .reverse();
}
