// (Points) What each of the engine's good moves in a position does, as short points ("Develops the knight", "Opens the
// diagonal for the bishop on c1"), and how the moves relate. A coach doesn't explain every good move from scratch: a
// move with the same idea as a better one is told only by how it differs ("same idea as Nc3 · doesn't block the
// c-pawn · doesn't attack the pawn on e5"), so the list doesn't repeat itself.
//
// Every point is checked: a board fact of facts/immediate.ts confirmed by the move's engine line the way analyzeMove
// does it (verifyWithLine, pruneRefuted, the threat rules), the material result of that line, or one of the small
// board rules below. `topIdeas` runs the null-move searches (the move's own threat, the opponent's threat it stops,
// prophylaxis); `movePoints` and `compareIdeas` are pure.
//
// Board rules (mover = the side playing the move):
// - centre: a pawn steps (not captures) onto d4/e4/d5/e5 without losing material there (SEE).
// - challenge: a pawn step makes the pawn attack an enemy pawn.
// - opens a bishop: a mover bishop sees >= LINE_SQUARES more squares (not counting its own pieces) and the moved piece
//   stood in its way. blocks a bishop: the moved piece now stands in the way and the bishop sees >= LINE_SQUARES fewer.
// - blocks a pawn: a piece lands right in front of the unmoved d- or e-pawn, or the c-pawn when the d-pawn is on d4/d5.
// - prepares castling: castling (either side) isn't legal now and would be legal if the mover were to move again.
// - prepares the next move: the mover's next move in the engine line (another piece, not onto the vacated square) was
//   illegal or lost material by SEE before the move and is legal and safe after it (as if the mover moved again).
// - activity: the moved knight/bishop/rook/queen (no capture, not developing, not castling) reaches >= ACTIVITY_GAIN
//   more safe squares (not attacked by enemy pawns), >= ACTIVITY_MIN in all; a knight or bishop that enters the
//   centre box (c3–f6) is "centralised".
// - rook on an open (no pawns) / half-open (no own pawns) file it wasn't on; rooks connected on the back rank.
// - passed pawns: pushes one, or creates one; doubles / isolates enemy pawns or takes away the bishop pair (and the
//   same against the mover, as bad points).

import { SquareSet, opposite, pawnAttacks, parseUci, type Board, type Chess, type Color, type NormalMove, type Position, type Square } from 'chessops';
import { makeSquare } from 'chessops/util';
import type { AnalysisSettings, Fact, MoveIdea, MovePoint, PieceRole, Score, Tone } from '@chess-coach/shared';
import { attacksFrom, between, withTurn } from '../chess/attacks';
import { PIECE_VALUES, positionFromFen } from '../chess/material';
import { legalMove, legalPrefix, playMove, pvToSan } from '../chess/notation';
import { seeMove } from '../chess/see';
import type { PvLine, SearchResult } from '../engine/uci';
import { castlingSides, immediateFacts } from '../facts/immediate';
import { type ThreatFact, narrateLine, nullMoveFen, preventsFact, threatFromSearch, threatStillWorks } from '../facts/line';
import { positionalFeatures } from '../facts/positional';
import { addLineFork, laterMaterial, opponentPlays, pruneRefuted, replyTakesMovedPiece, stillEnPrise, targetHitsBack, threatExistedBefore, verifyWithLine } from './analyzeMove';
import { sameMoveUci } from './classify';
import { colorName, joinList, piecesPhrase } from './explain';
import type { SearchParams } from './searchCache';

/** Points told per move (most important first); the comparison looks at all of them. */
export const MAX_POINTS = 3;
/** Differences told (each way) for a move with the same idea as a better one. */
export const MAX_DIFF = 2;
/** A better move's good point counts as missing from a move with the same idea only from this weight on. */
export const MISSING_MIN_WEIGHT = 14;
/** A bishop is opened / blocked when it gains / loses at least this many squares. */
export const LINE_SQUARES = 2;
/** The moved piece is "more active" with at least this many more safe squares … */
export const ACTIVITY_GAIN = 3;
/** … and at least this many in all. */
export const ACTIVITY_MIN = 5;
/** The mover's next moves in the engine line told as the plan of a move with at most one point. */
export const PLAN_MOVES = 2;

type DefendsFact = Extract<Fact, { type: 'defends-threat' }>;
type PreventsFact = Extract<Fact, { type: 'prevents' }>;

/** A point while it's being built: verb (base form) + rest, so it can be said ("Develops …") or denied ("Doesn't develop …"). */
export interface Point {
  key: string;
  verb: string;
  rest: string;
  tone: Tone;
  weight: number;
  squares?: string[];
}

/** One move to explain (pv: UCI from the move; score: mover POV; winLoss: win% given up against the best move). */
export interface MoveInput {
  uci: string;
  pv: readonly string[];
  score: Score;
  winLoss: number;
  /**
   * What the moves compared with this one typically do to the material (pawns, the median of their lines'
   * results, `narratedDelta`): the line's material is told only when it differs from this by a pawn or more (a piece
   * that is lost whatever the mover does is not this move's sacrifice). Default 0.
   */
  baseline?: number;
  /** The same for the material further down the lines (`laterMaterial`): a claim must still hold there. Default 0. */
  laterBaseline?: number;
  /** The opponent's previous move, if known: a capture on its square is taking back, not winning a piece. */
  prev?: { fenBefore: string; uci: string } | null;
}

/** The engine-searched facts of a move (from `topIdeas`): its own threat, the opponent's threat it stops, prophylaxis. */
export interface MoveExtras {
  threat?: ThreatFact | null;
  defends?: DefendsFact | null;
  prevents?: PreventsFact | null;
}

