// Pure attack/defence helpers on chessops boards. No engine.
//
// Conventions: squares are chessops square indices (0 = a1 … 63 = h8) internally; PieceRef uses names ('e4').
// Every lookup that takes an `occupied` set treats squares outside it as empty, so callers can simulate
// exchanges by removing pieces from the occupancy without cloning the board.

import {
  Chess,
  SquareSet,
  attacks as pieceAttacks,
  between,
  bishopAttacks,
  kingAttacks,
  knightAttacks,
  makeSquare,
  opposite,
  pawnAttacks,
  rookAttacks,
  type Board,
  type Color,
  type Piece,
  type Position,
  type Role,
  type Square,
} from 'chessops';
import type { PieceRef } from '@chess-coach/shared';
import { PIECE_VALUES } from './material';

// Piece values (PIECE_VALUES) and FEN parsing (positionFromFen) live in ./material — the single definition.

/** Ordering value for "least valuable attacker" (king last). */
const ORDER_VALUE: Readonly<Record<Role, number>> = { pawn: 1, knight: 3, bishop: 3.1, rook: 5, queen: 9, king: 100 };

export const pieceValue = (role: Role): number => PIECE_VALUES[role];

export const toPieceRef = (piece: Piece, square: Square): PieceRef => ({
  role: piece.role,
  square: makeSquare(square),
  color: piece.color,
});

export function pieceRefAt(board: Board, square: Square): PieceRef | undefined {
  const p = board.get(square);
  return p ? toPieceRef(p, square) : undefined;
}

/** Squares attacked by the piece standing on `square` (empty if none), given `occupied`. */
export function attacksFrom(board: Board, square: Square, occupied: SquareSet = board.occupied): SquareSet {
  const piece = board.get(square);
  if (!piece) return SquareSet.empty();
  return pieceAttacks(piece, square, occupied);
}

/**
 * Pieces from `set` (all one colour `color`) that attack `square` given `occupied`.
 * Only pieces inside `occupied` are considered.
 */
function attackersInSet(board: Board, square: Square, color: Color, set: SquareSet, occupied: SquareSet): SquareSet {
  const s = set.intersect(occupied);
  return rookAttacks(square, occupied)
    .intersect(board.rooksAndQueens())
    .union(bishopAttacks(square, occupied).intersect(board.bishopsAndQueens()))
    .union(knightAttacks(square).intersect(board.knight))
    .union(kingAttacks(square).intersect(board.king))
    .union(pawnAttacks(opposite(color), square).intersect(board.pawn))
    .intersect(s);
}

export interface AttackOptions {
  /** Occupancy to use (defaults to the board's). */
  occupied?: SquareSet;
  /** Also count pieces of the same colour that attack through other attackers (batteries / x-rays). */
  xray?: boolean;
}

/** Pieces of `color` attacking `square`. With `xray`, batteries behind the direct attackers count too. */
export function attackersOf(board: Board, square: Square, color: Color, opts: AttackOptions = {}): SquareSet {
  let occ = opts.occupied ?? board.occupied;
  const own = board[color];
  let found = attackersInSet(board, square, color, own, occ);
  if (!opts.xray) return found;
  // Repeatedly remove the found attackers from the occupancy and look for sliders revealed behind them.
  for (let i = 0; i < 8; i++) {
    occ = occ.diff(found);
    const more = attackersInSet(board, square, color, own, occ).diff(found);
    if (more.isEmpty()) break;
    found = found.union(more);
  }
  return found;
}

/** Own pieces defending the piece on `square` (empty if the square is empty). */
export function defendersOf(board: Board, square: Square, opts: AttackOptions = {}): SquareSet {
  const color = board.getColor(square);
  if (!color) return SquareSet.empty();
  return attackersOf(board, square, color, opts).without(square);
}

/** Enemy pieces attacked by the piece on `square`. */
export function attackedPieces(board: Board, square: Square, occupied: SquareSet = board.occupied): SquareSet {
  const color = board.getColor(square);
  if (!color) return SquareSet.empty();
  return attacksFrom(board, square, occupied).intersect(board[opposite(color)]).intersect(occupied);
}

/** All squares attacked by pieces of `color`. */
export function attackedSquares(board: Board, color: Color, occupied: SquareSet = board.occupied): SquareSet {
  let out = SquareSet.empty();
  for (const sq of board[color].intersect(occupied)) out = out.union(attacksFrom(board, sq, occupied));
  return out;
}

