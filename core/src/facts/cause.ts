// (Why round) Why a bad move is bad when no tactic explains it — read from the move's own engine line.
//
// The explanation of a bad move used to come from the best move ("c3 was much better"), which says nothing when
// several moves are about as good: then the best move isn't special, the played move is the odd one out, and its
// own line shows what goes wrong. Pure (no engine): board + the PV that analyzeMove already has.
//
//  - `loosensFact`: the move takes its protection away from one of the mover's pieces or pawns (the moved piece
//    defended it, nothing else does any more, or the opponent can now win it), and within LOOSENS_PLIES of the
//    move's PV an opponent piece attacks exactly that target while it is short of defenders. Told with the
//    attacker's route ("…Nh6, …Nf5"), the mover's answer in the line (a king walk that gives up castling, a piece
//    that defends it, the target stepping away) and whether the line then wins it (taken by the opponent and the
//    mover ends material down at a quiet point).
//    6.f3? (Black's knight heads for f5 to hit g3, which the f2 pawn defended — White's king has to come to f2).
//  - `tradesDownFact`: within TRADE_PLIES of the PV the queens come off (or every piece but the pawns), material
//    stays level, the best move's line keeps them on, and the eval after the move says the ending is lost, only a
//    draw where the mover was winning, or clearly worse. 41.Qe3+? Qxe3+ Kxe3 (lost pawn ending).
//  - `fineAlternatives`: other deep candidates about as good as the best move — "c3, d3 or a3 all keep the
//    balance" tells that the played move itself is the problem.

import type { Color, Fact, PieceRef } from '@chess-coach/shared';
import { makeSan } from 'chessops/san';
import { SquareSet } from 'chessops';
import type { Chess } from 'chessops/chess';
import { attackersOf, attacksFrom, defendersOf, toPieceRef } from '../chess/attacks';
import { PIECE_VALUES, lineMaterial, positionFromFen } from '../chess/material';
import { legalMove } from '../chess/notation';
import { hangingLoss } from '../chess/see';

const other = (c: Color): Color => (c === 'white' ? 'black' : 'white');
type F<T extends Fact['type']> = Extract<Fact, { type: T }>;

/** Plies of the played move's PV (after the move) searched for the opponent going after a loosened target. */
export const LOOSENS_PLIES = 10;
/** The target counts as won when the line takes it within this many plies and the mover is this much down. */
export const LOOSENS_WON_PLIES = 14;
/** Plies of the PV (the move included) within which a trade must take the queens / pieces off. */
export const TRADE_PLIES = 5;

interface Ply {
  /** 0-based PV index. */
  i: number;
  color: Color;
  san: string;
  from: number;
  to: number;
  role: PieceRef['role'];
  capture: boolean;
  /** Role of the captured piece. */
  captured?: PieceRef['role'];
  /** Position after the ply. */
  pos: Chess;
}

/** Play the PV from `fen` (legal prefix only), with the position after each ply. */
function plies(fen: string, pv: readonly string[], max: number): Ply[] {
  const pos = positionFromFen(fen);
  const out: Ply[] = [];
  for (const [i, u] of pv.slice(0, max).entries()) {
    const mv = legalMove(pos, u);
    if (!mv) break;
    const piece = pos.board.get(mv.from)!;
    const victim = pos.board.get(mv.to);
    const capture = !!victim || (piece.role === 'pawn' && mv.to === pos.epSquare);
    const san = makeSan(pos, mv);
    pos.play(mv);
    out.push({ i, color: piece.color, san, from: mv.from, to: mv.to, role: piece.role, capture, ...(capture ? { captured: victim?.role ?? 'pawn' } : {}), pos: pos.clone() });
    if (pos.isEnd()) break;
  }
  return out;
}

const canCastle = (pos: Chess, color: Color): boolean => pos.castles.castlingRights.intersect(SquareSet.fromRank(color === 'white' ? 0 : 7)).nonEmpty();

/**
 * Own pieces (king excluded) that the moved piece defended before the move and doesn't from its new square, and
 * that are left with no defender or with fewer defenders than attackers.
 */
