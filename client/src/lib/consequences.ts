// What a move does, drawn on the board (layout A): squares tinted and tagged ("hanging", "forked", "pinned" …) and
// thin arrows (who attacks what), from the move's Immediate facts and the material rule.
// Tones are for YOU (the reviewed player: session.state.you — the chess.com user's side, else the side at the bottom
// of the board), whoever made the move: green = good for you, red = bad for you, blue = neutral (a defensive answer
// such as "defended" / "safe now": it parries something, it isn't a threat for either side). So the opponent forking
// your rook is red, your fork is green. (The ✓ / ✗ sentences next to the board stay for the mover: they grade the
// move, like its label — see tones.ts.)
import type { Color, Fact, MoveAnalysis, PieceRef, Score } from '@chess-coach/shared';
import { makeSquare, parseSquare } from 'chessops/util';
import { isCheckmate, playSan, tryPosition, uciSquares } from './chess';

export type MarkTone = 'good' | 'bad' | 'neutral';
/** What a tag says, for its icon (TagIcon.vue). */
export type MarkKind =
  | 'hanging'
  | 'danger'
  | 'forked'
  | 'attacked'
  | 'undefended'
  | 'pinned'
  | 'skewered'
  | 'trapped'
  | 'defended'
  | 'safe'
  | 'mate'
  | 'missed-mate'
  | 'checkmate';
export interface SquareMark {
  square: string;
  tone: MarkTone;
  kind: MarkKind;
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

const other = (c: Color): Color => (c === 'white' ? 'black' : 'white');

/** Tone for `you` of something that favours `side` (null = neither: a neutral, defensive mark). */
export function toneFor(side: Color | null, you: Color): MarkTone {
  return side === null ? 'neutral' : side === you ? 'good' : 'bad';
}

/** Squares of `by`'s pieces that attack `square` in `fen`. */
export function attackersOf(fen: string, square: string, by: Color): string[] {
  const pos = tryPosition(fen);
  const sq = parseSquare(square);
  if (!pos || sq === undefined) return [];
  const out: string[] = [];
  for (const s of pos.kingAttackers(sq, by, pos.board.occupied)) out.push(makeSquare(s));
  return out;
}

/** The move's consequences, toned for `you` (the reviewed player). */
export function moveConsequences(a: MoveAnalysis, you: Color): Consequences {
  const mover = a.color;
  const opp = other(mover);
  const fen = a.fenAfter;
  const marks: SquareMark[] = [];
  const arrows: MarkArrow[] = [];
  // every mark / arrow is recorded with the side it favours (null: neither) and toned for `you`
  const mark = (p: PieceRef | string, favours: Color | null, kind: MarkKind, tag: string) => {
    const square = typeof p === 'string' ? p : p.square;
    if (!marks.some((m) => m.square === square)) marks.push({ square, tone: toneFor(favours, you), kind, tag });
  };
  const arrow = (from: string, to: string, favours: Color | null) => {
    if (from !== to && !arrows.some((x) => x.from === from && x.to === to)) arrows.push({ from, to, tone: toneFor(favours, you) });
  };
  const hanging = (p: PieceRef) => {
    const taker = other(p.color);
    mark(p, taker, 'hanging', 'hanging');
    for (const s of attackersOf(fen, p.square, taker).slice(0, 2)) arrow(s, p.square, taker);
  };

  // a forced mate on the board, from the engine score (so it shows on every move of a mating line, not only on the
  // move that allows it): the king that gets mated is tagged, in favour of the side that mates
  const mateAfter = mateOf(a.evalAfter);
  const mateBefore = mateOf(a.evalBefore);
  if (mateAfter) {
    const king = kingSquare(fen, mateAfter.mated);
    if (king) mark(king, other(mateAfter.mated), 'mate', `mate in ${mateAfter.moves}`);
  } else if (mateBefore && mateBefore.mated === opp && !isCheckmate(fen)) {
    // the mover had a forced mate and the move let it go (good news for the side that was getting mated)
    const king = kingSquare(fen, opp);
    if (king) mark(king, opp, 'missed-mate', `missed mate in ${mateBefore.moves}`);
  }

  const facts: Fact[] = a.played.explanation?.immediate.facts ?? [];
  // the worst news for the mover first: what the move loses
  for (const f of facts) {
    if (f.type === 'hangs') hanging(f.piece);
    else if (f.type === 'allows-mate') {
      const king = kingSquare(fen, mover);
      if (king) mark(king, opp, 'mate', `mate in ${f.inMoves}`);
      const first = f.line?.[0] && playSan(fen, f.line[0]);
      const sq = first ? uciSquares(first.uci) : null;
      if (sq) arrow(sq[0], sq[1], opp);
    } else if (f.type === 'allows') {
      const sq = uciSquares(f.reply.uci);
      if (sq) arrow(sq[0], sq[1], opp);
      const fork = f.facts.find((x): x is Extract<Fact, { type: 'fork' }> => x.type === 'fork');
      for (const t of f.targets ?? fork?.targets.filter((x) => x.color === mover) ?? []) mark(t, opp, fork ? 'forked' : 'danger', fork ? 'forked' : 'in danger');
    }
  }
  const hung = a.labelReason.material?.hung;
  if (hung && hung.color === mover) hanging(hung);

  for (const f of facts) {
    switch (f.type) {
      case 'checkmate': {
        const king = kingSquare(fen, opp);
        if (king) mark(king, mover, 'checkmate', 'checkmate');
        break;
      }
      case 'fork':
        for (const t of f.targets) {
          arrow(f.attacker.square, t.square, f.attacker.color);
          if (t.role !== 'king') mark(t, f.attacker.color, 'forked', 'forked');
        }
        break;
      case 'attack':
        if (f.reason === 'king') break;
        arrow(f.attacker.square, f.target.square, f.attacker.color);
        if (f.reason === 'undefended') mark(f.target, f.attacker.color, 'undefended', 'undefended');
        else mark(f.target, f.attacker.color, 'attacked', 'attacked');
        break;
      case 'discovered-attack':
        arrow(f.attacker.square, f.target.square, f.attacker.color);
        if (f.target.role !== 'king') mark(f.target, f.attacker.color, 'attacked', 'attacked');
        break;
      case 'pin':
        arrow(f.pinner.square, f.behind.square, f.pinner.color);
        mark(f.pinned, f.pinner.color, 'pinned', 'pinned');
        break;
      case 'attack-pinned':
        arrow(f.attacker.square, f.pinned.square, f.attacker.color);
        mark(f.pinned, f.attacker.color, 'pinned', 'pinned');
        break;
      case 'skewer':
        arrow(f.attacker.square, f.behind.square, f.attacker.color);
        mark(f.front, f.attacker.color, 'skewered', 'skewered');
        break;
      case 'trapped':
        arrow(f.attacker.square, f.piece.square, f.attacker.color);
        mark(f.piece, f.attacker.color, 'trapped', 'trapped');
        break;
      // defensive answers: neutral (blue) for both sides — they parry something rather than threaten anything
      case 'defend':
        arrow(f.defender.square, f.piece.square, null);
        mark(f.piece, null, 'defended', 'defended');
        break;
      case 'escape':
        mark(f.piece, null, 'safe', 'safe now');
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
