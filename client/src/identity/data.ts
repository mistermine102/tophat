// Static content for the identity prototypes: the position after 12. Qd2?? from the lichess sample game
// (the same moment as the proto-a screenshots), so every direction is compared on the same screen.
import type { Label } from '@chess-coach/shared';

export const FEN = 'r3k2r/ppp2ppp/2p1b3/3nP3/1q1P4/2N5/PPPQ1PPP/R3KB1R b KQkq - 1 12';
export const LAST_MOVE: [string, string] = ['d1', 'd2'];

export const PLAYERS = {
  white: { name: 'Khaled651', elo: '1554', taken: '♝♞♟', you: true, plus: 1 },
  black: { name: 'Koenjado', elo: '1531', taken: '♗♘', you: false, plus: 0 },
  result: '0-1',
};

export const ACCURACY = { you: 47.8, opp: 49.3 };

export type MoveCell = { san: string; label: Label; current?: boolean };
export const MOVES: [MoveCell, MoveCell][] = [
  [{ san: 'e4', label: 'book' }, { san: 'e5', label: 'book' }],
  [{ san: 'Nf3', label: 'book' }, { san: 'Nf6', label: 'book' }],
  [{ san: 'Nxe5', label: 'book' }, { san: 'Nc6', label: 'book' }],
  [{ san: 'Nxc6', label: 'book' }, { san: 'dxc6', label: 'book' }],
  [{ san: 'd3', label: 'book' }, { san: 'Bc5', label: 'book' }],
  [{ san: 'Bg5', label: 'blunder' }, { san: 'Qd4', label: 'blunder' }],
  [{ san: 'Be3', label: 'excellent' }, { san: 'Qd6', label: 'blunder' }],
  [{ san: 'Bxc5', label: 'miss' }, { san: 'Qxc5', label: 'best' }],
  [{ san: 'Nc3', label: 'excellent' }, { san: 'Be6', label: 'best' }],
  [{ san: 'd4', label: 'good' }, { san: 'Qb4', label: 'good' }],
  [{ san: 'e5', label: 'blunder' }, { san: 'Nd5', label: 'blunder' }],
  [{ san: 'Qd2', label: 'blunder', current: true }, { san: 'O-O-O', label: 'blunder' }],
  [{ san: 'Bd3', label: 'blunder' }, { san: 'Qxb2', label: 'best' }],
  [{ san: 'O-O', label: 'good' }, { san: 'Nxc3', label: 'best' }],
  [{ san: 'Qg5', label: 'excellent' }, { san: 'Nd5', label: 'excellent' }],
  [{ san: 'Rfb1', label: 'good' }, { san: 'Qxd4', label: 'good' }],
];

export const VERDICT = {
  move: '12. Qd2',
  label: 'blunder' as Label,
  name: 'Blunder',
  sentence: 'allows Qxb2, forking your rook on a1 and knight on c3.',
  evalBefore: '+1.5',
  evalAfter: '−6.3',
  points: [
    { tone: 'bad' as const, text: 'In the engine line you lose a knight (−3 points); you were a pawn up, now Black is 2 up.' },
    { tone: 'good' as const, text: 'Defends the knight on c3, which was under attack.' },
  ],
  better: { san: 'a3', text: 'Attacks the queen on b4 — it has to step away first.' },
};

/** Label glyphs (lib/labels.ts); colours come from the direction's CSS (--l-<label>). */
export const GLYPH: Record<Label, string> = {
  book: '≡',
  forced: '□',
  great: '!',
  best: '★',
  excellent: '✓',
  good: '✓',
  inaccuracy: '?!',
  mistake: '?',
  miss: '✕',
  blunder: '??',
};

/** Mistake counts in the summary, per side. */
export const COUNTS: { label: Label; you: number; opp: number }[] = [
  { label: 'great', you: 2, opp: 1 },
  { label: 'inaccuracy', you: 1, opp: 1 },
  { label: 'mistake', you: 0, opp: 2 },
  { label: 'miss', you: 1, opp: 0 },
  { label: 'blunder', you: 9, opp: 10 },
];

/** Eval curve (White's view, pawns, clamped to ±8) for the graph under the board. */
export const EVAL_CURVE = [
  0.3, 0.3, 0.2, 0.4, 0.3, 0.3, 0.2, 0.4, 0.3, 0.3, -2.4, 1.8, 1.7, 5.2, 5.0, 1.2, 1.3, 1.1, 1.4, 1.3, 1.6, -0.4, 1.5,
  -6.3, -1.2, -4.8, -3.5, -3.6, -3.7, -2.9, -3.1, -3.0, -3.9, 2.4, 3.1, 3.4, 4.2, 4.0, 4.4, 3.8, 4.1, 3.9, 4.6, -0.6, -1.4,
  -2.2, -2.0, -3.8, -4.5, -5.6, -7.2, -8, -8, -8, -8,
];
export const CURRENT_PLY = 23;
/** Plies with a mark on the graph, and their labels. */
export const GRAPH_MARKS: { ply: number; label: Label }[] = [
  { ply: 10, label: 'blunder' },
  { ply: 11, label: 'blunder' },
  { ply: 13, label: 'blunder' },
  { ply: 14, label: 'miss' },
  { ply: 20, label: 'blunder' },
  { ply: 21, label: 'blunder' },
  { ply: 22, label: 'blunder' },
  { ply: 23, label: 'blunder' },
  { ply: 24, label: 'blunder' },
  { ply: 33, label: 'great' },
  { ply: 34, label: 'blunder' },
  { ply: 43, label: 'inaccuracy' },
  { ply: 44, label: 'blunder' },
  { ply: 46, label: 'mistake' },
];
