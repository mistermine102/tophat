// Brilliant !! the way chess.com gives it: "a good piece sacrifice" — the best or nearly best move, which leaves one of
// your pieces (not a pawn) en prise, while you are not worse after it and were not completely winning anyway
// (support.chess.com/en/articles/8572705, "How are moves classified?"). chess.com doesn't publish the details; this is
// the static piece-safety model of WintrChess (github.com/WintrCat/wintrchess, GPL-3.0, shared/src/lib/reporter:
// classification/brilliant.ts, utils/pieceSafety.ts, attackers.ts, defenders.ts, dangerLevels.ts, pieceTrapped.ts),
// the open re-implementation of chess.com's Game Review classifications, ported to chessops.
//
// What counts as a sacrifice is judged on the board, not by the engine line: a piece is "unsafe" when a cheaper piece
// attacks it, or it has more attackers than defenders (x-ray batteries included) without the exceptions below. The
// line doesn't have to lose the material: a sacrifice the opponent mustn't accept (taking it loses) is the classic
// chess.com Brilliant, and so is one whose material comes back later.
//
// staticSacrifice(fen, uci) is the board half: the move leaves an unsafe piece (worth more than what it captured),
//  - not moving a piece to safety (fewer unsafe pieces than before, unless the move gives check),
//  - not a mere counter-threat: when every capture of every unsafe piece leaves the capturer's own equal-or-bigger
//    piece en prise (or allows mate in one), it's a trade of threats, no sacrifice ("danger levels"),
//  - not a piece that is lost anyway: not when every unsafe piece is trapped, the moved piece was trapped before, or
//    fewer pieces are trapped than before (the move rescued one);
//  - (ours, not WintrChess') a real offer: taking it wins material by static exchange, more than the move captured —
//    so an even trade on an x-rayed square (Qxe8+ Qxe8 Rxe8+ Rxe8) is no sacrifice;
//  - (ours) offered by this move: the moved piece, a piece the move leaves unprotected / uncovers, or one the
//    opponent's last move attacked (ignoring a fresh threat for something stronger is the classic offer). A piece
//    that was already en prise before the opponent's last move too (or, without that move, before this one) was
//    simply left hanging: Ra7 with the b6 bishop hanging to …Nxb6 for moves already offers nothing new.
// The engine half (best or near best, not worse after, not completely winning anyway, no promotion, not out of
// check, no take-back) is classify.ts `brilliantSacrifice`.

import type { Color, Role, Square } from 'chessops';
import { Chess, normalizeMove } from 'chessops/chess';
import { attacks, kingAttacks } from 'chessops/attacks';
import { makeSquare, opposite, parseUci } from 'chessops/util';
import type { NormalMove } from 'chessops/types';
import type { PieceRef } from '@chess-coach/shared';
import { positionFromFen } from '../chess/material';
import { hangingLoss } from '../chess/see';

const VALUE: Readonly<Record<Role, number>> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: Infinity };

interface BoardPiece {
  role: Role;
  color: Color;
  square: Square;
}

interface RawMove {
  from: Square;
  to: Square;
  role: Role;
  color: Color;
}

const sameMove = (a: RawMove, b: RawMove) => a.from === b.from && a.to === b.to && a.role === b.role && a.color === b.color;

/** `pos` with `turn` to move (null when that position is illegal, e.g. the other side is in check). */
function withTurn(pos: Chess, turn: Color): Chess | null {
  if (pos.turn === turn) return pos.clone();
  const setup = pos.toSetup();
  const r = Chess.fromSetup({ ...setup, turn, epSquare: undefined });
  return r.isOk ? r.value : null;
}

/** The move as chessops plays it (a pawn reaching the last rank promotes to a queen). */
function toMove(pos: Chess, m: RawMove): NormalMove {
  const lastRank = m.to >> 3 === 0 || m.to >> 3 === 7;
  return m.role === 'pawn' && lastRank ? { from: m.from, to: m.to, promotion: 'queen' } : { from: m.from, to: m.to };
}