export interface MovePoints {
  uci: string;
  san: string;
  /** The kind of piece moved: 'pawn', 'minor' (knight / bishop), 'rook', 'queen', 'king'. */
  kind: string;
  points: Point[];
  plan: string[];
}

// --- wording -------------------------------------------------------------------------------------------------------

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const moveName = (san: string, color: Color): string => (color === 'black' ? `…${san}` : san);
const an = (word: string): string => (/^[aeiou]/.test(word) ? `an ${word}` : `a ${word}`);

/** "attack" → "attacks", "push" → "pushes", "occupy" → "occupies", "take back" → "takes back". */
export function thirdPerson(verb: string): string {
  const [head = '', ...tail] = verb.split(' ');
  const h = /(s|sh|ch|x|z|o)$/.test(head) ? `${head}es` : /[^aeiou]y$/.test(head) ? `${head.slice(0, -1)}ies` : `${head}s`;
  return [h, ...tail].join(' ');
}

/** The point as said ("Develops the knight"). */
export function said(p: Point): MovePoint {
  const out: MovePoint = { key: p.key, text: [capitalize(thirdPerson(p.verb)), p.rest].filter(Boolean).join(' '), tone: p.tone };
  if (p.squares?.length) out.squares = p.squares;
  return out;
}

/** The point denied, for a move that lacks it ("Doesn't develop the knight"): lacking a good point is bad, and the other way round. */
export function denied(p: Point): MovePoint {
  const tone: Tone = p.tone === 'good' ? 'bad' : p.tone === 'bad' ? 'good' : 'neutral';
  const out: MovePoint = { key: p.key, text: ["Doesn't", p.verb, p.rest].filter(Boolean).join(' '), tone };
  if (p.squares?.length) out.squares = p.squares;
  return out;
}

/** "the king and rook", "both rooks" */
function rolesPhrase(roles: readonly PieceRole[]): string {
  if (roles.length === 2 && roles[0] === roles[1]) return `both ${roles[0]}s`;
  return `the ${joinList(roles)}`;
}

// --- facts → points ------------------------------------------------------------------------------------------------

interface PointContext {
  mover: Color;
  /** The move is within Good range of the best: material it gives up is an offer, not a loss. */
  good: boolean;
  movedRole: PieceRole;
}

function threatRest(f: ThreatFact, mover: Color): string {
  const name = moveName(f.san, mover);
  if (f.mateIn !== undefined && f.mateIn > 0) return f.mateIn === 1 ? `mate with ${name}` : `mate, starting with ${name}`;
  const fork = f.facts.find((x): x is Extract<Fact, { type: 'fork' }> => x.type === 'fork');
  if (fork) return `${name}, forking ${rolesPhrase(fork.targets.map((t) => t.role))}`;
  const cap = f.facts.find((x): x is Extract<Fact, { type: 'capture' }> => x.type === 'capture');
  if (cap && f.gain >= PIECE_VALUES[cap.captured.role]) return `${name}, winning the ${cap.captured.role}`;
  return `${name}, winning material`;
}

