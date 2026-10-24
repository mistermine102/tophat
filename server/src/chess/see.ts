// Static Exchange Evaluation on chessops positions.
//
// All results are in pawns (P=1 N=3 B=3 R=5 Q=9). The exchange is played on one square only; each side
// recaptures with its least valuable *legal* attacker (a capture that leaves the own king attacked is
// illegal — this covers absolute pins, captures while in check and king captures of defended pieces), and each
// side may stop instead of recapturing. Pawn captures onto the last rank promote to a queen (+8).

import { SquareSet, opposite, parseUci, squareRank, type Board, type Color, type Position, type Square, type NormalMove } from 'chessops';
import { normalizeMove, castlingSide } from 'chessops/chess';
import { PIECE_VALUES, attackersOf, kingAttackedBy, sortByValue } from './attacks';

const PROMO_BONUS = PIECE_VALUES.queen - PIECE_VALUES.pawn;

const isPromotionSquare = (sq: Square, color: Color) => squareRank(sq) === (color === 'white' ? 7 : 0);

/** Is it legal (king-safety-wise) for `side` to capture on `to` with the piece on `from`, given `occ`? */
function captureIsLegal(board: Board, from: Square, to: Square, side: Color, occ: SquareSet): boolean {
  const occ2 = occ.without(from).with(to);
  const ownKing = board.king.intersect(board[side]).intersect(occ);
  const kingSq = ownKing.has(from) ? to : ownKing.first();
  if (kingSq === undefined) return true;
  const enemy = board[opposite(side)].intersect(occ2).without(to);
  return !kingAttackedBy(board, kingSq, side, enemy, occ2);
}

function leastValuableLegalAttacker(board: Board, target: Square, side: Color, occ: SquareSet): Square | undefined {
  const atk = attackersOf(board, target, side, { occupied: occ }).without(target);
  if (atk.isEmpty()) return undefined;
  for (const from of sortByValue(board, atk)) {
    if (captureIsLegal(board, from, target, side, occ)) return from;
  }
  return undefined;
}

/**
 * Exchange on `target` where `side` captures first with the piece on `firstFrom` (forced: the first capture
 * is made even if it loses). `targetValue` = value of the piece being captured. Returns `side`'s net gain.
 * Does not check legality of the first capture (callers do).
 */
export function exchangeFrom(board: Board, target: Square, side: Color, firstFrom: Square, targetValue: number, occupied: SquareSet = board.occupied): number {
  const gains: number[] = [targetValue];
  let occ = occupied;
  let from = firstFrom;
  let cur = side;
  let onTarget = board.getRole(from)!;
  let onTargetValue = PIECE_VALUES[onTarget];
  if (onTarget === 'pawn' && isPromotionSquare(target, cur)) {
    gains[0] += PROMO_BONUS;
    onTargetValue = PIECE_VALUES.queen;
  }
  let d = 0;
  for (;;) {
    occ = occ.without(from).with(target);
    cur = opposite(cur);
    const next = leastValuableLegalAttacker(board, target, cur, occ);
    if (next === undefined) break;
    d++;
    gains[d] = onTargetValue - gains[d - 1];
    onTarget = board.getRole(next)!;
    onTargetValue = PIECE_VALUES[onTarget];
    if (onTarget === 'pawn' && isPromotionSquare(target, cur)) {
      gains[d] += PROMO_BONUS;
      onTargetValue = PIECE_VALUES.queen;
    }
    if (onTarget === 'king') {
      // A legal king capture can never be answered (the square isn't attacked any more).
      from = next;
      break;
    }
    from = next;
  }
  while (d > 0) {
    gains[d - 1] = -Math.max(-gains[d - 1], gains[d]);
    d--;
  }
  return gains[0];
}

/**
 * Best material `by` (default: side to move) can win by starting an exchange on `square`, ≥ 0
 * (0 = no capture, or every capture loses). Considers every legal first capture, en passant included
 * (en passant only when `by` is the side to move).
 */
