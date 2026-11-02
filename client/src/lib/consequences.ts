// What a move does, drawn on the board (layout A): squares tinted and tagged ("hanging", "forked", "pinned" …) and
// thin arrows (who attacks what), from the move's Immediate facts and the material rule. Tones are for the MOVER,
// like the ✓ / ✗ sentences: green = good for the side that moved, red = bad for it.
import type { Color, Fact, MoveAnalysis, PieceRef, Score } from '@chess-coach/shared';
import { makeSquare, parseSquare } from 'chessops/util';
import { isCheckmate, playSan, tryPosition, uciSquares } from './chess';

export type MarkTone = 'good' | 'bad';
export interface SquareMark {
  square: string;
  tone: MarkTone;
  /** Short word shown on the square ("hanging"). */
  tag: string;
}
export interface MarkArrow {
  from: string;
  to: string;
  tone: MarkTone;
}
export interface Consequences {
  marks: SquareMark[];
  arrows: MarkArrow[];
}

const MAX_MARKS = 5;
const MAX_ARROWS = 5;

/** Squares of `by`'s pieces that attack `square` in `fen`. */
export function attackersOf(fen: string, square: string, by: Color): string[] {
  const pos = tryPosition(fen);
  const sq = parseSquare(square);
  if (!pos || sq === undefined) return [];
  const out: string[] = [];
  for (const s of pos.kingAttackers(sq, by, pos.board.occupied)) out.push(makeSquare(s));
  return out;
}

export function moveConsequences(a: MoveAnalysis): Consequences {
  const mover = a.color;
  const opp: Color = mover === 'white' ? 'black' : 'white';
  const fen = a.fenAfter;
  const marks: SquareMark[] = [];
  const arrows: MarkArrow[] = [];
  /** Tone for the mover of something done by `side`'s piece. */
  const by = (side: Color): MarkTone => (side === mover ? 'good' : 'bad');
  const mark = (p: PieceRef | string, tone: MarkTone, tag: string) => {
    const square = typeof p === 'string' ? p : p.square;
    if (!marks.some((m) => m.square === square)) marks.push({ square, tone, tag });
  };
  const arrow = (from: string, to: string, tone: MarkTone) => {
    if (from !== to && !arrows.some((x) => x.from === from && x.to === to)) arrows.push({ from, to, tone });
  };
  const hanging = (p: PieceRef) => {
    mark(p, 'bad', 'hanging');
    for (const s of attackersOf(fen, p.square, p.color === 'white' ? 'black' : 'white').slice(0, 2)) arrow(s, p.square, by(p.color === 'white' ? 'black' : 'white'));
  };

  // a forced mate on the board, from the engine score (so it shows on every move of a mating line, not only on the
  // move that allows it): the king that gets mated is tagged, green if the mover is the one mating
  const mateAfter = mateOf(a.evalAfter);
  const mateBefore = mateOf(a.evalBefore);
  if (mateAfter) {
    const king = kingSquare(fen, mateAfter.mated);
    if (king) mark(king, mateAfter.mated === mover ? 'bad' : 'good', `mate in ${mateAfter.moves}`);
  } else if (mateBefore && mateBefore.mated === opp && !isCheckmate(fen)) {
    // the mover had a forced mate and the move let it go
    const king = kingSquare(fen, opp);
    if (king) mark(king, 'bad', `missed mate in ${mateBefore.moves}`);
  }

  const facts: Fact[] = a.played.explanation?.immediate.facts ?? [];
  // the worst news first: what the move loses
  for (const f of facts) {
    if (f.type === 'hangs') hanging(f.piece);
    else if (f.type === 'allows-mate') {
      const king = kingSquare(fen, mover);
      if (king) mark(king, 'bad', `mate in ${f.inMoves}`);
      const first = f.line?.[0] && playSan(fen, f.line[0]);
      const sq = first ? uciSquares(first.uci) : null;
      if (sq) arrow(sq[0], sq[1], 'bad');
    } else if (f.type === 'allows') {
      const sq = uciSquares(f.reply.uci);
      if (sq) arrow(sq[0], sq[1], 'bad');
      const fork = f.facts.find((x): x is Extract<Fact, { type: 'fork' }> => x.type === 'fork');
      for (const t of f.targets ?? fork?.targets.filter((x) => x.color === mover) ?? []) mark(t, 'bad', fork ? 'forked' : 'in danger');
    }
  }
  const hung = a.labelReason.material?.hung;
  if (hung && hung.color === mover) hanging(hung);

  for (const f of facts) {
    switch (f.type) {
      case 'checkmate': {
        const king = kingSquare(fen, opp);
        if (king) mark(king, 'good', 'checkmate');
        break;
      }
      case 'fork':
        for (const t of f.targets) {
          arrow(f.attacker.square, t.square, by(f.attacker.color));
          if (t.role !== 'king') mark(t, by(f.attacker.color), 'forked');
        }
        break;
      case 'attack':
        if (f.reason === 'king') break;
        arrow(f.attacker.square, f.target.square, by(f.attacker.color));
        mark(f.target, by(f.attacker.color), f.reason === 'undefended' ? 'undefended' : 'attacked');
        break;
      case 'discovered-attack':
        arrow(f.attacker.square, f.target.square, by(f.attacker.color));
        if (f.target.role !== 'king') mark(f.target, by(f.attacker.color), 'attacked');
        break;
      case 'pin':
        arrow(f.pinner.square, f.behind.square, by(f.pinner.color));
        mark(f.pinned, by(f.pinner.color), 'pinned');
        break;
      case 'attack-pinned':
        arrow(f.attacker.square, f.pinned.square, by(f.attacker.color));
        mark(f.pinned, by(f.attacker.color), 'pinned');
        break;
      case 'skewer':
        arrow(f.attacker.square, f.behind.square, by(f.attacker.color));
        mark(f.front, by(f.attacker.color), 'skewered');
        break;
      case 'trapped':
        arrow(f.attacker.square, f.piece.square, by(f.attacker.color));
        mark(f.piece, by(f.attacker.color), 'trapped');
        break;
      case 'defend':
        arrow(f.defender.square, f.piece.square, by(f.defender.color));
        mark(f.piece, by(f.defender.color), 'defended');
        break;
      case 'escape':
        mark(f.piece, by(f.piece.color), 'safe now');
        break;
      default:
        break;
    }
  }
  return { marks: marks.slice(0, MAX_MARKS), arrows: arrows.slice(0, MAX_ARROWS) };
}

/** A forced mate (not yet on the board) in a White-POV score: who gets mated and in how many moves. */
function mateOf(s: Score | undefined): { mated: Color; moves: number } | null {
  if (s?.mate === undefined || s.mate === 0) return null;
  return { mated: s.mate > 0 ? 'black' : 'white', moves: Math.abs(s.mate) };
}

function kingSquare(fen: string, color: Color): string | null {
  const pos = tryPosition(fen);
  const k = pos?.board.kingOf(color);
  return k === undefined ? null : makeSquare(k);
}