/** True if `color`'s king would be attacked given `occupied` and the enemy pieces in `enemy`. */
export function kingAttackedBy(board: Board, kingSq: Square, kingColor: Color, enemy: SquareSet, occupied: SquareSet): boolean {
  return attackersInSet(board, kingSq, opposite(kingColor), enemy, occupied).nonEmpty();
}

/**
 * The first occupied square beyond `front` on the line from the slider on `slider` through `front`,
 * or undefined (also undefined if the slider doesn't attack `front` or isn't a slider).
 */
export function lineBehind(board: Board, slider: Square, front: Square, occupied: SquareSet = board.occupied): Square | undefined {
  const piece = board.get(slider);
  if (!piece || !(piece.role === 'bishop' || piece.role === 'rook' || piece.role === 'queen')) return undefined;
  const seen = pieceAttacks(piece, slider, occupied);
  if (!seen.has(front)) return undefined;
  const revealed = pieceAttacks(piece, slider, occupied.without(front)).diff(seen).intersect(occupied);
  // Only squares on the slider->front line can be revealed by removing `front`.
  return revealed.first();
}

export interface PinInfo {
  pinner: Square;
  pinned: Square;
  behind: Square;
  /** Pinned to the king (moving off the line is illegal). */
  absolute: boolean;
}

/**
 * Pins against pieces of `color`: an enemy slider attacks a `color` piece and directly behind it on the same
 * line stands the `color` king (absolute) or, with `relative`, a more valuable `color` piece.
 */
export function pinsAgainst(board: Board, color: Color, opts: { relative?: boolean; occupied?: SquareSet } = {}): PinInfo[] {
  const occ = opts.occupied ?? board.occupied;
  const enemy = opposite(color);
  const out: PinInfo[] = [];
  const sliders = board[enemy].intersect(board.bishopsAndQueens().union(board.rooksAndQueens())).intersect(occ);
  for (const s of sliders) {
    const front = attacksFrom(board, s, occ).intersect(board[color]).intersect(occ);
    for (const p of front) {
      if (board.king.has(p)) continue;
      const b = lineBehind(board, s, p, occ);
      if (b === undefined || board.getColor(b) !== color) continue;
      const behindRole = board.getRole(b)!;
      if (behindRole === 'king') out.push({ pinner: s, pinned: p, behind: b, absolute: true });
      else if (opts.relative && PIECE_VALUES[behindRole] > PIECE_VALUES[board.getRole(p)!]) {
        out.push({ pinner: s, pinned: p, behind: b, absolute: false });
      }
    }
  }
  return out;
}

/** Squares of `color` pieces absolutely pinned to their king. */
export function absolutelyPinned(board: Board, color: Color, occupied: SquareSet = board.occupied): SquareSet {
  let s = SquareSet.empty();
  for (const p of pinsAgainst(board, color, { occupied })) s = s.with(p.pinned);
  return s;
}

/** Squares strictly between two squares on a line (re-export for convenience). */
export { between };

/** A copy of `pos` with the other side to move (null move). En passant is cleared. */
export function withTurn(pos: Position, turn: Color): Chess {
  const setup = pos.toSetup();
  if (setup.turn === turn) return Chess.fromSetup(setup).unwrap();
  // fromSetup validates that the side not to move isn't in check; bypass via clone + field change.
  const c = pos.clone() as Chess;
  c.turn = turn;
  c.epSquare = undefined;
  return c;
}

/** Number of legal moves per piece of `color` (computed as if `color` were to move). */
export function legalMobility(pos: Position, color: Color = pos.turn): Map<Square, number> {
  const p = color === pos.turn ? pos : withTurn(pos, color);
  const ctx = p.ctx();
  const out = new Map<Square, number>();
  for (const sq of p.board[color]) out.set(sq, p.dests(sq, ctx).size());
  return out;
}

/** Total legal-move count for `color` (castling counted once per side; promotions counted once). */
export function legalMoveCount(pos: Position, color: Color = pos.turn): number {
  let n = 0;
  for (const v of legalMobility(pos, color).values()) n += v;
  return n;
}

/** Least-valuable-first ordering of a square set. */
export function sortByValue(board: Board, set: SquareSet): Square[] {
  return [...set].sort((a, b) => ORDER_VALUE[board.getRole(a)!] - ORDER_VALUE[board.getRole(b)!]);
}