export function see(pos: Position, square: Square, by: Color = pos.turn): number {
  const board = pos.board;
  const target = board.get(square);
  let best = 0;
  if (target && target.color !== by && target.role !== 'king') {
    const occ = board.occupied;
    const atk = attackersOf(board, square, by);
    for (const from of atk) {
      if (!captureIsLegal(board, from, square, by, occ)) continue;
      const g = exchangeFrom(board, square, by, from, PIECE_VALUES[target.role], occ);
      if (g > best) best = g;
    }
  }
  // En passant: the pawn on `square` just double-pushed past pos.epSquare.
  if (target && target.role === 'pawn' && by === pos.turn && pos.epSquare !== undefined
    && target.color !== by && pos.epSquare === square + (by === 'white' ? 8 : -8)) {
    const ep = pos.epSquare;
    for (const from of board.pieces(by, 'pawn')) {
      const move: NormalMove = { from, to: ep };
      if (!pos.isLegal(move)) continue;
      const after = pos.clone();
      after.play(move);
      const g = PIECE_VALUES.pawn - see(after, ep, opposite(by));
      if (g > best) best = g;
    }
  }
  return best;
}

/**
 * SEE of the capture `by` on `square` starting with the piece on `from` (forced first capture; may be negative).
 * Returns undefined if that capture is illegal or impossible.
 */
export function seeCaptureWith(pos: Position, from: Square, square: Square): number | undefined {
  const board = pos.board;
  const piece = board.get(from);
  const target = board.get(square);
  if (!piece || !target || target.color === piece.color || target.role === 'king') return undefined;
  if (!attackersOf(board, square, piece.color).has(from)) return undefined;
  if (!captureIsLegal(board, from, square, piece.color, board.occupied)) return undefined;
  return exchangeFrom(board, square, piece.color, from, PIECE_VALUES[target.role]);
}

/** What a move captures (piece role) — handles en passant. undefined for non-captures and castling. */
export function capturedBy(pos: Position, move: NormalMove): { role: 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen'; square: Square } | undefined {
  if (castlingSide(pos, move)) return undefined;
  const victim = pos.board.get(move.to);
  if (victim && victim.color !== pos.turn && victim.role !== 'king') return { role: victim.role, square: move.to };
  const mover = pos.board.get(move.from);
  if (mover?.role === 'pawn' && move.to === pos.epSquare && !victim) {
    return { role: 'pawn', square: move.to + (pos.turn === 'white' ? -8 : 8) };
  }
  return undefined;
}

/**
 * Net material outcome (pawns, mover's POV) of playing `uci` in `pos`: what it captures (+ promotion gain) minus
 * what the opponent can then win by the exchange on the destination square. Quiet moves are ≤ 0, castling 0.
 * Throws if the move is illegal.
 */
export function seeMove(pos: Position, uci: string): number {
  const parsed = parseUci(uci);
  if (!parsed || !('from' in parsed)) throw new Error(`bad uci ${uci}`);
  const move = parsed as NormalMove;
  if (!pos.isLegal(move)) throw new Error(`illegal move ${uci}`);
  if (castlingSide(pos, move)) return 0;
  const cap = capturedBy(pos, move);
  let gain = cap ? PIECE_VALUES[cap.role] : 0;
  if (move.promotion) gain += PIECE_VALUES[move.promotion] - PIECE_VALUES.pawn;
  const after = pos.clone();
  after.play(normalizeMove(pos, move));
  return gain - see(after, move.to, after.turn);
}

/** True if the piece on `square` can be won by its opponent (opponent's SEE > 0), whoever is to move. */
export function isHanging(pos: Position, square: Square): boolean {
  return hangingLoss(pos, square) > 0;
}

/** The opponent's SEE against the piece on `square` (0 if safe or empty). */
export function hangingLoss(pos: Position, square: Square): number {
  const piece = pos.board.get(square);
  if (!piece || piece.role === 'king') return 0;
  return see(pos, square, opposite(piece.color));
}
