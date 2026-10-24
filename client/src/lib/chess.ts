// Thin helpers over chessops used by the UI (board, move tree, mock data). UCI is "king-to-square" for castling
// (e1g1), as everywhere in the project (ARCHITECTURE.md "Conventions"); chessops internally uses king-to-rook.
import type { Color, PieceRole } from '@chess-coach/shared';
import { Chess, castlingSide, normalizeMove } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSan, parseSan } from 'chessops/san';
import type { Move, NormalMove, SquareName } from 'chessops/types';
import { kingCastlesTo, makeSquare, makeUci, parseSquare, parseUci } from 'chessops/util';

export function positionFromFen(fen: string): Chess {
  return Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
}

export function tryPosition(fen: string): Chess | null {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const pos = Chess.fromSetup(setup.value);
  return pos.isErr ? null : pos.value;
}

export function fenOf(pos: Chess): string {
  return makeFen(pos.toSetup());
}

/** Project-standard UCI for a (legal) move in `pos`: castling as king-to-square. */
export function standardUci(pos: Chess, move: Move): string {
  const norm = normalizeMove(pos, move);
  const side = castlingSide(pos, norm);
  if (side && 'from' in norm) {
    return makeSquare(norm.from) + makeSquare(kingCastlesTo(pos.turn, side));
  }
  return makeUci(norm);
}

export interface PlayedMove {
  uci: string;
  san: string;
  color: Color;
  fenBefore: string;
  fenAfter: string;
}

/** Play a UCI move (either castling notation) on a FEN. Returns null if illegal. */
export function playUci(fen: string, uci: string): PlayedMove | null {
  const pos = tryPosition(fen);
  const move = parseUci(uci);
  if (!pos || !move) return null;
  const norm = normalizeMove(pos, move);
  if (!pos.isLegal(norm)) return null;
  const color = pos.turn;
  const std = standardUci(pos, norm);
  const san = makeSan(pos, norm);
  pos.play(norm);
  return { uci: std, san, color, fenBefore: fen, fenAfter: fenOf(pos) };
}

/** Play a SAN move on a FEN. Returns null if illegal/unparsable. */
export function playSan(fen: string, san: string): PlayedMove | null {
  const pos = tryPosition(fen);
  if (!pos) return null;
  const move = parseSan(pos, san);
  if (!move) return null;
  return playUci(fen, makeUci(move));
}

/** Convert a SAN line to UCI (stops at the first illegal move). */
export function sanLineToUci(fen: string, sans: readonly string[]): { uci: string[]; fens: string[] } {
  const uci: string[] = [];
  const fens: string[] = [];
  let cur = fen;
  for (const s of sans) {
    const m = playSan(cur, s);
    if (!m) break;
    uci.push(m.uci);
    fens.push(m.fenAfter);
    cur = m.fenAfter;
  }
  return { uci, fens };
}

/** Convert a UCI line to SAN (stops at the first illegal move). */
export function uciLineToSan(fen: string, ucis: readonly string[]): string[] {
  const out: string[] = [];
  let cur = fen;
  for (const u of ucis) {
    const m = playUci(cur, u);
    if (!m) break;
    out.push(m.san);
    cur = m.fenAfter;
  }
  return out;
}

export function sideToMove(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

export function fullmoveNumber(fen: string): number {
  const n = Number(fen.split(' ')[5]);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** "12." for White's move, "12..." for Black's, from the FEN before the move. */
export function moveNumberLabel(fenBefore: string): string {
  const n = fullmoveNumber(fenBefore);
  return sideToMove(fenBefore) === 'white' ? `${n}.` : `${n}...`;
}

export function isCheck(fen: string): boolean {
  return tryPosition(fen)?.isCheck() ?? false;
}

export function isCheckmate(fen: string): boolean {
  return tryPosition(fen)?.isCheckmate() ?? false;
}

export function isStalemate(fen: string): boolean {
  return tryPosition(fen)?.isStalemate() ?? false;
}

/** Legal destinations in chessground format. */
export function legalDests(fen: string): Map<SquareName, SquareName[]> {
  const pos = tryPosition(fen);
  return pos ? chessgroundDests(pos) : new Map();
}

/** True if moving from->to is a pawn reaching the last rank (needs a promotion piece). */
export function needsPromotion(fen: string, from: string, to: string): boolean {
  const pos = tryPosition(fen);
  const f = parseSquare(from);
  const t = parseSquare(to);
  if (!pos || f === undefined || t === undefined) return false;
  const piece = pos.board.get(f);
  if (!piece || piece.role !== 'pawn') return false;
  const rank = t >> 3;
  return rank === 0 || rank === 7;
}

/** [from, to] squares for highlighting a UCI move (castling shown as king-to-square). */
export function uciSquares(uci: string): [SquareName, SquareName] | null {
  const m = parseUci(uci);
  if (!m || !('from' in m)) return null;
  return [makeSquare(m.from), makeSquare((m as NormalMove).to)];
}

export const PIECE_VALUE: Record<PieceRole, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };

/** Material balance (White minus Black) in pawns. */
export function materialBalance(fen: string): number {
  const pos = tryPosition(fen);
  if (!pos) return 0;
  let sum = 0;
  for (const sq of pos.board.occupied) {
    const p = pos.board.get(sq)!;
    sum += (p.color === 'white' ? 1 : -1) * PIECE_VALUE[p.role];
  }
  return sum;
}