/** One immediate / engine-searched fact as a point (null = not a point of its own). */
export function factPoint(f: Fact, c: PointContext): Point | null {
  const opp = opposite(c.mover);
  switch (f.type) {
    case 'checkmate':
      return { key: 'mate', verb: 'give', rest: 'checkmate', tone: 'good', weight: 100 };
    case 'stalemate':
      return { key: 'stalemate', verb: 'stalemate', rest: `${colorName(opp)}: the game is a draw`, tone: 'neutral', weight: 90 };
    case 'check':
      return f.double || f.discovered
        ? { key: 'check', verb: 'give', rest: f.double ? 'double check' : 'a discovered check', tone: 'good', weight: 30 }
        : { key: 'check', verb: 'give', rest: 'check', tone: 'good', weight: 12 };
    case 'capture': {
      const { role, square } = f.captured;
      switch (f.outcome) {
        case 'wins-material':
          return { key: `win:${square}`, verb: 'win', rest: `the ${role} on ${square}`, tone: 'good', weight: 50 + 3 * PIECE_VALUES[role], squares: [square] };
        case 'even-trade':
          return role === c.movedRole
            ? { key: `trade:${role}`, verb: 'trade', rest: `${role}s`, tone: 'neutral', weight: 20, squares: [square] }
            : { key: `trade:${role}`, verb: 'trade', rest: `off the ${role} on ${square}`, tone: 'neutral', weight: 20, squares: [square] };
        case 'recapture':
          return { key: 'recapture', verb: 'take', rest: `back the ${role}`, tone: 'good', weight: 45, squares: [square] };
        case 'loses-material':
          if (f.desperado) return { key: 'desperado', verb: 'take', rest: `the ${role} before the ${c.movedRole} is lost`, tone: 'neutral', weight: 30, squares: [square] };
          return { key: 'sacrifice', verb: 'give', rest: `up the ${c.movedRole} for the ${role}`, tone: c.good ? 'neutral' : 'bad', weight: 30, squares: [square] };
      }
      return null;
    }
    case 'promotion':
      return { key: 'promote', verb: 'promote', rest: `to ${an(f.to)}`, tone: 'good', weight: 70 };
    case 'castle':
      return { key: 'castle', verb: 'castle', rest: f.side === 'king' ? 'kingside' : 'queenside', tone: 'good', weight: 30 };
    case 'castling-lost':
      return f.color === c.mover ? { key: 'no-castle', verb: 'give', rest: 'up castling', tone: 'bad', weight: 14 } : null;
    case 'develop':
      return { key: 'develop', verb: 'develop', rest: `the ${f.piece.role}`, tone: 'good', weight: 22, squares: [f.piece.square] };
    case 'attack':
      if (f.through) return { key: `attack:${f.target.square}`, verb: 'line', rest: `up on the ${f.target.role} on ${f.target.square}`, tone: 'good', weight: 30 + PIECE_VALUES[f.target.role], squares: [f.target.square] };
      return { key: `attack:${f.target.square}`, verb: 'attack', rest: `the ${f.target.role} on ${f.target.square}`, tone: 'good', weight: 24 + PIECE_VALUES[f.target.role], squares: [f.target.square] };
    case 'fork':
      return { key: 'fork', verb: 'fork', rest: rolesPhrase(f.targets.map((t) => t.role)), tone: 'good', weight: 60 + f.targets.length, squares: f.targets.map((t) => t.square) };
    case 'pin':
      return { key: `pin:${f.pinned.square}`, verb: 'pin', rest: `the ${f.pinned.role} to the ${f.absolute ? 'king' : f.behind.role}`, tone: 'good', weight: 35 + PIECE_VALUES[f.pinned.role], squares: [f.pinned.square] };
    case 'skewer':
      return { key: 'skewer', verb: 'skewer', rest: `the ${f.front.role} and the ${f.behind.role}`, tone: 'good', weight: 45, squares: [f.front.square, f.behind.square] };
    case 'discovered-attack':
      return { key: `attack:${f.target.square}`, verb: 'uncover', rest: `an attack on the ${f.target.role}`, tone: 'good', weight: 40 + PIECE_VALUES[f.target.role], squares: [f.target.square] };
    case 'trapped':
      return { key: `trap:${f.piece.square}`, verb: 'trap', rest: `the ${f.piece.role} on ${f.piece.square}`, tone: 'good', weight: 55 + PIECE_VALUES[f.piece.role], squares: [f.piece.square] };
    case 'attack-pinned':
      return { key: `attack:${f.pinned.square}`, verb: 'pile', rest: `up on the pinned ${f.pinned.role}`, tone: 'good', weight: 45, squares: [f.pinned.square] };
    case 'escape':
      return { key: `escape:${f.from}`, verb: 'move', rest: `the ${f.piece.role} to safety`, tone: 'good', weight: 35 + PIECE_VALUES[f.piece.role] };
    case 'defend':
      return { key: `defend:${f.piece.square}`, verb: 'defend', rest: `the ${f.piece.role} on ${f.piece.square}`, tone: 'good', weight: 30 + PIECE_VALUES[f.piece.role], squares: [f.piece.square] };
    case 'block-check':
      return { key: 'answer-check', verb: 'block', rest: 'the check', tone: 'neutral', weight: 10 };
    case 'escape-check':
      return { key: 'answer-check', verb: 'step', rest: 'out of check', tone: 'neutral', weight: 10 };
    case 'hangs':
      // (verified: the engine line takes it) a good move gives it up on purpose; a weak one just loses it. A piece
      // that was already en prise is the position's problem, not this move's.
      if (f.already) return null;
      return c.good
        ? { key: `offer:${f.piece.square}`, verb: 'offer', rest: `the ${f.piece.role} on ${f.piece.square}`, tone: 'neutral', weight: 20, squares: [f.piece.square] }
        : { key: `hangs:${f.piece.square}`, verb: 'leave', rest: `the ${f.piece.role} on ${f.piece.square} hanging`, tone: 'bad', weight: 60, squares: [f.piece.square] };
    case 'allows-mate':
      return { key: 'allows-mate', verb: 'allow', rest: f.inMoves === 1 ? 'mate in one' : `mate in ${f.inMoves}`, tone: 'bad', weight: 95 };
    case 'threat':
      return { key: `threat:${f.move}`, verb: 'threaten', rest: threatRest(f, c.mover), tone: 'good', weight: f.mateIn ? 70 : 40 + f.gain };
    case 'defends-threat':
      return f.mateIn
        ? { key: `defends:${f.move}`, verb: 'stop', rest: `${colorName(opp)}'s mate threat (${moveName(f.san, opp)})`, tone: 'good', weight: 75 }
        : { key: `defends:${f.move}`, verb: 'stop', rest: `${colorName(opp)}'s threat ${moveName(f.san, opp)}`, tone: 'good', weight: 45 + f.gain };
    case 'prevents':
      return { key: `prevent:${f.move}`, verb: 'prevent', rest: moveName(f.san, opp), tone: 'good', weight: 28, squares: [f.square] };
    default:
      return null;
  }
}

// --- board rules ---------------------------------------------------------------------------------------------------

const sq = (s: Square): string => makeSquare(s);
const CENTRE = new Set(['d4', 'e4', 'd5', 'e5']);
const CENTRE_SET = SquareSet.empty().with(27).with(28).with(35).with(36);
/** "Controls d5 in the centre" is told up to this fullmove number (the opening). */
export const CENTRE_MAX_FULLMOVE = 15;
/** Squares on the ranks ahead of `s`, from `color`'s side. */
function aheadOf(s: Square, color: Color): SquareSet {
  let out = SquareSet.empty();
  for (let r = 0; r < 8; r++) if (color === 'white' ? r > s >> 3 : r < s >> 3) out = out.union(SquareSet.fromRank(r));
  return out;
}
/** c3–f6 */
const CENTRE_BOX = (() => {
  let s = SquareSet.empty();
  for (let r = 2; r <= 5; r++) for (let f = 2; f <= 5; f++) s = s.with(r * 8 + f);
  return s;
})();
const FILE_MASK = (f: number): SquareSet => SquareSet.fromFile(f);