/** The opponent's legal captures of `piece` (and their king, if it touches the square, even when it can't legally take). */
function directAttackingMoves(pos: Chess, piece: BoardPiece): RawMove[] {
  const enemy = opposite(piece.color);
  const out: RawMove[] = [];
  const p = withTurn(pos, enemy);
  if (p) {
    for (const from of p.board[enemy]) {
      if (p.dests(from).has(piece.square)) out.push({ from, to: piece.square, role: p.board.getRole(from)!, color: enemy });
    }
  } else {
    for (const from of pos.board[enemy]) {
      const pc = pos.board.get(from)!;
      if (pc.role !== 'king' && attacks(pc, from, pos.board.occupied).has(piece.square)) out.push({ from, to: piece.square, role: pc.role, color: enemy });
    }
  }
  const k = pos.board.kingOf(enemy);
  if (k !== undefined && !out.some((m) => m.role === 'king') && kingAttacks(k).has(piece.square)) out.push({ from: k, to: piece.square, role: 'king', color: enemy });
  return out;
}

/** Captures of `piece`, with `transitive` the pieces behind them in a battery too (x-rays). */
function attackingMoves(pos: Chess, piece: BoardPiece, transitive = true): RawMove[] {
  const moves = directAttackingMoves(pos, piece);
  if (!transitive) return moves;
  const frontier = moves.map((m) => ({ pos, square: m.from, role: m.role }));
  while (frontier.length) {
    const f = frontier.pop()!;
    if (f.role === 'king') continue; // a king is never at the front of a battery
    const old = directAttackingMoves(f.pos, piece).filter((m) => m.from !== f.square);
    const next = f.pos.clone();
    next.board.take(f.square);
    const now = directAttackingMoves(next, piece);
    const revealed = [...old.filter((a) => !now.some((b) => sameMove(a, b))), ...now.filter((b) => !old.some((a) => sameMove(a, b)))];
    moves.push(...revealed);
    frontier.push(...revealed.map((m) => ({ pos: next, square: m.from, role: m.role })));
  }
  return moves;
}

/** The defenders of `piece`: the fewest recaptures after any capture of it; when it isn't attacked, its own pieces that cover its square. */
function defendingMoves(pos: Chess, piece: BoardPiece, transitive = true): RawMove[] {
  let best: RawMove[] | null = null;
  for (const m of attackingMoves(pos, piece, false)) {
    const p = withTurn(pos, m.color);
    if (!p) continue;
    const mv = toMove(p, m);
    if (!p.isLegal(mv)) continue;
    p.play(mv);
    const rec = attackingMoves(p, { role: m.role, color: m.color, square: m.to }, transitive);
    if (!best || rec.length < best.length) best = rec;
  }
  if (best) return best;
  const flipped = pos.clone();
  const fp: BoardPiece = { ...piece, color: opposite(piece.color) };
  flipped.board.set(piece.square, { role: fp.role, color: fp.color });
  return attackingMoves(flipped, fp, transitive);
}

/** Is `piece` safe where it stands? `captured`: what the move that just put it there took. */
function isPieceSafe(pos: Chess, piece: BoardPiece, captured?: Role): boolean {
  const direct = attackingMoves(pos, piece, false);
  const attackers = attackingMoves(pos, piece);
  const defenders = defendingMoves(pos, piece);
  // a favourable "decimal" sacrifice (a rook for two minor pieces) is safe
  if (captured && piece.role === 'rook' && VALUE[captured] === VALUE.knight && attackers.length === 1 && defenders.length > 0 && VALUE[attackers[0]!.role] === VALUE.knight) return true;
  // attacked by something cheaper: unsafe
  if (direct.some((a) => VALUE[a.role] < VALUE[piece.role])) return false;
  // no more attackers than defenders: safe
  if (attackers.length <= defenders.length) return true;
  const lowest = direct.reduce<RawMove | null>((lo, a) => (!lo || VALUE[a.role] < VALUE[lo.role] ? a : lo), null);
  if (!lowest) return true;
  // cheaper than every attacker, and a defender cheaper than every attacker: safe
  if (VALUE[piece.role] < VALUE[lowest.role] && defenders.some((d) => VALUE[d.role] < VALUE[lowest.role])) return true;
  // defended by a pawn: safe
  return defenders.some((d) => d.role === 'pawn');
}

