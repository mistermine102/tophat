// Label presentation: glyph, name, colour and severity. Own scheme (no chess.com assets).
import type { Label } from '@chess-coach/shared';

export interface LabelMeta {
  name: string;
  glyph: string;
  /** Foreground/accent colour (hex), readable on Tophat's cream paper. */
  color: string;
  /** Higher = worse. SPEC "Severity order". */
  severity: number;
  /** One-line generic description used when there is no more specific reason. */
  blurb: string;
  /** How the label is decided, for the legend (SPEC.md thresholds). */
  rule: string;
}

export const LABELS: Record<Label, LabelMeta> = {
  book: { name: 'Book', glyph: '≡', color: '#a07a45', severity: 0, blurb: 'A known opening move.', rule: 'Still in opening theory (Lichess opening book).' },
  forced: { name: 'Forced', glyph: '□', color: '#7c8691', severity: 0, blurb: 'The only legal move.', rule: 'The only legal move.' },
  great: { name: 'Great', glyph: '!', color: '#1f7fb3', severity: 0, blurb: 'The only good move here.', rule: 'The best move, and the only good one: the 2nd-best move would have been a mistake.' },
  best: { name: 'Best', glyph: '★', color: '#2f8a4c', severity: 0, blurb: 'The best move.', rule: 'The top move — only that one.' },
  excellent: { name: 'Excellent', glyph: '✓', color: '#4fa36a', severity: 1, blurb: 'Almost as good as the best move.', rule: 'Loses at most 2% win chance compared with the best move.' },
  good: { name: 'Good', glyph: '✓', color: '#8aa167', severity: 2, blurb: 'A solid move, a little worse than the best.', rule: 'Loses at most 5% win chance.' },
  inaccuracy: { name: 'Inaccuracy', glyph: '?!', color: '#d9a514', severity: 3, blurb: 'A better move was available.', rule: 'Loses 5–10% win chance.' },
  mistake: { name: 'Mistake', glyph: '?', color: '#db7420', severity: 4, blurb: 'This gave away a good part of your chances.', rule: 'Loses 10–20% win chance, or gives away 2+ pawns of material for nothing.' },
  miss: { name: 'Miss', glyph: '✕', color: '#a94fb3', severity: 5, blurb: 'Missed the chance to punish the previous move.', rule: 'The opponent just made a mistake and this move let the chance to punish it slip — or a forced mate in 3 or less was missed.' },
  blunder: { name: 'Blunder', glyph: '??', color: '#c8323f', severity: 6, blurb: 'A serious error.', rule: 'Loses more than 20% win chance, hangs 3+ pawns of material for nothing, or allows a forced mate in 3 or less that the best move avoids.' },
};

/** Display order for summaries (good → bad). */
export const LABEL_ORDER: Label[] = [
  'book', 'forced', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder',
];

/** Labels that get a mark on the eval graph. */
export const GRAPH_MARKED: ReadonlySet<Label> = new Set<Label>(['inaccuracy', 'mistake', 'miss', 'blunder', 'great']);

/** Labels for which the move is confirmed rather than corrected. */
export const CONFIRMED: ReadonlySet<Label> = new Set<Label>(['best', 'great', 'book', 'forced']);