function pawnAttackSet(board: Board, color: Color): SquareSet {
  let s = SquareSet.empty();
  for (const p of board.pieces(color, 'pawn')) s = s.union(pawnAttacks(color, p));
  return s;
}

/** Safe squares of the piece on `s`: attacked, not own-occupied, not attacked by enemy pawns. */
function safeSquares(pos: Position, s: Square, color: Color): number {
  return attacksFrom(pos.board, s).diff(pos.board[color]).diff(pawnAttackSet(pos.board, opposite(color))).size();
}

const CASTLE_UCI: Record<Color, Record<'king' | 'queen', string>> = {
  white: { king: 'e1g1', queen: 'e1c1' },
  black: { king: 'e8g8', queen: 'e8c8' },
};

/** The position after the move with the mover to move again (null: the move ends the game or gives check). */
function moverAgain(after: Position, mover: Color): Chess | null {
  if (after.isCheck() || after.isEnd()) return null;
  try {
    return withTurn(after, mover);
  } catch {
    return null;
  }
}

/** Is `uci` legal in `pos` and safe by SEE? */
function playable(pos: Chess, uci: string): boolean {
  if (!legalMove(pos, uci)) return false;
  return seeMove(pos, uci) >= 0;
}

function boardPoints(fen: string, uci: string, pv: readonly string[], c: PointContext, facts: readonly Fact[]): Point[] {
  const before = positionFromFen(fen);
  const move = legalMove(before, uci) as NormalMove;
  const after = before.clone();
  after.play(move);
  const mover = c.mover;
  const opp = opposite(mover);
  const piece = before.board.get(move.from)!;
  const isCastle = facts.some((f) => f.type === 'castle');
  const toSq = isCastle ? after.board.kingOf(mover)! : move.to;
  const capture = facts.some((f) => f.type === 'capture') || !!before.board.get(move.to);
  const out: Point[] = [];
  const again = moverAgain(after, mover);

  // centre: a pawn steps into it, or (opening) the moved piece newly controls centre squares — one point either way
  if (piece.role === 'pawn' && !capture && CENTRE.has(sq(toSq)) && seeMove(before, uci) >= 0) {
    out.push({ key: 'centre', verb: 'occupy', rest: 'the centre', tone: 'good', weight: 18, squares: [sq(toSq)] });
  } else if ((piece.role === 'pawn' || piece.role === 'knight' || piece.role === 'bishop') && !capture && before.fullmoves <= CENTRE_MAX_FULLMOVE
    && !(piece.role === 'pawn' && pawnAttacks(mover, toSq).intersects(after.board.pieces(opp, 'pawn')))) {
    const was = attacksFrom(before.board, move.from).intersect(CENTRE_SET).with(move.from);
    const now = [...attacksFrom(after.board, toSq).intersect(CENTRE_SET).diff(was)].map(sq).sort();
    if (now.length) out.push({ key: 'centre', verb: 'control', rest: `${joinList(now)} in the centre`, tone: 'good', weight: 11, squares: now });
  }
  // a pawn step that hits an enemy pawn (same key as an attack on it: one point)
  if (piece.role === 'pawn' && !capture) {
    const hit = pawnAttacks(mover, toSq).intersect(after.board.pieces(opp, 'pawn'));
    for (const t of hit) out.push({ key: `attack:${sq(t)}`, verb: 'challenge', rest: `the pawn on ${sq(t)}`, tone: 'good', weight: 16, squares: [sq(t)] });
  }

  // a pawn step that takes a square from an enemy knight / bishop / queen: it could go there safely before, now it
  // would be lost (h3 keeping the bishop off g4)
  if (piece.role === 'pawn' && !capture) {
    const theirs = moverAgain(before, opp);
    const now = moverAgain(after, opp);
    // one point per set of pieces kept out ("Keeps the knight off b5 and d5")
    const byRoles = new Map<string, string[]>();
    for (const t of pawnAttacks(mover, toSq)) {
      if (after.board.get(t) || !theirs || !now) continue;
      const roles = new Set<PieceRole>();
      for (const from of after.board[opp].intersect(after.board.knight.union(after.board.bishop).union(after.board.queen))) {
        const u = `${sq(from)}${sq(t)}`;
        if (playable(theirs, u) && legalMove(now, u) && seeMove(now, u) < 0) roles.add(after.board.getRole(from)!);
      }
      if (roles.size) {
        const k = joinList([...roles].sort());
        byRoles.set(k, [...(byRoles.get(k) ?? []), sq(t)]);
      }
    }
    for (const [roles, squares] of byRoles) {
      const sqs = squares.sort();
      out.push({ key: `keeps-off:${sqs.join(',')}`, verb: 'keep', rest: `the ${roles} off ${joinList(sqs)}`, tone: 'good', weight: 15, squares: sqs });
    }
  }

  // bishops opened / blocked (squares ahead of the bishop only: blocking its way back is no harm)
  const ahead = (b: Square) => aheadOf(b, mover);
  let opened: { s: Square; n: number } | null = null;
  for (const b of after.board.pieces(mover, 'bishop')) {
    if (b === toSq) continue;
    const was = attacksFrom(before.board, b).intersect(ahead(b));
    const now = attacksFrom(after.board, b).intersect(ahead(b));
    const gained = now.diff(was).diff(after.board[mover]).size();
    const lost = was.diff(now).size();
    if (gained >= LINE_SQUARES && was.has(move.from) && (!opened || gained > opened.n)) opened = { s: b, n: gained };
    if (lost >= LINE_SQUARES && now.has(toSq)) {
      out.push(piece.role === 'pawn'
        ? { key: `blocks:${sq(b)}`, verb: 'shut', rest: `in the bishop on ${sq(b)}`, tone: 'bad', weight: 12, squares: [sq(b)] }
        : { key: `blocks:${sq(b)}`, verb: 'block', rest: `the bishop on ${sq(b)}`, tone: 'bad', weight: 12, squares: [sq(b)] });
    }
  }
  if (opened) out.push({ key: 'opens-bishop', verb: 'open', rest: `the diagonal for the bishop on ${sq(opened.s)}`, tone: 'good', weight: 14, squares: [sq(opened.s)] });

  // a piece in front of an unmoved centre pawn
  if (piece.role !== 'pawn' && !isCastle) {
    const home = mover === 'white' ? 1 : 6;
    const dir = mover === 'white' ? 8 : -8;
    const behind = toSq - dir;
    const file = toSq & 7;
    const dPawnUp = before.board.pieces(mover, 'pawn').has((mover === 'white' ? 3 : 4) * 8 + 3);
    if ((toSq >> 3) === home + (mover === 'white' ? 1 : -1) && before.board.pieces(mover, 'pawn').has(behind) && (file === 3 || file === 4 || (file === 2 && dPawnUp))) {
      const f = 'abcdefgh'[file]!;
      out.push({ key: `blocks-pawn:${f}`, verb: 'block', rest: `the ${f}-pawn`, tone: 'bad', weight: 9, squares: [sq(behind)] });
    }
  }

  // prepares castling
  if (!isCastle && piece.role !== 'king' && again) {
    for (const side of castlingSides(before, mover)) {
      const cu = CASTLE_UCI[mover][side];
      if (legalMove(before, cu)) continue;
      if (legalMove(again, cu)) {
        out.push({ key: 'prepare-castle', verb: 'prepare', rest: side === 'king' ? 'to castle' : 'to castle queenside', tone: 'good', weight: 16 });
        break;
      }
    }
  }

  // prepares the mover's next move in the engine line
  const next = pv[2];
  const nm = next ? parseUci(next) : undefined;
  // (not the moved piece's own next step, nor a piece stepping into the square it left — unless a pawn left it: g3, Bg2)
  if (next && nm && 'from' in nm && again && nm.from !== toSq && (nm.to !== move.from || piece.role === 'pawn') && !out.some((p) => p.key === 'prepare-castle')) {
    const nextPiece = after.board.get(nm.from);
    const viaOpened = nextPiece?.role === 'bishop' && opened?.s === nm.from;
    const isNextCastle = nextPiece?.role === 'king' && Math.abs((nm.to & 7) - (nm.from & 7)) === 2;
    if (!viaOpened && !playable(before, next) && playable(again, next)) {
      const san = pvToSan(fen, pv.slice(0, 3))[2];
      if (isNextCastle) out.push({ key: 'prepare-castle', verb: 'prepare', rest: 'to castle', tone: 'good', weight: 16 });
      else if (san) out.push({ key: `prepare:${next.slice(0, 4)}`, verb: 'prepare', rest: moveName(san, mover), tone: 'good', weight: 18, squares: [sq(nm.to)] });
    }
  }

  // activity / centralisation / rooks
  const developed = facts.some((f) => f.type === 'develop');
  if (!capture && !developed && !isCastle && (piece.role === 'knight' || piece.role === 'bishop' || piece.role === 'rook' || piece.role === 'queen')) {
    const nowSafe = safeSquares(after, toSq, mover);
    const gain = nowSafe - safeSquares(before, move.from, mover);
    let rookFile = false;
    if (piece.role === 'rook') {
      const fTo = FILE_MASK(toSq & 7);
      const fFrom = FILE_MASK(move.from & 7);
      const pawns = after.board.pawn;
      const own = after.board.pieces(mover, 'pawn');
      const openTo = pawns.intersect(fTo).isEmpty();
      const halfTo = own.intersect(fTo).isEmpty();
      const wasOpen = (toSq & 7) === (move.from & 7) || own.intersect(fFrom).isEmpty();
      if (halfTo && !wasOpen) {
        rookFile = true;
        out.push({ key: 'open-file', verb: 'put', rest: `the rook on the ${openTo ? 'open' : 'half-open'} ${'abcdefgh'[toSq & 7]}-file`, tone: 'good', weight: 18, squares: [sq(toSq)] });
      }
    }
    if (!rookFile && (piece.role === 'knight' || piece.role === 'bishop') && CENTRE_BOX.has(toSq) && !CENTRE_BOX.has(move.from) && gain >= 2) {
      out.push({ key: `activate:${piece.role}`, verb: 'centralise', rest: `the ${piece.role}`, tone: 'good', weight: 13, squares: [sq(toSq)] });
    } else if (!rookFile && gain >= ACTIVITY_GAIN && nowSafe >= ACTIVITY_MIN) {
      out.push({ key: `activate:${piece.role}`, verb: 'activate', rest: `the ${piece.role}`, tone: 'good', weight: 12, squares: [sq(toSq)] });
    }
  }

  // rooks connected on the back rank
  const back = mover === 'white' ? 0 : 7;
  const connected = (pos: Position) => {
    const rooks = [...pos.board.pieces(mover, 'rook')].filter((r) => r >> 3 === back);
    return rooks.length === 2 && between(rooks[0]!, rooks[1]!).intersect(pos.board.occupied).isEmpty();
  };
  if (!connected(before) && connected(after)) out.push({ key: 'connect-rooks', verb: 'connect', rest: 'the rooks', tone: 'good', weight: 10 });

  // pawn structure, bishop pair
  const fb = positionalFeatures(before);
  const fa = positionalFeatures(after);
  if (piece.role === 'pawn' && fb[mover].pawns.passed.includes(sq(move.from))) {
    const rank = mover === 'white' ? (toSq >> 3) + 1 : 8 - (toSq >> 3);
    out.push({ key: 'push-passer', verb: 'push', rest: 'the passed pawn', tone: 'good', weight: rank >= 6 ? 35 : 22, squares: [sq(toSq)] });
  } else {
    const made = fa[mover].pawns.passed.filter((s) => !fb[mover].pawns.passed.includes(s));
    if (made.length) out.push({ key: 'passer', verb: 'create', rest: `a passed pawn on ${made[0]}`, tone: 'good', weight: 26, squares: made });
  }
  if (fa[opp].pawns.doubledCount > fb[opp].pawns.doubledCount) out.push({ key: 'doubles', verb: 'double', rest: `${colorName(opp)}'s pawns`, tone: 'good', weight: 16 });
  if (fa[opp].pawns.isolated.length > fb[opp].pawns.isolated.length) out.push({ key: 'isolates', verb: 'leave', rest: `${colorName(opp)} with an isolated pawn`, tone: 'good', weight: 12 });
  if (fa[mover].pawns.doubledCount > fb[mover].pawns.doubledCount) out.push({ key: 'own-doubled', verb: 'accept', rest: 'doubled pawns', tone: 'bad', weight: 8 });
  if (fa[mover].pawns.isolated.length > fb[mover].pawns.isolated.length) out.push({ key: 'own-isolated', verb: 'leave', rest: 'an isolated pawn', tone: 'bad', weight: 8 });
  if (fb[opp].bishopPair && !fa[opp].bishopPair) out.push({ key: 'bishop-pair', verb: 'take', rest: 'away the bishop pair', tone: 'good', weight: 14 });
  if (fb[mover].bishopPair && !fa[mover].bishopPair) out.push({ key: 'gives-pair', verb: 'give', rest: 'up the bishop pair', tone: 'bad', weight: 8 });
  return out;
}

