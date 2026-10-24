// Move notation helpers on chessops: UCI normalisation (castling king-to-square), SAN of PVs, FEN after moves.
//
// Convention (ARCHITECTURE.md): UCI internally, castling as king-to-square (`e1g1`). chessops' own parseSan /
// normalizeMove produce king-takes-rook (`e1h1`); `standardUci` converts back.

import type { Color } from '@chess-coach/shared';
import { castlingSide, type Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import type { Move, NormalMove } from 'chessops/types';
import { kingCastlesTo, makeUci, parseUci } from 'chessops/util';
import { positionFromFen } from './material';

/** Parse a UCI move that is legal in `pos`, or undefined. */
export function legalMove(pos: Chess, uci: string): NormalMove | undefined {
  const m = parseUci(uci);
  if (!m || !('from' in m)) return undefined;
  return pos.isLegal(m) ? m : undefined;
}

/** UCI of a (legal) move in `pos`, castling as king-to-square (`e1g1`, never `e1h1`). */
export function standardUci(pos: Chess, move: Move): string {
  if (!('from' in move)) return makeUci(move);
  const side = castlingSide(pos, move);
  if (side) {
    const to = kingCastlesTo(pos.turn, side);
    return makeUci({ from: move.from, to });
  }
  return makeUci(move);
}

/** Normalised FEN (chessops round trip). Throws on an invalid FEN. */
export function normalizeFen(fen: string): string {
  return makeFen(positionFromFen(fen).toSetup());
}

/** Play `uci` from `fen`: SAN, normalised UCI and FEN after the move. Throws if the move is illegal. */
export function playMove(fen: string, uci: string): { san: string; uci: string; fenAfter: string; color: Color } {
  const pos = positionFromFen(fen);
  const move = legalMove(pos, uci);
  if (!move) throw new Error(`illegal move ${uci} in ${fen}`);
  const color = pos.turn;
  const san = makeSan(pos, move);
  const std = standardUci(pos, move);
  pos.play(move);
  return { san, uci: std, fenAfter: makeFen(pos.toSetup()), color };
}

/** SAN of every legal move of a UCI PV from `fen`; stops at the first illegal move. */
export function pvToSan(fen: string, pv: readonly string[]): string[] {
  const pos = positionFromFen(fen);
  const out: string[] = [];
  for (const u of pv) {
    const m = legalMove(pos, u);
    if (!m) break;
    out.push(makeSan(pos, m));
    pos.play(m);
  }
  return out;
}

/** The legal prefix of a UCI PV from `fen` (normalised UCI). */
export function legalPrefix(fen: string, pv: readonly string[]): string[] {
  const pos = positionFromFen(fen);
  const out: string[] = [];
  for (const u of pv) {
    const m = legalMove(pos, u);
    if (!m) break;
    out.push(standardUci(pos, m));
    pos.play(m);
  }
  return out;
}

/** FEN after playing a (legal) UCI sequence; throws on an illegal move. */
export function fenAfterMoves(fen: string, moves: readonly string[]): string {
  const pos = positionFromFen(fen);
  for (const u of moves) {
    const m = legalMove(pos, u);
    if (!m) throw new Error(`illegal move ${u} in ${makeFen(pos.toSetup())}`);
    pos.play(m);
  }
  return makeFen(pos.toSetup());
}

/** Squares of a UCI move for arrows: from/to, castling as king-to-square. */
export function uciSquares(uci: string): { from: string; to: string } {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
}

/** Position status: checkmate / stalemate / ongoing (other draws are left to the engine). */
export function positionStatus(fen: string): 'checkmate' | 'stalemate' | 'ongoing' {
  const pos = positionFromFen(fen);
  const ctx = pos.ctx();
  if (pos.isCheckmate(ctx)) return 'checkmate';
  if (pos.isStalemate(ctx)) return 'stalemate';
  return 'ongoing';
}
