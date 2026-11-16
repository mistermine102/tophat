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
/** Plies of the played move's PV (the move included) in which the moved piece can be chased. */
export const CHASE_PLIES = 8;
/** Plies of the PV (after the move) within which an opponent pawn running to the 7th rank counts. */
export const PASSER_PLIES = 8;

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
      // (Feedback round 3) the attack comes with a capture of a piece (Rxd7 taking a bishop, not a recapture): that
      // capture is the story, not the loose pawn it then also hits
      const prevPly = line[p.i - 1];
      if (p.capture && p.captured !== 'pawn' && !(prevPly?.capture && prevPly.to === p.to)) break;
      // …nor when it takes the moved piece itself (d5? Qxd5 "attacking e5": the pawn on d5 is simply lost)
      if (p.capture && p.to === line[0]!.to) break;
      // an attacker the mover takes at once (b4 cxb4 cxb4) attacked nothing for long: look for the next one
      const reply0 = line[p.i + 1];
      if (reply0 && reply0.color === mover && reply0.capture && reply0.to === p.to) continue;
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

/**
 * (Feedback round 3) The moved piece gets chased: within CHASE_PLIES of the move's PV, an opponent piece worth less
 * attacks it (or it is simply en prise) and the mover's next move in the line steps it away — the opponent gains
 * time. The first hit must come with the opponent's first or second move. 3.Qf3?! Bg4 4.Qg3 Bd6 5.Qh4.
 * Pawn and king moves and captures are skipped (a capture's piece being hit is a trade question, not lost time).
 */
export function chasedFact(fenBefore: string, pv: readonly string[]): F<'chased'> | null {
  const line = plies(fenBefore, pv, CHASE_PLIES + 1);
  const first = line[0];
  if (!first || line.length < 3 || first.role === 'pawn' || first.role === 'king' || first.capture) return null;
  const mover = first.color;
  let sq = first.to;
  const hits: F<'chased'>['hits'] = [];
  for (let k = 1; k + 1 < line.length; k++) {
    const p = line[k]!;
    if (p.color === mover) {
      if (p.from === sq) sq = p.to;
      continue;
    }
    if (p.to === sq) break; // taken: a hang, told elsewhere
    const piece = p.pos.board.get(sq);
    if (!piece || piece.color !== mover) break;
    // a king walking up to a piece (after its check: Re7+ Kf8) gains no time
    if (p.role === 'king' || !attacksFrom(p.pos.board, p.to).has(sq)) continue;
    if (!(PIECE_VALUES[p.role] < PIECE_VALUES[piece.role]) && hangingLoss(p.pos, sq) <= 0) continue;
    const reply = line[k + 1]!;
    // it has to step away (taking the attacker, or anything else, is no lost time)
    if (reply.from !== sq || reply.capture) break;
    if (!hits.length && k > 3) break;
    hits.push({ attack: p.san, retreat: reply.san });
    sq = reply.to;
    k++;
  }
  if (!hits.length) return null;
  return { type: 'chased', piece: toPieceRef({ role: first.role, color: mover }, first.to), hits };
}

/** A pawn of `color` on `sq` with no enemy pawn in front of it on its own or an adjacent file. */
function isPassed(pos: Chess, sq: number, color: Color): boolean {
  const file = sq & 7;
  const rank = sq >> 3;
  for (const s of pos.board.pawn.intersect(pos.board[other(color)])) {
    if (Math.abs((s & 7) - file) > 1) continue;
    if (color === 'white' ? s >> 3 > rank : s >> 3 < rank) return false;
  }
  return true;
}

/**
 * (Feedback round 3) The move's line lets an opponent pawn run: within PASSER_PLIES an opponent passed pawn reaches
 * the square in front of promotion (or promotes), while the best move's line has no such pawn. 12...Nxa2? Ba5 Qc8
 * cxb6 Rb8 b7 — White's pawn stands on b7. `line` = SAN of the PV after the move up to the pawn's arrival.
 */
export function passerFact(fenBefore: string, pv: readonly string[], bestPv: readonly string[]): F<'passer'> | null {
  const runs = (moves: readonly string[]) => {
    const line = plies(fenBefore, moves, PASSER_PLIES + 1);
    const mover = line[0]?.color;
    for (const p of line.slice(1)) {
      if (p.color === mover || p.role !== 'pawn') continue;
      const rank = p.to >> 3;
      const near = p.color === 'white' ? rank >= 6 : rank <= 1;
      if (!near) continue;
      const now = p.pos.board.get(p.to);
      if (now?.role !== 'pawn' && rank !== 7 && rank !== 0) continue;
      if (now?.role === 'pawn' && !isPassed(p.pos, p.to, p.color)) continue;
      return { p, line };
    }
    return null;
  };
  const r = runs(pv);
  if (!r || runs(bestPv)) return null;
  const promoted = r.p.pos.board.get(r.p.to)?.role !== 'pawn';
  return {
    type: 'passer',
    pawn: { role: 'pawn', square: squareOf(r.p.to), color: r.p.color },
    ...(promoted ? { promotes: true } : {}),
    line: r.line.slice(1, r.p.i + 1).map((q) => q.san),
  };
}

const squareOf = (sq: number): string => 'abcdefgh'[sq & 7]! + String((sq >> 3) + 1);

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

/** Plies of the game (fullmove number) up to which an undeveloped-pieces cause is told. */
export const UNDEVELOPED_MAX_MOVE = 12;

const MINOR_HOMES: Record<Color, string[]> = { white: ['b1', 'c1', 'f1', 'g1'], black: ['b8', 'c8', 'f8', 'g8'] };
const HOME_ROLE: Record<string, PieceRef['role']> = { b: 'knight', g: 'knight', c: 'bishop', f: 'bishop' };

/** The mover's knights and bishops still on their starting squares. */
function minorsAtHome(pos: Chess, color: Color): string[] {
  return MINOR_HOMES[color].filter((s) => {
    const p = pos.board.get(parseSquareName(s));
    return p?.color === color && p.role === HOME_ROLE[s[0]!];
  });
}

const parseSquareName = (s: string): number => 'abcdefgh'.indexOf(s[0]!) + 8 * (Number(s[1]) - 1);

/**
 * (Feedback round 3) An opening move that brings no piece out while the mover has >= 2 minor pieces at home and
 * moves about as good as the best one do (a knight or bishop leaving its starting square, or castling).
 * 4.g3?! with Nc3 / Bd2 at hand. `fine` = SAN/UCI of the moves that were better (best first).
 */
export function undevelopedFact(fenBefore: string, uci: string, better: readonly { san: string; uci: string }[]): F<'undeveloped'> | null {
  const pos = positionFromFen(fenBefore);
  if (pos.fullmoves > UNDEVELOPED_MAX_MOVE) return null;
  const color = pos.turn;
  const home = minorsAtHome(pos, color);
  if (home.length < 2) return null;
  const develops = (u: string) => {
    const from = u.slice(0, 2);
    return home.includes(from) || (pos.board.get(parseSquareName(from))?.role === 'king' && Math.abs(parseSquareName(u.slice(2, 4)) - parseSquareName(from)) >= 2);
  };
  if (develops(uci)) return null;
  const moves = better.filter((m) => develops(m.uci)).map((m) => m.san);
  if (!moves.length) return null;
  return { type: 'undeveloped', home: home.length, moves };
}