/** `color`'s unsafe pieces (not pawns or the king; worth more than `captured`, what the last move took). */
function unsafePieces(pos: Chess, color: Color, captured?: Role): BoardPiece[] {
  const capturedValue = captured ? VALUE[captured] : 0;
  const out: BoardPiece[] = [];
  for (const square of pos.board[color]) {
    const role = pos.board.getRole(square)!;
    if (role === 'pawn' || role === 'king' || VALUE[role] <= capturedValue) continue;
    const piece = { role, color, square };
    if (!isPieceSafe(pos, piece, captured)) out.push(piece);
  }
  return out;
}

/** Captures of `color`'s unsafe pieces worth at least `threatened` (other than it). */
function relativeUnsafePieceAttacks(pos: Chess, threatened: BoardPiece, color: Color, captured?: Role): RawMove[] {
  return unsafePieces(pos, color, captured)
    .filter((u) => u.square !== threatened.square && VALUE[u.role] >= VALUE[threatened.role])
    .flatMap((u) => attackingMoves(pos, u, false));
}

/** After `p`'s last move: can the side to move mate in one? */
function mateInOne(p: Chess): boolean {
  for (const [from, dests] of p.allDests()) {
    for (const to of dests) {
      const q = p.clone();
      const promo = q.board.pawn.has(from) && (to >> 3 === 0 || to >> 3 === 7);
      q.play(promo ? { from, to, promotion: 'queen' } : { from, to });
      if (q.isCheckmate()) return true;
    }
  }
  return false;
}

/** Does `acting` (by the side to move) create a new threat against its own pieces worth at least `threatened`, or allow mate in one? */
function moveCreatesGreaterThreat(pos: Chess, threatened: BoardPiece, acting: RawMove): boolean {
  if (pos.turn !== acting.color) return false;
  const mv = toMove(pos, acting);
  if (!pos.isLegal(mv)) return false;
  const before = relativeUnsafePieceAttacks(pos, threatened, acting.color);
  const p = pos.clone();
  const captured = p.board.getRole(acting.to);
  p.play(mv);
  const after = relativeUnsafePieceAttacks(p, threatened, acting.color, captured);
  if (after.some((a) => !before.some((b) => sameMove(a, b)))) return true;
  return VALUE[threatened.role] < VALUE.queen && mateInOne(p);
}

/** After `acting` (by the side to move), are its own pieces worth at least `threatened` left en prise, or is there mate in one? */
function moveLeavesGreaterThreat(pos: Chess, threatened: BoardPiece, acting: RawMove): boolean {
  if (pos.turn !== acting.color) return false;
  const mv = toMove(pos, acting);
  if (!pos.isLegal(mv)) return false;
  const p = pos.clone();
  p.play(mv);
  if (relativeUnsafePieceAttacks(p, threatened, acting.color).length > 0) return true;
  return VALUE[threatened.role] < VALUE.queen && mateInOne(p);
}

/** Every capture of `threatened` leaves the capturer an equal or bigger problem (a trade of threats, no sacrifice). */
function hasDangerLevels(pos: Chess, threatened: BoardPiece, acting: RawMove[]): boolean {
  return acting.every((m) => moveLeavesGreaterThreat(pos, threatened, m));
}