// --- one move ------------------------------------------------------------------------------------------------------

/** The line's material / mate result as a point, unless a fact already says it. */
/** The material result of the move's engine line (pawns, mover POV), as narrated (analysis' own short story length). */
export function narratedDelta(fen: string, pv: readonly string[], score: Score, settings: AnalysisSettings): number {
  return pv.length < 2 ? 0 : narrateLine(fen, pv, { settings, score }).line.materialDelta;
}

function linePoints(fen: string, pv: readonly string[], score: Score, settings: AnalysisSettings, c: PointContext, have: readonly Point[], baseline: number, laterBaseline: number): Point[] {
  const out: Point[] = [];
  if (score.mate !== undefined && score.mate > 1 && !have.some((p) => p.key === 'mate')) {
    out.push({ key: 'mate', verb: 'force', rest: `mate in ${score.mate}`, tone: 'good', weight: 95 });
    return out;
  }
  if (pv.length < 2) return out;
  const line = narrateLine(fen, pv, { settings, score }).line;
  // (a gambit pawn won back a few moves later is no material point: the result must still hold further down the line)
  const later = laterMaterial(fen, pv);
  if (line.result === 'wins-material' && line.won?.length && line.materialDelta >= baseline + 1 && later >= laterBaseline + 1 && !have.some((p) => p.key.startsWith('win:') || p.key === 'recapture')) {
    // a later capture wins it, not the move itself: name the capture that takes the biggest piece won ("Sets up
    // …Nxe4, winning a pawn"); none found (the material comes from several trades): "Leads to winning …"
    const top = [...line.won].sort((a, b) => PIECE_VALUES[b] - PIECE_VALUES[a])[0]!;
    const capture = line.steps.slice(1).find((st) => st.color === c.mover && st.facts.some((f) => f.type === 'capture' && f.outcome !== 'loses-material' && f.captured.role === top));
    // (what comes back too: "winning a rook for a bishop")
    const what = `${piecesPhrase(line.won)}${line.lost?.length ? ` for ${piecesPhrase(line.lost)}` : ''}`;
    const weight = 50 + 3 * PIECE_VALUES[top];
    const target = capture?.uci.slice(2, 4);
    // the move's own threat already says it ("Threatens …Rxd6")
    if (!(capture && have.some((p) => p.key.startsWith(`threat:${capture.uci.slice(0, 4)}`)))) {
      // (the same point as the move's attack on that piece: "Attacks the pawn on e5" + "Sets up Nxe5" is one point)
      const key = target && have.some((p) => p.key === `attack:${target}`) ? `attack:${target}` : 'wins';
      out.push(capture
        ? { key, verb: 'set', rest: `up ${moveName(capture.san, c.mover)}, winning ${what}`, tone: 'good', weight }
        : { key, verb: 'lead', rest: `to winning ${what}`, tone: 'good', weight });
    }
  }
  if (line.result === 'loses-material' && line.lost?.length && line.materialDelta <= baseline - 1 && later <= laterBaseline - 1 && !have.some((p) => p.key === 'sacrifice' || p.key.startsWith('offer:') || p.key.startsWith('hangs:'))) {
    // ("Gives up a rook for a bishop": an exchange is not a lost rook)
    const back = line.won?.length ? ` for ${piecesPhrase(line.won)}` : '';
    out.push(c.good
      ? { key: 'gives-up', verb: 'give', rest: `up ${piecesPhrase(line.lost)}${back}`, tone: 'neutral', weight: 25 }
      : { key: 'loses', verb: 'lose', rest: `${piecesPhrase(line.lost)}${back}`, tone: 'bad', weight: 60 });
  }
  return out;
}