function loosenedBy(fenBefore: string, uci: string): { target: number; moved: PieceRef; undefended: boolean }[] {
  const before = positionFromFen(fenBefore);
  const mv = legalMove(before, uci);
  if (!mv) return [];
  const piece = before.board.get(mv.from)!;
  const mover = piece.color;
  const after = before.clone();
  after.play(mv);
  const own = after.board[mover].diff(after.board.king);
  const wasDefended = attacksFrom(before.board, mv.from).intersect(before.board[mover]);
  const stillDefended = after.board.get(mv.to)?.color === mover ? attacksFrom(after.board, mv.to) : null;
  const out: { target: number; moved: PieceRef; undefended: boolean }[] = [];
  for (const sq of wasDefended) {
    if (sq === mv.to || !own.has(sq) || stillDefended?.has(sq)) continue;
    const was = before.board.get(sq);
    const now = after.board.get(sq);
    if (!was || !now || was.role !== now.role || was.color !== now.color) continue;
    const defenders = defendersOf(after.board, sq).size();
    const attackers = attackersOf(after.board, sq, other(mover)).size();
    if (defenders === 0 || attackers > defenders) out.push({ target: sq, moved: toPieceRef(piece, mv.from), undefended: defenders === 0 });
  }
  // the most valuable first
  return out.sort((a, b) => PIECE_VALUES[after.board.get(b.target)!.role] - PIECE_VALUES[after.board.get(a.target)!.role]);
}

/**
 * The move loosens one of the mover's pieces and its engine line goes after it (see the file header). `pv` is the
 * played move's legal PV, starting with the move.
 */
export function loosensFact(fenBefore: string, pv: readonly string[]): F<'loosens'> | null {
  if (pv.length < 3) return null;
  const loose = loosenedBy(fenBefore, pv[0]!);
  if (!loose.length) return null;
  const line = plies(fenBefore, pv, Math.max(LOOSENS_PLIES, LOOSENS_WON_PLIES) + 1);
  if (line.length < 3) return null;
  const mover = line[0]!.color;
  const opp = other(mover);
  const startCastle = canCastle(positionFromFen(fenBefore), mover);
  for (const { target: t0, moved, undefended } of loose) {
    let target = t0;
    // the opponent's pieces' routes: square -> SAN of the moves that brought the piece there
    const routes = new Map<number, string[]>();
    for (const p of line.slice(1, LOOSENS_PLIES + 1)) {
      if (p.color === mover) {
        if (p.from === target) target = p.to; // the target steps away before it is attacked: follow it
        if (p.capture) routes.delete(p.to);
        continue;
      }
      const route = [...(routes.get(p.from) ?? []), p.san];
      routes.delete(p.from);
      routes.set(p.to, route);
      if (p.to === target) break; // taken before it was ever "attacked": that is a plain hang, told elsewhere
      const tp = p.pos.board.get(target);
      if (!tp || tp.color !== mover) break;
      if (!attacksFrom(p.pos.board, p.to).has(target)) continue;
      // under real pressure: no defender, or more attackers than defenders
      const atk = attackersOf(p.pos.board, target, opp).size();
      const def = defendersOf(p.pos.board, target).size();
      if (def > 0 && atk <= def && hangingLoss(p.pos, target) <= 0) continue;
      const fact: F<'loosens'> = {
        type: 'loosens',
        moved,
        target: toPieceRef(tp, target),
        ...(undefended ? { undefended: true } : {}),
        attacker: toPieceRef(p.pos.board.get(p.to)!, p.to),
        route,
      };
      const reply = line[p.i + 1];
      if (reply && reply.color === mover) {
        const defends = attacksFrom(reply.pos.board, reply.to).has(target);
        if (reply.role === 'king' && Math.abs(reply.to - reply.from) !== 2 && defends) {
          fact.answer = { san: reply.san, how: 'king' };
          if (startCastle && !canCastle(reply.pos, mover)) fact.castlingLost = true;
        } else if (reply.from === target) fact.answer = { san: reply.san, how: 'moves-away' };
        else if (defends && reply.to !== target) fact.answer = { san: reply.san, how: 'defends' };
      }
      // won: the opponent takes it on its square later in the line, and the mover is down at a quiet point
      const taken = line.slice(p.i + 1, LOOSENS_WON_PLIES + 1).some((q) => q.color === opp && q.capture && q.to === target);
      if (taken) {
        const m = lineMaterial(fenBefore, pv, { horizonPlies: Math.min(pv.length, LOOSENS_WON_PLIES) });
        if (m.quiet && m.delta <= -1) fact.won = true;
      }
      // a piece that is hit and simply steps away (or takes the attacker) was only chased, not exploited
      if (fact.answer?.how === 'moves-away' && !fact.won) break;
      return fact;
    }
  }
  return null;
}