/** Unsafe where it stands and on every square it can go to (or going there allows a bigger threat). */
function isPieceTrapped(pos: Chess, piece: BoardPiece): boolean {
  const p = withTurn(pos, piece.color);
  if (!p) return false;
  if (isPieceSafe(p, piece)) return false;
  for (const to of p.dests(piece.square)) {
    const m: RawMove = { from: piece.square, to, role: piece.role, color: piece.color };
    if (moveCreatesGreaterThreat(p, piece, m)) continue;
    const q = p.clone();
    const captured = q.board.getRole(to);
    q.play(toMove(q, m));
    if (isPieceSafe(q, { ...piece, square: to }, captured)) return false;
  }
  return true;
}

/** Why a move is no sacrifice on the board (for the benchmark's near-misses). */
export type StaticReject = 'promotion' | 'no-unsafe-piece' | 'to-safety' | 'danger-levels' | 'trapped' | 'even-exchange' | 'already-hanging';

/**
 * The board half of chess.com's Brilliant: does the move `uci` in `fen` sacrifice a piece? Returns the most valuable
 * piece it leaves en prise (that isn't simply trapped), or why not.
 */
export function staticSacrifice(fen: string, uci: string, prevFenBefore?: string | null): { piece: PieceRef; value: number } | { reject: StaticReject } {
  const before = positionFromFen(fen);
  const parsed = parseUci(uci);
  if (!parsed || !('from' in parsed)) return { reject: 'no-unsafe-piece' };
  const move = normalizeMove(before, parsed) as NormalMove;
  if (move.promotion) return { reject: 'promotion' };
  const mover = before.turn;
  // (castling is king-takes-own-rook in chessops: no capture)
  const target = before.board.get(move.to);
  const captured = target && target.color !== mover ? target.role : before.board.pawn.has(move.from) && (move.from & 7) !== (move.to & 7) ? 'pawn' : undefined;
  const after = before.clone();
  after.play(move);
  const prevUnsafe = unsafePieces(before, mover);
  const unsafe = unsafePieces(after, mover, captured);
  if (!unsafe.length) return { reject: 'no-unsafe-piece' };
  if (!after.isCheck() && unsafe.length < prevUnsafe.length) return { reject: 'to-safety' };
  if (unsafe.every((u) => hasDangerLevels(after, u, attackingMoves(after, u, false)))) return { reject: 'danger-levels' };
  const prevTrapped = prevUnsafe.filter((u) => isPieceTrapped(before, u));
  const trapped = unsafe.filter((u) => isPieceTrapped(after, u));
  if (trapped.length === unsafe.length || prevTrapped.some((t) => t.square === move.from) || trapped.length < prevTrapped.length) return { reject: 'trapped' };
  // (our addition) the offer must cost material by static exchange, more than the move took: the piece-count test
  // above also flags an even trade on a square x-rayed from behind (Qxe8+ Qxe8 Rxe8+ Rxe8), which gives nothing up
  const capturedValue = captured ? VALUE[captured] : 0;
  const real = unsafe.filter((u) => !trapped.includes(u) && hangingLoss(after, u.square) > capturedValue);
  if (!real.length) return { reject: 'even-exchange' };
  // offered by this move (or a fresh threat ignored), not a piece that was left hanging already
  const prev = prevFenBefore ? positionFromFen(prevFenBefore) : null;
  const unsafeAt = (pos: Chess, sq: Square, role: Role) => {
    const p = pos.board.get(sq);
    return !!p && p.color === mover && p.role === role && unsafePieces(pos, mover).some((u) => u.square === sq);
  };
  const stale = (u: BoardPiece) => u.square !== move.to && unsafeAt(before, u.square, u.role) && (!prev || unsafeAt(prev, u.square, u.role));
  const offered = real.filter((u) => !stale(u)).sort((a, b) => VALUE[b.role] - VALUE[a.role])[0];
  if (!offered) return { reject: 'already-hanging' };
  return { piece: { role: offered.role, square: makeSquare(offered.square), color: offered.color }, value: VALUE[offered.role] - (captured ? VALUE[captured] : 0) };
}