/**
 * Everything checked about one move, most important first: its board facts (verified with its engine line), the
 * engine-searched extras, the line's result and the board rules. `plan`: the mover's next moves in the line (SAN),
 * for a move with at most one point of its own.
 */
export function movePoints(fen: string, m: MoveInput, settings: AnalysisSettings, extras: MoveExtras = {}): MovePoints {
  const p = playMove(fen, m.uci);
  const pv = legalPrefix(fen, m.pv.length && sameMoveUci(fen, m.pv[0]!, p.uci) ? [p.uci, ...m.pv.slice(1)] : [p.uci]);
  const pos = positionFromFen(fen);
  const mover = pos.turn;
  const c: PointContext = { mover, good: m.winLoss <= settings.labels.goodMaxLoss, movedRole: pos.board.getRole(legalMove(pos, p.uci)!.from)! };

  const facts = verifyWithLine(pruneRefuted(immediateFacts(fen, p.uci, m.prev ? { prev: m.prev } : {}), p.uci, pv[1]), fen, pv);
  addLineFork(facts, fen, pv);
  // the engine-searched extras, with analyzeMove's rules
  const { threat, defends, prevents } = extras;
  if (threat && !replyTakesMovedPiece(p.uci, pv[1]) && !threatExistedBefore(fen, threat) && !targetHitsBack(p.fenAfter, threat)) facts.push(threat);
  if (defends && !(defends.mateIn === undefined && (opponentPlays(pv, defends.move) || stillEnPrise(p.fenAfter, defends.move)))) facts.push(defends);
  else if (prevents && !opponentPlays(pv, prevents.move)) facts.push(prevents);

  const pts: Point[] = [];
  // one point per purpose: defending / saving the piece the opponent's threat hits is stopping that threat, and
  // attacking the piece the move's own threat takes is that threat (the heavier wording stays, see dedupe)
  const stops = facts.find((f): f is DefendsFact => f.type === 'defends-threat');
  const threatens = facts.find((f): f is ThreatFact => f.type === 'threat');
  for (const f of facts) {
    const pt = factPoint(f, c);
    if (!pt) continue;
    // a capture that also takes the piece out of an attack: the capture is the story
    if (f.type === 'escape' && facts.some((g) => g.type === 'capture')) continue;
    if (stops && ((f.type === 'defend' && f.piece.square === stops.move.slice(2, 4)) || (f.type === 'escape' && f.from === stops.move.slice(2, 4)))) pt.key = `defends:${stops.move}`;
    if (threatens && f.type === 'attack' && f.target.square === threatens.move.slice(2, 4)) pt.key = `threat:${threatens.move}`;
    pts.push(pt);
  }
  pts.push(...linePoints(fen, pv, m.score, settings, c, pts, m.baseline ?? 0, m.laterBaseline ?? 0));
  pts.push(...boardPoints(fen, p.uci, pv, c, facts));
  // a fork / check that also wins: the fork says it; check is no point of its own next to mate or a fork with the king
  const has = (k: string) => pts.some((x) => x.key === k);
  const points = dedupe(pts.filter((x) => !(x.key === 'check' && (has('fork') || has('mate')))));
  const own = points.filter((x) => x.tone !== 'bad').length;
  const plan = own <= 1 ? pvToSan(fen, pv).filter((_, i) => i % 2 === 0).slice(1, 1 + PLAN_MOVES).map((s) => moveName(s, mover)) : [];
  const kind = c.movedRole === 'knight' || c.movedRole === 'bishop' ? 'minor' : c.movedRole;
  return { uci: p.uci, san: p.san, kind, points, plan };
}