const queensOn = (pos: Chess): boolean => pos.board.queen.nonEmpty();
const piecesOn = (pos: Chess): number => pos.board.occupied.diff(pos.board.pawn).diff(pos.board.king).size();

/**
 * The move's line trades the queens (or every piece) off at once, material level, into an ending that is lost / only
 * a draw / clearly worse — while the best move's line keeps them on. Win% are the mover's.
 */
export function tradesDownFact(input: { fenBefore: string; pv: readonly string[]; bestPv: readonly string[]; winBest: number; winPlayed: number }): F<'trades-down'> | null {
  const start = positionFromFen(input.fenBefore);
  const line = plies(input.fenBefore, input.pv, TRADE_PLIES + 1);
  const bestLine = plies(input.fenBefore, input.bestPv, TRADE_PLIES + 1);
  const at = (l: Ply[], test: (p: Chess) => boolean): number => l.findIndex((p) => test(p.pos));
  let trade: F<'trades-down'>['trade'] | null = null;
  let k = -1;
  // a pawn ending reached by the trade (pieces were on before)
  if (piecesOn(start) > 0) {
    k = at(line, (p) => piecesOn(p) === 0);
    if (k >= 0 && at(bestLine, (p) => piecesOn(p) === 0) < 0) trade = 'pieces';
  }
  if (!trade && queensOn(start) && start.board.queen.intersect(start.board.white).nonEmpty() && start.board.queen.intersect(start.board.black).nonEmpty()) {
    k = at(line, (p) => !queensOn(p));
    // a plain trade: a queen takes the other queen and is taken back on that square at once
    const plain = k >= 1 && line[k]!.capture && line[k - 1]!.capture && line[k - 1]!.role === 'queen' && line[k - 1]!.captured === 'queen' && line[k]!.captured === 'queen' && line[k]!.to === line[k - 1]!.to;
    // …and nothing else changes hands between the move and the trade
    const clean = plain && line.slice(1, k - 1).every((q) => !q.capture);
    if (clean && at(bestLine, (p) => !queensOn(p)) < 0) trade = 'queens';
  }
  if (!trade || k < 1) return null;
  // the trade is complete (no recapture pending) and material is level against the start
  let end = k;
  while (end + 1 < line.length && line[end + 1]!.capture && end + 1 <= TRADE_PLIES) end++;
  const m = lineMaterial(input.fenBefore, input.pv, { horizonPlies: end + 1 });
  if (!m.quiet || Math.abs(m.delta) > 1) return null;
  const { winBest, winPlayed } = input;
  const verdict: F<'trades-down'>['verdict'] | null =
    winPlayed <= 15 && winBest >= 30 ? 'lost' : winBest >= 70 && winPlayed >= 30 && winPlayed <= 62 ? 'draw' : winBest - winPlayed >= 15 ? 'worse' : null;
  if (!verdict) return null;
  const endPos = line[end]!.pos;
  const ending: F<'trades-down'>['ending'] = piecesOn(endPos) === 0 ? 'pawn' : 'other';
  return { type: 'trades-down', trade, ending, verdict, line: line.slice(0, end + 1).map((p) => p.san) };
}

/**
 * Other moves about as good as the best one (deep candidates, winLoss vs the best <= `margin`): the played move is
 * the odd one out. Up to `max` SAN, best first, the played move excluded. Empty when the best move stands alone.
 */
export function fineAlternatives(cands: readonly { san: string; uci: string; winLoss: number }[], playedUci: string, playedWinLoss: number, max = 3): string[] {
  const margin = Math.min(3, Math.max(1.5, playedWinLoss / 5));
  const fine = cands.filter((c) => c.uci !== playedUci && c.winLoss <= margin);
  return fine.length >= 2 ? fine.slice(0, max).map((c) => c.san) : [];
}
