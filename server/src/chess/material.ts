// Material helpers on chessops boards (owned by M1a; M1b's facts may import this — keep the API stable).
//
// Piece values (ARCHITECTURE.md "Conventions"): P=1, N=3, B=3, R=5, Q=9, K=0.
//
// API
//  - PIECE_VALUES                         role -> pawns
//  - materialOf(board, color)             sum of `color`'s piece values
//  - materialBalance(board, color)        materialOf(color) - materialOf(opponent)
//  - lineMaterial(fen, pvUci, opts)       play a PV and measure the mover's balance at a quiet point
//                                         (used by the SPEC "Material rule", see analysis/classify.ts);
//                                         also returns every played ply (LineMove: captures, promotions, balance)
//  - positionFromFen(fen)                 FEN -> legal chessops `Chess` position, or throw

import type { Color, PieceRole } from '@chess-coach/shared';
import type { Board } from 'chessops/board';
import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import type { NormalMove } from 'chessops/types';
import { makeSquare, opposite, parseUci } from 'chessops/util';

/** Material value of each role in pawns. */
export const PIECE_VALUES: Readonly<Record<PieceRole, number>> = Object.freeze({
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 0,
});

const ROLES: readonly PieceRole[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

/** Total material of `color` on `board`, in pawns (king = 0). */
export function materialOf(board: Board, color: Color): number {
  let sum = 0;
  for (const role of ROLES) sum += board.pieces(color, role).size() * PIECE_VALUES[role];
  return sum;
}

/** Material of `color` minus material of the opponent, in pawns. */
export function materialBalance(board: Board, color: Color): number {
  return materialOf(board, color) - materialOf(board, opposite(color));
}

/** Parse a FEN into a legal standard-chess position, or throw. */
export function positionFromFen(fen: string): Chess {
  const setup = parseFen(fen);
  if (setup.isErr) throw new Error(`invalid FEN: ${fen} (${setup.error.message})`);
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) throw new Error(`illegal position: ${fen} (${pos.error.message})`);
  return pos.value;
}

export interface LineMaterialOptions {
  /**
   * Minimum number of plies (counted from `fen`, i.e. including the first PV move) before the balance is measured.
   * Use `settings.material.quietHorizonPlies`.
   */
  horizonPlies: number;
}

/** One played ply of the line. */
export interface LineMove {
  /** 1-based ply index within the line (1 = first PV move). */
  ply: number;
  uci: string;
  color: Color;
  /** Role that moved (before promotion). */
  role: PieceRole;
  /** Captured piece (en passant: the captured pawn's square). */
  captured?: { role: PieceRole; square: string; color: Color };
  promotion?: PieceRole;
  /** Mover's material balance (side to move at the line's start fen) after this ply. */
  balanceAfter: number;
}

export interface LineMaterialResult {
  /** Side to move at `fen` (the mover); every balance below is from this side's POV. */
  mover: Color;
  /** Mover's material balance at `fen` (before the first PV move). */
  startBalance: number;
  /** Mover's material balance at the measuring point. */
  balance: number;
  /** balance - startBalance. */
  delta: number;
  /** Number of PV plies played up to the measuring point. */
  plies: number;
  /**
   * True when the measuring point is quiet: the last ply played was neither a capture nor a promotion (or no ply
   * was played, or the line ended in mate). False when the PV ran out in the middle of an exchange.
   */
  quiet: boolean;
  /** Checkmate reached within the measured plies: 'mover' = the mover delivered mate, 'opponent' = mover got mated. */
  mate: 'mover' | 'opponent' | null;
  /** Stalemate reached within the measured plies. */
  stalemate: boolean;
  /** 0-based PV index of the first illegal/unparseable move, if any (the line is cut there). */
  illegalAt?: number;
  /** FEN at the measuring point. */
  finalFen: string;
  /** The plies actually played (up to the measuring point). */
  moves: LineMove[];
}

/** True if `move` captures something in `pos` (normal capture or en passant; castling king-takes-rook is not). */
function capturedSquare(pos: Chess, move: NormalMove): number | undefined {
  const target = pos.board.get(move.to);
  if (target && target.color !== pos.turn) return move.to;
  const piece = pos.board.get(move.from);
  if (piece?.role === 'pawn' && move.to === pos.epSquare && !target) {
    return move.to + (pos.turn === 'white' ? -8 : 8);
  }
  return undefined;
}

/**
 * Play `pvUci` from `fen` and measure the mover's (side to move at `fen`) material balance at a quiet point:
 * after `opts.horizonPlies` plies, extended while the last ply played was a capture or a promotion, until the PV
 * ends. The line stops early at checkmate/stalemate, and at the first illegal or unparseable move (`illegalAt`).
 * Never throws for bad PV moves; throws only for an invalid `fen`.
 */
export function lineMaterial(fen: string, pvUci: readonly string[], opts: LineMaterialOptions): LineMaterialResult {
  const pos = positionFromFen(fen);
  const mover = pos.turn;
  const startBalance = materialBalance(pos.board, mover);
  const horizon = Math.max(0, Math.floor(opts.horizonPlies));
  const moves: LineMove[] = [];
  let balance = startBalance;
  let lastWasTactical = false;
  let mate: LineMaterialResult['mate'] = null;
  let stalemate = false;
  let illegalAt: number | undefined;

  for (let i = 0; i < pvUci.length; i++) {
    if (i >= horizon && !lastWasTactical) break; // reached a quiet point at/after the horizon
    const move = parseUci(pvUci[i]!);
    if (!move || !('from' in move) || !pos.isLegal(move)) {
      illegalAt = i;
      break;
    }
    const piece = pos.board.get(move.from)!;
    const capSq = capturedSquare(pos, move);
    const capPiece = capSq === undefined ? undefined : pos.board.get(capSq);
    const color = pos.turn;
    pos.play(move);
    balance = materialBalance(pos.board, mover);
    const lm: LineMove = { ply: i + 1, uci: pvUci[i]!, color, role: piece.role, balanceAfter: balance };
    if (capPiece && capSq !== undefined) lm.captured = { role: capPiece.role, square: makeSquare(capSq), color: capPiece.color };
    if (move.promotion) lm.promotion = move.promotion;
    moves.push(lm);
    lastWasTactical = !!lm.captured || !!lm.promotion;
    const ctx = pos.ctx();
    if (pos.isCheckmate(ctx)) {
      mate = color === mover ? 'mover' : 'opponent';
      break;
    }
    if (pos.isStalemate(ctx)) {
      stalemate = true;
      break;
    }
  }

  return {
    mover,
    startBalance,
    balance,
    delta: balance - startBalance,
    plies: moves.length,
    quiet: mate !== null || stalemate || !lastWasTactical,
    mate,
    stalemate,
    ...(illegalAt !== undefined ? { illegalAt } : {}),
    finalFen: makeFen(pos.toSetup()),
    moves,
  };
}