/** One point per key (the heaviest), heaviest first. */
function dedupe(points: readonly Point[]): Point[] {
  const best = new Map<string, Point>();
  for (const p of points) {
    const q = best.get(p.key);
    if (!q || p.weight > q.weight) best.set(p.key, p);
  }
  return [...best.values()].sort((a, b) => b.weight - a.weight);
}

// --- comparing moves -----------------------------------------------------------------------------------------------

/** Share of a move's (good / neutral) point weight that a better move must make too for "the same idea". */
export const SAME_IDEA_SHARE = 0.5;

/** Points that are a move's purpose whatever piece makes them (two moves stopping the same threat share an idea). */
const PURPOSE = /^(defends:|prevent:|defend:|escape:|win:|trap:|mate$|recapture$|answer-check$)/;

/**
 * `a` has the same idea as the better move `b`: they move the same kind of piece (pawn / knight or bishop / rook /
 * queen / king: d4 next to Nf3 is another plan, even though both hit e5) and `b` makes at least SAME_IDEA_SHARE of
 * `a`'s good / neutral points by weight (Nc3 "develops" next to Nf3 "attacks e5, develops") or `a` moves the very
 * same piece (Nd2 next to Nc3) — either way `b` makes `a`'s main point too; or the main point of `a` is a purpose `b`
 * has too (both stop …Nxe5). A move with no good point of its own has no idea to share.
 */
export function sameIdea(a: MovePoints, b: MovePoints): boolean {
  const own = a.points.filter((p) => p.tone !== 'bad');
  if (!own.length) return false;
  const bKeys = new Set(b.points.map((p) => p.key));
  if (PURPOSE.test(own[0]!.key) && bKeys.has(own[0]!.key)) return true;
  if (a.kind !== b.kind || !bKeys.has(own[0]!.key)) return false;
  const shared = own.filter((p) => bKeys.has(p.key));
  const w = (ps: readonly Point[]) => ps.reduce((s, p) => s + p.weight, 0);
  return w(shared) >= SAME_IDEA_SHARE * w(own) || a.uci.slice(0, 2) === b.uci.slice(0, 2);
}

/**
 * The moves as told, best first: a move with the same idea as a better one (the first such) gets `like` and its
 * differences — `plus`: its own good points the better move lacks, and the better move's drawbacks it avoids;
 * `minus`: its own drawbacks the better move avoids, and the better move's good points (weight >= MISSING_MIN_WEIGHT)
 * it lacks (not a specific follow-up the better move prepares: "doesn't prepare …Ba6" says little). Every move keeps its
 * own points (at most MAX_POINTS).
 */
export function compareIdeas(moves: readonly MovePoints[]): MoveIdea[] {
  return moves.map((m, i): MoveIdea => {
    const idea: MoveIdea = { uci: m.uci, san: m.san, points: m.points.slice(0, MAX_POINTS).map(said) };
    if (m.plan.length) idea.plan = m.plan;
    const j = moves.slice(0, i).findIndex((b) => sameIdea(m, b));
    if (j < 0) return idea;
    const ref = moves[j]!;
    const mine = new Set(m.points.map((p) => p.key));
    const theirs = new Set(ref.points.map((p) => p.key));
    const byWeight = (a: { w: number }, b: { w: number }) => b.w - a.w;
    const plus = [
      ...m.points.filter((p) => p.tone !== 'bad' && !theirs.has(p.key)).map((p) => ({ w: p.weight, pt: said(p) })),
      ...ref.points.filter((p) => p.tone === 'bad' && !mine.has(p.key)).map((p) => ({ w: p.weight, pt: denied(p) })),
    ].sort(byWeight).slice(0, MAX_DIFF).map((x) => x.pt);
    const minus = [
      ...m.points.filter((p) => p.tone === 'bad' && !theirs.has(p.key)).map((p) => ({ w: p.weight, pt: said(p) })),
      ...ref.points.filter((p) => p.tone === 'good' && p.weight >= MISSING_MIN_WEIGHT && !mine.has(p.key) && !p.key.startsWith('prepare:')).map((p) => ({ w: p.weight, pt: denied(p) })),
    ].sort(byWeight).slice(0, MAX_DIFF).map((x) => x.pt);
    idea.like = j;
    idea.plus = plus;
    idea.minus = minus;
    return idea;
  });
}

// --- with the engine -----------------------------------------------------------------------------------------------

export type SearchFn = (fen: string, params: SearchParams) => Promise<SearchResult>;

/** The median (0 for none). */
export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * The points of the top moves in `fen` (best first, as TopMovesResult.moves), from their engine lines (`lines`: the
 * top-moves search) plus the null-move searches analyzeMove runs for the same facts: the opponent's threat now (which
 * moves stop it), each move's own threat, and prophylaxis. `prev`: the move that led to `fen`, if known (recaptures).
 */
export async function topIdeas(fen: string, moves: readonly { uci: string; winLoss: number }[], lines: readonly PvLine[], settings: AnalysisSettings, search: SearchFn, prev: MoveInput['prev'] = null): Promise<MoveIdea[]> {
  const T = settings.budget.threat;
  const threatParams: SearchParams = { depth: T.depth, multipv: T.multipv, maxMs: T.maxMs };
  const oppNull = nullMoveFen(fen);
  const oppNullSearch = oppNull ? await search(oppNull, threatParams) : null;
  const oppThreat = oppNull && oppNullSearch ? threatFromSearch(oppNull, oppNullSearch) : null;
  const input = moves.map((m) => {
    const line = lines.find((l) => sameMoveUci(fen, l.move, m.uci));
    const pv = legalPrefix(fen, line?.pv.length ? line.pv : [m.uci]);
    return { m, score: line?.score ?? { cp: 0 }, pv };
  });
  const baseline = median(input.map((x) => narratedDelta(fen, x.pv, x.score, settings)));
  const laterBaseline = median(input.map((x) => laterMaterial(fen, x.pv)));
  const all: MovePoints[] = [];
  for (const { m, score, pv } of input) {
    const { fenAfter } = playMove(fen, m.uci);
    const nf = nullMoveFen(fenAfter);
    const threat = nf ? threatFromSearch(nf, await search(nf, threatParams)) : null;
    let defends: DefendsFact | null = null;
    if (oppThreat && nf) {
      const still = legalPrefix(fenAfter, [oppThreat.move]).length === 1
        ? threatStillWorks(fenAfter, oppThreat, await search(fenAfter, { ...threatParams, multipv: 1, searchmoves: [oppThreat.move] }))
        : false;
      const takesThreatener = m.uci.slice(2, 4) === oppThreat.move.slice(0, 2);
      if (!still && !takesThreatener) defends = { type: 'defends-threat', move: oppThreat.move, san: oppThreat.san, gain: oppThreat.gain, facts: oppThreat.facts, ...(oppThreat.mateIn !== undefined ? { mateIn: oppThreat.mateIn } : {}) };
    }
    const prevents = oppNullSearch && !defends ? preventsFact({ fenBefore: fen, uci: m.uci, nullSearch: oppNullSearch, score, threatMove: oppThreat?.move ?? null }) : null;
    all.push(movePoints(fen, { uci: m.uci, pv, score, winLoss: m.winLoss, baseline, laterBaseline, prev }, settings, { threat, defends, prevents }));
  }
  return compareIdeas(all);
}
