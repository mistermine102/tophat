// Short-term level: narration of an engine principal variation, opponent-reply forcedness, the null-move threat
// fact and the refutation ('allows') fact of a bad move. Pure functions — engine results are passed in
// (analysis/analyzeMove.ts runs the searches).
//
// Definitions
// - Quiet point (`isStable` + not in check): no piece of either side can be won by SEE — the material count is
//   not about to change. Material is only ever claimed at a quiet point (or after resolving a pending recapture
//   with SEE, see "Line fact").
// - Narrated plies (`narrationPlies`): the line tells the story of the move up to its payoff and stops there.
//   It ends at the first quiet point after at least `explain.shortLineMinPlies` plies (the move and the reply)
//   whose next PV ply is not forcing (a capture, check, promotion, fork, skewer or discovered attack), looking
//   up to `explain.shortLineMaxPlies` plies — and, if the line is still tactical there, on to the first quiet
//   point within `material.quietHorizonPlies` plies. A line that never gets fully quiet ends at its first
//   settled capture (`isSettled`: after a capture or promotion, the side to move can't win anything back right
//   now — e.g. Qxb7 that also hits the rook on a8). Stop points where the material swing goes against the
//   line's deep eval are skipped (3.Bb5 Nf6 4.O-O Nxe4 is quiet, but Re1 / Nxe5 regain the pawn: the story runs
//   on to the regain); if no stop point agrees, the first quiet point is used (a real gambit: the pawn is gone).
//   A checkmate ends the line; a mate score that fits within
//   the maximum is narrated to the mate. `targetDelta` (the material rule's verdict for a played move): when the
//   first quiet point doesn't show that loss yet, the line runs on to the first quiet point (within the horizon)
//   that does, so "what is lost and how" is part of the story.
// - Step facts: `immediateFactsFromPosition` of each step (with the previous ply as `prev`, so recaptures are
//   recognised), filtered to STEP_FACT_TYPES (no negative facts — an engine line's "hanging" piece is a
//   deliberate offer, not a mistake) and capped at MAX_STEP_FACTS per step.
// - Forced reply: an opponent reply at PV index i (odd, i < budget.forcednessPlies, within the narrated plies)
//   is checked only if the replying side is under pressure (`underPressure`: in check, a piece of theirs can be
//   won by SEE, or the mover threatens mate in one). It is forced if it is the only legal move, or if a
//   MultiPV-2 search of the position before it ranks it first and the second-best reply is worse by >=
//   `explain.forcedReplyMinGap` win% (replying side's POV). So the opponent's punishing move after a mistake is
//   never "(forced)" — it answers nothing. `forced-reply.alternatives` = other legal moves (0 = only move).
// - Line fact: `materialDelta` = mover's material change from `fenBefore` (incl. the first move) at the end of
//   the narrated line, a quiet point or a settled capture. Otherwise (the PV ran out mid-exchange): when the only thing en
//   prise is the piece that just captured, the pending recapture is resolved with SEE; otherwise the result is
//   'unclear' and nothing is claimed. `won`/`lost` = the net pieces gained/lost (equal roles cancel; a
//   promotion counts as +promoted piece / -pawn). `result`: 'mate' / 'mated' if the line's deep score is a mate
//   (or a checkmate is reached within the narration; `mateIn` = moves of the mating side), else 'wins-material'
//   (delta >= 1), 'loses-material' (delta <= -1), 'trade' (pieces were captured, net 0), 'quiet', 'unclear'.
// - Threat (`nullMoveFen` + `threatFromSearch`): the mover's best move if the opponent passed. Null move = side
//   to move flipped, en passant cleared; skipped if the move gives check or ends the game. A threat is reported
//   only if it mates (search score is a mate in <= THREAT_MAX_MATE for the mover) or wins material: `lineMaterial` over the threat PV
//   (horizon THREAT_HORIZON plies, extended through captures) gains >= THREAT_MIN_GAIN, and the threat move itself
//   is a capture winning material by SEE or a fork / skewer / discovered attack (a quiet "threat" whose gain
//   comes two moves later is a plan, not a threat). Its own immediate facts (filtered like step facts) are
//   attached.
// - Refutation (`refutationFact`, type 'allows'): the opponent's reply in the move's PV and what it does, from
//   verified facts only: its board facts (ALLOWS_FACT_TYPES; a capture only if it wins material), the mover's
//   pieces it newly puts en prise (`targets`: kept when two or more are attacked at once — a double attack — or
//   when the line really wins the single one), its own null-move threat (verified like any threat), the material
//   the opponent gains in the line (`gain`) and a forced mate against the mover (`mateIn`). Null when the reply
//   does nothing notable.
// - Mate line (`mateLineSan`, M5b): the SAN of a PV that ends in checkmate on the board within the given plies
//   (allowed / missed mates are told with their moves: "Allows a forced mate in 2: Qb8+ Nxb8 Rd8#").
// - Fork shown by the line (`pvFork`, M5b): a move gives check, its piece also attacks an enemy piece worth >= 3,
//   the reply doesn't take that piece or the checking piece, and the next ply the same piece captures the target:
//   a checking fork, even when the board-only fork test (which needs a win against *every* reply) can't confirm it.
// - Prevents (`preventsFact`, M5b prophylaxis): the opponent's best move in the null-move position before the move
//   (what they'd play if the mover passed; null-move score >= PREVENTS_MIN_CP better for them than their best
//   reply after the move) is no longer possible (its square is now occupied by a mover piece, or its path is
//   blocked) or now loses material on its destination by SEE where it didn't before (`covered` — the moved piece,
//   or a mover piece whose line the move opened, now attacks the square). Not for captures of the moved piece's
//   old square (that is an escape), nor in decided positions.

import type { AnalysisSettings, Color, Fact, LineStep, PieceRef, PieceRole, Score } from '@chess-coach/shared';
import { winPercentFromScore } from '@chess-coach/shared';
import { makeFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import { opposite, parseSquare } from 'chessops/util';
import { countLegalMoves, sameMoveUci } from '../analysis/classify';
import { attackersOf, attacksFrom, between, toPieceRef, withTurn } from '../chess/attacks';
import { lineMaterial, PIECE_VALUES, positionFromFen } from '../chess/material';
import { legalMove, legalPrefix, standardUci } from '../chess/notation';
import { capturedBy, hangingLoss, see, seeCaptureWith, seeMove } from '../chess/see';
import type { PvLine, SearchResult } from '../engine/uci';
import { hasMateInOne, immediateFactsFromPosition, sortFacts } from './immediate';

export type LineFact = Extract<Fact, { type: 'line' }>;
export type ThreatFact = Extract<Fact, { type: 'threat' }>;
export type ForcedReplyFact = Extract<Fact, { type: 'forced-reply' }>;
export type AllowsFact = Extract<Fact, { type: 'allows' }>;

type Pos = ReturnType<typeof positionFromFen>;

/** Fact types kept for each narrated step (and for a threat move). */
export const STEP_FACT_TYPES: ReadonlySet<Fact['type']> = new Set<Fact['type']>([
  'checkmate', 'stalemate', 'fork', 'trapped', 'skewer', 'discovered-attack', 'pin', 'attack-pinned', 'capture', 'promotion', 'check', 'attack', 'block-check',
]);
export const MAX_STEP_FACTS = 2;
/** Step facts that make a ply forcing (the story goes on through it). */
const FORCING_FACT_TYPES: ReadonlySet<Fact['type']> = new Set<Fact['type']>(['checkmate', 'fork', 'skewer', 'discovered-attack']);
/** Board facts of the opponent's reply that make it a refutation worth naming. */
export const ALLOWS_FACT_TYPES: ReadonlySet<Fact['type']> = new Set<Fact['type']>([
  'checkmate', 'fork', 'skewer', 'discovered-attack', 'pin', 'capture', 'promotion', 'check',
]);
/** Threat line plies measured for the material gain (threat move, reply, follow-up; extended through captures). */
export const THREAT_HORIZON = 3;
/** Minimum material gain (pawns) of a non-mating threat. */
export const THREAT_MIN_GAIN = 1;
/** Longest mate that still counts as a mate threat (a mate in 11 'threat' is not something a reader can use). */
export const THREAT_MAX_MATE = 3;

/** Keep the step facts worth narrating: STEP_FACT_TYPES; attacks only on pieces (not pawns). */
export function stepFacts(facts: readonly Fact[]): Fact[] {
  const kept = facts.filter((f) => {
    if (!STEP_FACT_TYPES.has(f.type)) return false;
    if (f.type === 'attack') return f.target.role !== 'pawn' && !f.offered; // (an offered attacker: told only in the Immediate level, checked against the PV)
    return true;
  });
  return sortFacts(kept).slice(0, MAX_STEP_FACTS);
}

const isCapture = (pos: Pos, uci: string): boolean => {
  const m = legalMove(pos, uci);
  if (!m) return false;
  const target = pos.board.get(m.to);
  if (target && target.color !== pos.turn) return true;
  return pos.board.get(m.from)?.role === 'pawn' && m.to === pos.epSquare;
};

/** No piece of either side can be won right now (SEE): the material count is not about to change. */
export function isStable(pos: Pos): boolean {
  for (const sq of pos.board.occupied.diff(pos.board.king)) if (hangingLoss(pos, sq) > 0) return false;
  return true;
}

/** Quiet point: stable and not in check. */
export function isQuiet(pos: Pos): boolean {
  return !pos.isCheck() && isStable(pos);
}

/**
 * The side to move is under pressure: in check, one of its pieces can be won by SEE, or the other side
 * threatens mate in one. Only such replies can be "forced" in the reader's sense.
 */
export function underPressure(pos: Pos): boolean {
  if (pos.isCheck()) return true;
  for (const sq of pos.board[pos.turn].diff(pos.board.king)) if (hangingLoss(pos, sq) > 0) return true;
  try {
    const flipped = withTurn(pos, opposite(pos.turn));
    if (!flipped.isCheck() && hasMateInOne(flipped)) return true;
  } catch {
    // an unusable null-move position: no mate threat
  }
  return false;
}

/**
 * Settled material: not check, and the side to move can't win anything right now (no piece of the side that
 * just moved can be won by SEE). The count can still grow for the side that just moved, but not shrink — so
 * stating it is safe even where the line never gets fully quiet.
 */
export function isSettled(pos: Pos): boolean {
  if (pos.isCheck()) return false;
  const justMoved = opposite(pos.turn);
  for (const sq of pos.board[justMoved].diff(pos.board.king)) if (hangingLoss(pos, sq) > 0) return false;
  return true;
}

/** The side that just moved threatens mate in one (it would mate if it could move again). */
function threatensMateInOne(pos: Pos): boolean {
  if (pos.isCheck() || pos.isEnd()) return false;
  try {
    return hasMateInOne(withTurn(pos, opposite(pos.turn)));
  } catch {
    return false;
  }
}

/** Per-ply data of a PV walk from `fenBefore` (index k = position after k plies). */
interface PlyInfo {
  /** quiet[k]: position after k plies is a quiet point. */
  quiet: boolean[];
  /** settled[k]: see `isSettled`. */
  settled: boolean[];
  /** captured[k]: ply k (1-based) was a capture or a promotion. */
  captured: boolean[];
  /** forcing[i]: PV ply i is a capture, check, promotion or a fork/skewer/discovered attack. */
  forcing: boolean[];
  /** Mover's material delta after k plies. */
  delta: number[];
  /** Mover's material balance (pawns) before the line. */
  start: number;
  /** Number of plies until checkmate (inclusive), if the PV mates. */
  mateAt?: number;
}

function walk(fenBefore: string, legal: readonly string[]): PlyInfo {
  const pos = positionFromFen(fenBefore);
  const mover = pos.turn;
  const start = materialOf(pos, mover);
  const quiet: boolean[] = [isQuiet(pos)];
  const settled: boolean[] = [false];
  const captured: boolean[] = [false];
  const forcing: boolean[] = [];
  const delta: number[] = [0];
  let prev: { fenBefore: string; uci: string } | undefined;
  let mateAt: number | undefined;
  for (let i = 0; i < legal.length; i++) {
    const uci = legal[i]!;
    const m = legalMove(pos, uci)!;
    const fen = makeFen(pos.toSetup());
    const facts = immediateFactsFromPosition(pos, uci, prev ? { prev } : {});
    const cap = isCapture(pos, uci) || !!m.promotion;
    forcing.push(cap || facts.some((f) => f.type === 'check' || FORCING_FACT_TYPES.has(f.type)));
    pos.play(m);
    prev = { fenBefore: fen, uci };
    quiet.push(isQuiet(pos));
    settled.push(isSettled(pos));
    captured.push(cap);
    const bal = materialOf(pos, mover);
    delta.push(bal - start);
    if (pos.isCheckmate()) {
      mateAt = i + 1;
      break;
    }
    if (pos.isStalemate()) break;
  }
  const out: PlyInfo = { quiet, settled, captured, forcing, delta, start };
  if (mateAt !== undefined) out.mateAt = mateAt;
  return out;
}

function materialOf(pos: Pos, color: Color): number {
  let s = 0;
  for (const sq of pos.board.occupied) {
    const p = pos.board.get(sq)!;
    s += (p.color === color ? 1 : -1) * PIECE_VALUES[p.role];
  }
  return s;
}

export interface NarrationOptions {
  /** Material rule verdict for the move (mover's delta at the played line's quiet point): show the loss. */
  targetDelta?: number;
  /**
   * Stop no earlier than this many plies (M5b): the played move's and the best move's lines are told to a
   * comparable length (each still ends at its own stop point at or after it).
   */
  minPlies?: number;
}

/** Minimum gain (cp) of the opponent's null-move idea over their best reply now, for a 'prevents' fact. */
export const PREVENTS_MIN_CP = 150;
/** (round 7) A story's stop point should leave the material within this many pawns of the deep eval when a later one does. */
export const EVAL_CLOSE_PAWNS = 2;
/** No 'prevents' facts when the position is decided (|eval| above this, cp). */
export const PREVENTS_MAX_EVAL_CP = 500;

/** SAN of `pv` from `fen` if it ends in checkmate within `maxPlies` (legal prefix), else null. */
export function mateLineSan(fen: string, pv: readonly string[], maxPlies: number): string[] | null {
  const pos = positionFromFen(fen);
  const out: string[] = [];
  for (const u of pv.slice(0, maxPlies)) {
    const m = legalMove(pos, u);
    if (!m) return null;
    out.push(makeSan(pos, m));
    pos.play(m);
    if (pos.isCheckmate()) return out;
  }
  return null;
}

type ForkFact = Extract<Fact, { type: 'fork' }>;

/**
 * A checking fork shown by the line (see header): pv[0] gives check and its piece attacks an enemy piece worth >= 3,
 * pv[1] answers, pv[2] is that piece capturing the target. Null otherwise.
 */
export function pvFork(fen: string, pv: readonly string[]): ForkFact | null {
  const legal = legalPrefix(fen, pv).slice(0, 3);
  if (legal.length < 3) return null;
  const pos = positionFromFen(fen);
  const m0 = legalMove(pos, legal[0]!)!;
  const mover = pos.turn;
  pos.play(m0);
  if (!pos.isCheck()) return null;
  const to = m0.to;
  const piece = pos.board.get(to);
  if (!piece || piece.color !== mover || piece.role === 'king') return null;
  const replies = [...pos.allDests()];
  const kingSq = pos.board.kingOf(pos.turn)!;
  const kingMustMove = replies.every(([from, d]) => from === kingSq || d.isEmpty());
  if (!attacksFrom(pos.board, to).has(kingSq)) return null; // the forking piece itself gives check (not a discovered check)
  const m1 = legalMove(pos, legal[1]!)!;
  const replySan = makeSan(pos, m1);
  if (m1.to === to) return null; // the checking piece is taken
  const before1 = pos.clone();
  pos.play(m1);
  const m2 = legalMove(pos, legal[2]!)!;
  if (m2.from !== to) return null;
  const target = pos.board.get(m2.to);
  if (!target || target.color === mover || target.role === 'king' || PIECE_VALUES[target.role] < 3) return null;
  // the target stood there when the check was given (attacked together with the king), not a piece that moved in
  if (before1.board.get(m2.to)?.role !== target.role || m1.to === m2.to || !attacksFrom(before1.board, to).has(m2.to)) return null;
  const captureSan = makeSan(pos, m2);
  const king = toPieceRef({ role: 'king', color: opposite(mover) }, kingSq);
  return {
    type: 'fork',
    attacker: toPieceRef(piece, to),
    targets: [king, toPieceRef(target, m2.to)],
    followUp: { reply: replySan, capture: captureSan, ...(kingMustMove ? { kingMustMove: true } : {}) },
  };
}

export interface PreventsInput {
  fenBefore: string;
  /** The move (UCI). */
  uci: string;
  /** The opponent's null-move search at `nullMoveFen(fenBefore)` (MultiPV 1; score: opponent POV). */
  nullSearch: Pick<SearchResult, 'lines'>;
  /** Deep score of the move, mover POV. */
  score: Score;
  /** The opponent's verified material/mate threat (already told as 'defends-threat' when stopped). */
  threatMove?: string | null;
}

/** Prophylaxis (see header): the opponent's null-move best idea no longer works after the move. */
export function preventsFact(input: PreventsInput): Extract<Fact, { type: 'prevents' }> | null {
  const best = input.nullSearch.lines[0];
  if (!best || best.score.cp === undefined || input.score.cp === undefined) return null;
  if (Math.abs(input.score.cp) > PREVENTS_MAX_EVAL_CP || Math.abs(best.score.cp) > PREVENTS_MAX_EVAL_CP + PREVENTS_MIN_CP) return null;
  // what the idea is worth: the opponent's null-move score vs their best reply after the move (= -score of the move)
  if (best.score.cp + input.score.cp < PREVENTS_MIN_CP) return null;
  const nf = nullMoveFen(input.fenBefore);
  if (!nf) return null;
  const idea = best.move;
  if (input.threatMove && idea.slice(0, 4) === input.threatMove.slice(0, 4)) return null;
  const nullPos = positionFromFen(nf);
  const ideaMove = legalMove(nullPos, idea);
  if (!ideaMove) return null;
  const pos = positionFromFen(input.fenBefore);
  const mv = legalMove(pos, input.uci);
  if (!mv) return null;
  const mover = pos.turn;
  // the idea captured the piece that just moved away (an escape), or the move captured the idea's piece
  if (ideaMove.to === mv.from || ideaMove.from === mv.to) return null;
  const san = makeSan(nullPos, ideaMove);
  pos.play(mv);
  if (pos.isCheck() || pos.isEnd()) return null;
  const sq = (n: number) => `${'abcdefgh'[n & 7]}${(n >> 3) + 1}`;
  const nowLegal = legalMove(pos, idea);
  if (!nowLegal) {
    const occ = pos.board.get(ideaMove.to);
    const reason = occ && occ.color === mover ? 'occupied' : 'blocked';
    const by = occ && occ.color === mover ? toPieceRef(occ, ideaMove.to) : undefined;
    // "blocked": the moved piece now stands between (a slider's path) — otherwise the reason isn't simple
    if (reason === 'blocked') {
      const path = between(ideaMove.from, ideaMove.to);
      if (!path.has(mv.to)) return null;
    }
    const f: Extract<Fact, { type: 'prevents' }> = { type: 'prevents', move: standardUci(nullPos, ideaMove), san, square: sq(reason === 'blocked' ? mv.to : ideaMove.to), reason };
    if (by) f.by = by;
    if (reason === 'blocked') f.by = toPieceRef(pos.board.get(mv.to)!, mv.to);
    return f;
  }
  const beforeGain = seeMove(nullPos, idea);
  const afterGain = seeMove(pos, idea);
  if (!(afterGain < 0 && beforeGain >= 0)) return null;
  // who now covers the square: the moved piece if it attacks it, else any mover piece that does
  const attackers = attackersOfSq(pos, ideaMove.to, mover);
  const byMoved = attackers.find((a) => a === mv.to);
  const bySq = byMoved ?? attackers[0];
  const f: Extract<Fact, { type: 'prevents' }> = { type: 'prevents', move: standardUci(nullPos, ideaMove), san, square: sq(ideaMove.to), reason: 'covered' };
  if (bySq !== undefined) f.by = toPieceRef(pos.board.get(bySq)!, bySq);
  return f;
}

function attackersOfSq(pos: Pos, sq: number, color: Color): number[] {
  const out: number[] = [];
  for (const a of attackersOf(pos.board, sq, color)) out.push(a);
  return out.sort((a, b) => PIECE_VALUES[pos.board.getRole(a)!] - PIECE_VALUES[pos.board.getRole(b)!]);
}

/** Number of PV plies to narrate (see header). `pv` is trimmed to its legal prefix first. */
export function narrationPlies(fenBefore: string, pv: readonly string[], settings: AnalysisSettings, score?: Score, opts: NarrationOptions = {}): number {
  const { shortLineMinPlies: min, shortLineMaxPlies: max } = settings.explain;
  const horizon = Math.max(max, settings.material.quietHorizonPlies);
  const legal = legalPrefix(fenBefore, pv).slice(0, horizon);
  if (legal.length === 0) return 0;
  // a mate that fits: narrate to the mate
  if (score?.mate !== undefined && score.mate !== 0) {
    const plies = score.mate > 0 ? 2 * score.mate - 1 : 2 * -score.mate;
    if (plies <= max && plies <= legal.length) return plies;
  }
  const info = walk(fenBefore, legal);
  const n = info.mateAt ?? info.quiet.length - 1;
  if (info.mateAt !== undefined && info.mateAt <= horizon) return info.mateAt;
  // a quiet point whose next ply isn't forcing (the end of the walked PV counts as "nothing follows")
  const stopOk = (k: number) => info.quiet[k]! && (k === n || !info.forcing[k]);
  // a settled capture: the payoff of a line that never gets fully quiet (e.g. Qxb7 also hitting the rook on a8)
  // A stop point is preferred where the engine's eval agrees with the material swing: after 3...Nxe4 in the Berlin
  // nothing can be taken back at once, yet Re1 and Nxe5 regain the pawn (eval ~0). Real gambits fall back to the first quiet point.
  const evalPawns = score?.cp !== undefined ? score.cp / 100 : null;
  const agrees = (k: number) => evalPawns === null || Math.abs(info.start + info.delta[k]! - evalPawns) < Math.abs(info.start - evalPawns) + 0.5;
  const claimOk = (k: number) => info.settled[k]! && info.captured[k]! && (k === n || !info.forcing[k]);
  const first = (from: number, ok: (k: number) => boolean): number | undefined => {
    for (let k = from; k <= n; k++) if (ok(k)) return k;
    return undefined;
  };
  const lo = Math.min(Math.max(min, opts.minPlies ?? 0), n);
  let end = first(lo, (k) => (stopOk(k) || claimOk(k)) && agrees(k)) ?? first(lo, stopOk);
  // (round 7) a stop point whose material is still far from the engine's eval (Kf7: "loses a pawn" at 0 → +4.8)
  // gives way to a later one within the horizon that matches it (the rook lost to the Ne6+ fork)
  if (end !== undefined && evalPawns !== null && Math.abs(evalPawns) < 9) {
    const close = (k: number) => Math.abs(info.start + info.delta[k]! - evalPawns) <= EVAL_CLOSE_PAWNS;
    if (!close(end)) {
      const later = first(end + 1, (k) => (stopOk(k) || claimOk(k)) && close(k));
      if (later !== undefined) end = later;
    }
  }
  // (round 8) material the line changes again later (a pawn given back, a loss that grows) is no result yet: run on
  // to the first stop point that already has the material of the last stop point within the horizon
  if (end !== undefined) {
    let lastStop: number | undefined;
    for (let k = n; k > end; k--) {
      if (stopOk(k) || claimOk(k)) {
        lastStop = k;
        break;
      }
    }
    // (only when the later material agrees better with the deep eval: a PV cut mid-exchange proves nothing)
    const fits = (k: number) => (evalPawns === null ? Infinity : Math.abs(info.start + info.delta[k]! - evalPawns));
    // (round 9) …or when that material then holds unchanged to the end of the walked PV (at least 2 more plies)
    const holds = (k: number) => n - k >= 2 && info.delta.slice(k, n + 1).every((d) => d === info.delta[k]);
    if (lastStop !== undefined && Math.abs(info.delta[lastStop]! - info.delta[end]!) >= 1 && (fits(lastStop) < fits(end) || holds(lastStop))) {
      const settled = first(end + 1, (k) => (stopOk(k) || claimOk(k)) && info.delta[k] === info.delta[lastStop!]);
      if (settled !== undefined) end = settled;
    }
  }
  if (end === undefined) {
    // never quiet: the material result will be resolved or 'unclear' — but don't stop right after a capture
    // whose recapture is the next move (…Bxf6+ gxf6)
    for (let k = Math.min(Math.max(max, lo), n); k > lo; k--) if (!info.captured[k]) return k;
    return Math.min(Math.max(max, lo), n);
  }
  const target = opts.targetDelta;
  if (target !== undefined && info.delta[end]! > target + 0.5) {
    const shown = first(end + 1, (k) => (stopOk(k) || claimOk(k)) && info.delta[k]! <= target + 0.5);
    if (shown !== undefined) return shown;
  }
  return end;
}

export interface ForcednessCheck {
  /** 0-based index into the PV of the opponent reply being checked. */
  index: number;
  /** Position before the reply (opponent to move). */
  fen: string;
  /** The reply (normalised UCI). */
  uci: string;
  legalMoves: number;
}

/**
 * Opponent replies to verify for forcedness: odd PV indices < min(narrated plies, budget.forcednessPlies) where
 * the replying side is under pressure (see header).
 */
export function forcednessChecks(fenBefore: string, pv: readonly string[], plies: number, settings: AnalysisSettings): ForcednessCheck[] {
  const legal = legalPrefix(fenBefore, pv).slice(0, Math.min(plies, settings.budget.forcednessPlies));
  const pos = positionFromFen(fenBefore);
  const out: ForcednessCheck[] = [];
  for (let i = 0; i < legal.length; i++) {
    const fen = makeFen(pos.toSetup());
    if (i % 2 === 1 && underPressure(pos)) out.push({ index: i, fen, uci: legal[i]!, legalMoves: countLegalMoves(fen) });
    pos.play(legalMove(pos, legal[i]!)!);
  }
  return out;
}

export interface ForcedInfo {
  forced: boolean;
  alternatives: number;
}

/** Forcedness of a reply from a MultiPV-2 search of the position before it (scores: replying side's POV). */
export function forcedFromSearch(check: ForcednessCheck, lines: readonly PvLine[], settings: AnalysisSettings): ForcedInfo {
  const alternatives = Math.max(0, check.legalMoves - 1);
  if (check.legalMoves <= 1) return { forced: true, alternatives: 0 };
  const first = lines[0];
  const second = lines[1];
  if (!first || !second) return { forced: false, alternatives };
  if (!sameMoveUci(check.fen, first.move, check.uci)) return { forced: false, alternatives };
  const gap = winPercentFromScore(first.score) - winPercentFromScore(second.score);
  return { forced: gap >= settings.explain.forcedReplyMinGap, alternatives };
}

export interface NarrateOptions {
  settings: AnalysisSettings;
  /** The move before the line (opponent's previous move), to recognise a recapture as the first step. */
  prev?: { fenBefore: string; uci: string } | null;
  /** Deep score of the line, mover POV (enables mate results). */
  score?: Score;
  /** Forcedness per PV index (opponent replies), from `forcedFromSearch`. */
  forced?: ReadonlyMap<number, ForcedInfo>;
  /** Override the number of narrated plies (default `narrationPlies`). */
  plies?: number;
  /** Passed to `narrationPlies` (when `plies` isn't given). */
  targetDelta?: number;
  minPlies?: number;
  /** The opponent's first reply refutes the move (bad label): never mark it forced. */
  noForcedFirstReply?: boolean;
}

export interface NarratedLine {
  line: LineFact;
  forcedReplies: ForcedReplyFact[];
  /** Position at the end of the narrated steps. */
  endFen: string;
}

type LineMoves = ReturnType<typeof lineMaterial>['moves'];

function netPieces(moves: LineMoves, mover: Color, extra: { role: PieceRole; by: Color } | null): { won: PieceRole[]; lost: PieceRole[] } {
  const won: PieceRole[] = [];
  const lost: PieceRole[] = [];
  const add = (by: Color, role: PieceRole) => (by === mover ? won : lost).push(role);
  // (M5b) a capture answered at once by a recapture of equal value on the same square is a trade: both cancel first
  // (Bxe6 fxe6 then …Rxc8 = "loses a bishop"; bishops traded on g2 while a knight goes = "loses a knight")
  const traded = new Set<number>();
  for (let i = 0; i + 1 < moves.length; i++) {
    const a = moves[i]!;
    const b = moves[i + 1]!;
    if (traded.has(i) || !a.captured || !b.captured || a.promotion || b.promotion) continue;
    if (b.captured.square !== a.uci.slice(2, 4) || PIECE_VALUES[a.captured.role] !== PIECE_VALUES[b.captured.role]) continue;
    traded.add(i).add(i + 1);
  }
  for (const [i, m] of moves.entries()) {
    if (m.captured && !traded.has(i)) add(m.color, m.captured.role);
    if (m.promotion) {
      add(m.color, m.promotion);
      (m.color === mover ? lost : won).push('pawn');
    }
  }
  if (extra) add(extra.by, extra.role);
  // then equal roles, then equal values (knight / bishop), earliest first
  const cancel = (same: (a: PieceRole, b: PieceRole) => boolean) => {
    for (let i = 0; i < won.length; i++) {
      const j = lost.findIndex((r) => same(r, won[i]!));
      if (j >= 0) {
        lost.splice(j, 1);
        won.splice(i, 1);
        i--;
      }
    }
  };
  cancel((a, b) => a === b);
  cancel((a, b) => PIECE_VALUES[a] === PIECE_VALUES[b]);
  const byValue = (a: PieceRole, b: PieceRole) => PIECE_VALUES[b] - PIECE_VALUES[a];
  return { won: won.sort(byValue), lost: lost.sort(byValue) };
}

/**
 * The pending recapture at a non-quiet line end, resolved with SEE: only if nothing but the piece that just
 * captured (on `sq`) is en prise and the position is not check. Returns the side to move's SEE gain there and
 * the piece it takes (when the exchange simply wins that piece), or null when the material is still unclear.
 */
function resolvePending(pos: Pos, lastTo: number | undefined): { gain: number; takes: PieceRole | null } | null {
  if (pos.isCheck() || lastTo === undefined) return null;
  for (const sq of pos.board.occupied.diff(pos.board.king)) {
    if (sq !== lastTo && hangingLoss(pos, sq) > 0) return null;
  }
  const piece = pos.board.get(lastTo);
  if (!piece || piece.color === pos.turn) return null;
  const gain = see(pos, lastTo, pos.turn);
  return { gain, takes: gain > 0 && gain === PIECE_VALUES[piece.role] ? piece.role : null };
}

/** Only the piece on `sq` (that just captured) is en prise and the position is not check. */
function isOnlyPending(pos: Pos, sq: number): boolean {
  if (pos.isCheck()) return false;
  for (const s of pos.board.occupied.diff(pos.board.king)) if (s !== sq && hangingLoss(pos, s) > 0) return false;
  return true;
}

/** After step i, the side of step i captures the piece standing on `square` (followed when it moves) later in the steps. */
function sideWinsPiece(steps: readonly LineStep[], i: number, square: string): boolean {
  const side = steps[i]!.color;
  let sq = square;
  for (const s of steps.slice(i + 1)) {
    const from = s.uci.slice(0, 2);
    const to = s.uci.slice(2, 4);
    if (s.color !== side && from === sq) sq = to;
    else if (s.color === side && to === sq) return true;
  }
  return false;
}

/** Narrate the first plies of `pv` from `fenBefore` (the mover = side to move at fenBefore). */
export function narrateLine(fenBefore: string, pv: readonly string[], opts: NarrateOptions): NarratedLine {
  const { settings } = opts;
  const legal = legalPrefix(fenBefore, pv);
  const nOpts: NarrationOptions = {};
  if (opts.targetDelta !== undefined) nOpts.targetDelta = opts.targetDelta;
  if (opts.minPlies !== undefined) nOpts.minPlies = opts.minPlies;
  const plies = Math.min(opts.plies ?? narrationPlies(fenBefore, legal, settings, opts.score, nOpts), legal.length);
  const pos = positionFromFen(fenBefore);
  const mover = pos.turn;
  const steps: LineStep[] = [];
  const forcedReplies: ForcedReplyFact[] = [];
  let prev = opts.prev ?? undefined;
  let mateBy: Color | null = null;
  let anyCapture = false;
  let lastTo: number | undefined;
  for (let i = 0; i < plies; i++) {
    const uci = legal[i]!;
    const move = legalMove(pos, uci)!;
    const fen = makeFen(pos.toSetup());
    const color = pos.turn;
    const san = makeSan(pos, move);
    let facts = stepFacts(immediateFactsFromPosition(pos, uci, prev ? { prev } : {}));
    // a checking fork the line carries out (the board-only test needs a win against every reply)
    if (!facts.some((f) => f.type === 'fork') && i + 2 < plies) {
      const fk = pvFork(fen, legal.slice(i, i + 3));
      if (fk) facts = [fk, ...facts.filter((f) => f.type !== 'check' && !(f.type === 'attack' && fk.targets.some((t) => t.square === f.target.square)))].slice(0, MAX_STEP_FACTS);
    }
    const cap = isCapture(pos, uci);
    if (cap) anyCapture = true;
    lastTo = cap || move.promotion ? move.to : undefined;
    const pressured = color !== mover && underPressure(pos);
    const wasInCheck = pos.isCheck();
    const step: LineStep = { ply: i + 1, san, uci: standardUci(pos, move), color, facts };
    steps.push(step);
    pos.play(move);
    const fi = opts.forced?.get(i);
    // only a defensive reply is 'forced' in the reader's sense: not a mating move (it is simply the end), not a
    // reply that answers nothing or that attacks (check, a winning capture, a fork…), and not the opponent's
    // punishing reply to a bad move (`noForcedFirstReply`)
    // (a king stepping out of check may attack something on the way — that reply is still forced)
    const attacking = pos.isCheck()
      || facts.some((f) => FORCING_FACT_TYPES.has(f.type) || (f.type === 'attack' && !wasInCheck) || (f.type === 'capture' && f.outcome === 'wins-material'))
      || threatensMateInOne(pos);
    if (fi?.forced && pressured && !attacking && !(opts.noForcedFirstReply && i === 1) && !pos.isCheckmate()) {
      step.forced = true;
      forcedReplies.push({ type: 'forced-reply', san, alternatives: fi.alternatives });
    }
    prev = { fenBefore: fen, uci };
    if (pos.isCheckmate()) {
      mateBy = color;
      break;
    }
    if (pos.isStalemate()) break;
  }

  // a "trapped" piece is only told when the line then wins it (the side that trapped it captures it later)
  // (M5b) likewise a fork or a discovered attack in a story step: only when the line then wins one of its targets
  // (and, for a fork / trap, the tactic piece isn't simply taken on the next move)
  for (const [i, step] of steps.entries()) {
    const takenNext = steps[i + 1]?.uci.slice(2, 4) === step.uci.slice(2, 4);
    step.facts = step.facts.filter((f) => {
      if (f.type === 'trapped') return !takenNext && sideWinsPiece(steps, i, f.piece.square);
      if (f.type === 'fork') return (!takenNext || !!f.followUp) && f.targets.some((t) => t.role !== 'king' && sideWinsPiece(steps, i, t.square));
      if (f.type === 'discovered-attack') return sideWinsPiece(steps, i, f.target.square);
      return true;
    });
  }

  // material at the end of the narrated line: a quiet point, or a pending recapture resolved with SEE
  const lm = lineMaterial(fenBefore, legal.slice(0, steps.length), { horizonPlies: steps.length });
  let delta = lm.delta;
  let unclear = false;
  let extra: { role: PieceRole; by: Color } | null = null;
  let pendingSan: string | undefined;
  if (!mateBy && !pos.isStalemate() && !isQuiet(pos) && !(lastTo !== undefined && isSettled(pos))) {
    // (M5b, round 6) the engine line goes on without taking back (…Bxf2, then Nf3: the bishop isn't recaptured —
    // SEE misses why): no SEE recapture is assumed then
    const nextUci = legal[steps.length];
    const later = legal.slice(steps.length, steps.length + 4);
    const pvSkipsRecapture = lastTo !== undefined && !!nextUci && later.length >= 2 && later.every((u) => parseSquare(u.slice(2, 4)) !== lastTo) && hangingLoss(pos, lastTo) > 0 && isOnlyPending(pos, lastTo);
    const r = pvSkipsRecapture ? { gain: 0, takes: null } : resolvePending(pos, lastTo);
    if (!r) unclear = true;
    else {
      delta += pos.turn === mover ? r.gain : -r.gain;
      if (r.gain > 0) {
        if (r.takes) {
          extra = { role: r.takes, by: pos.turn };
          // (round 9) name the counted recapture when the PV plays it next (…Bxe5 dxe5, then Nxe5)
          const nu = legal[steps.length];
          const nm = nu ? legalMove(pos, nu) : undefined;
          if (nm && nm.to === lastTo) pendingSan = makeSan(pos, nm);
        }
        else unclear = true; // a multi-piece exchange: the net count is right, the pieces are not known
      }
    }
  }
  const { won, lost } = unclear ? { won: [], lost: [] } : netPieces(lm.moves, mover, extra);

  let result: LineFact['result'];
  let mateIn: number | undefined;
  const sm = opts.score?.mate;
  if (sm !== undefined && sm !== 0) {
    result = sm > 0 ? 'mate' : 'mated';
    mateIn = Math.abs(sm);
  } else if (mateBy) {
    result = mateBy === mover ? 'mate' : 'mated';
    mateIn = Math.ceil(steps.filter((s) => s.color === mateBy).length);
  } else if (unclear) result = 'unclear';
  else if (delta >= 1) result = 'wins-material';
  else if (delta <= -1) result = 'loses-material';
  else if (anyCapture) result = 'trade';
  else result = 'quiet';

  const line: LineFact = { type: 'line', steps, materialDelta: unclear ? 0 : delta, result };
  if (mateIn !== undefined) line.mateIn = mateIn;
  if (won.length) line.won = won;
  if (pendingSan && !unclear) line.recapture = pendingSan;
  if (lost.length) line.lost = lost;
  // the resulting balance (a "loses a pawn" that only gives back a gambit pawn ends level), and what the
  // opponent's previous capture won (the line's gain is partly winning that back)
  if (!unclear && result !== 'mate' && result !== 'mated') {
    const start = materialOf(positionFromFen(fenBefore), mover);
    line.balance = start + delta;
    if (opts.prev) {
      try {
        const pp = positionFromFen(opts.prev.fenBefore);
        const owed = materialOf(pp, mover) - start; // mover POV: what the opponent's last move took
        if (isCapture(pp, opts.prev.uci) && owed > 0) line.owed = owed;
      } catch {
        // an unusable prev
      }
    }
  }
  // (M5b) the engine line goes on with a forcing move right after the story: say so instead of "no forcing follow-up"
  // (round 6: within the next 3 plies — "…; the engine line then goes on with Kf7 Rh7+.")
  if (!pos.isEnd()) {
    const p2 = pos.clone();
    const sans: string[] = [];
    for (const u of legal.slice(steps.length, steps.length + 3)) {
      const nm = legalMove(p2, u);
      if (!nm) break;
      sans.push(makeSan(p2, nm));
      const cap = isCapture(p2, u);
      p2.play(nm);
      if (p2.isCheck() || cap) {
        line.nextForcing = sans.join(' ');
        break;
      }
    }
  }
  return { line, forcedReplies, endFen: makeFen(pos.toSetup()) };
}

/**
 * FEN of the null-move position after a move: the mover moves again (side to move flipped, en passant cleared).
 * Null when the position is check (the move gave check), the game is over, or the flipped position is illegal.
 */
export function nullMoveFen(fenAfter: string): string | null {
  const pos = positionFromFen(fenAfter);
  const ctx = pos.ctx();
  if (ctx.checkers.nonEmpty() || pos.isEnd(ctx)) return null;
  try {
    const flipped = withTurn(pos, opposite(pos.turn));
    const fen = makeFen(flipped.toSetup());
    const check = positionFromFen(fen); // validates (the side not to move must not be in check)
    if (check.isEnd()) return null;
    return fen;
  } catch {
    return null;
  }
}

/** Threat fact from a MultiPV-1 search of the null-move position (`nullMoveFen`), or null if no real threat. */
export function threatFromSearch(nullFen: string, result: Pick<SearchResult, 'lines'>): ThreatFact | null {
  const best = result.lines[0];
  if (!best) return null;
  const pos = positionFromFen(nullFen);
  const move = legalMove(pos, best.move);
  if (!move) return null;
  const pv = legalPrefix(nullFen, best.pv.length ? best.pv : [best.move]);
  const lm = lineMaterial(nullFen, pv, { horizonPlies: THREAT_HORIZON });
  const mates = (best.score.mate ?? 0) > 0 && best.score.mate! <= THREAT_MAX_MATE;
  const allFacts = immediateFactsFromPosition(pos, best.move);
  const facts = stepFacts(allFacts);
  // (M5b) a capture is always kept (the wording names a piece won outright: Qxa1+ wins the rook, whatever else it hits)
  const capFact = allFacts.find((f) => f.type === 'capture');
  if (capFact && !facts.includes(capFact)) facts.push(capFact);
  if (!mates) {
    if (lm.delta < THREAT_MIN_GAIN) return null;
    // the threat move itself must be the point: a winning capture or a double attack
    const winningCapture = !!capturedBy(pos, move) && seeMove(pos, best.move) >= THREAT_MIN_GAIN;
    const tactic = facts.some((f) => f.type === 'fork' || f.type === 'skewer' || f.type === 'discovered-attack');
    const promotes = !!move.promotion; // (M5b) a pawn about to queen is a threat too
    if (!winningCapture && !tactic && !promotes) return null;
  }
  // the gain told is the net value of the threat move itself (a capture: its SEE; a fork/skewer: the line's gain,
  // at most the best target) — the null-move line can add captures the opponent would never allow
  let gain = Math.max(0, lm.delta);
  if (!mates) {
    // M5b: a tactic's gain is bounded by its best (non-king) target plus what the move itself captures — not by
    // the capture's SEE alone (Bxh7+ uncovering an attack on the queen wins the queen, not a pawn)
    const captured = capturedBy(pos, move);
    const capValue = captured ? PIECE_VALUES[captured.role] : 0;
    const tactic = facts.find((f) => f.type === 'fork' || f.type === 'skewer' || f.type === 'discovered-attack');
    if (tactic) {
      const targets = tactic.type === 'fork' ? tactic.targets : tactic.type === 'skewer' ? [tactic.behind] : [tactic.target];
      // what taking each target nets after recaptures (SEE from the tactic's piece); for a fork without check the
      // opponent saves the bigger one, so the second-best counts (round 6: Nc3 forking Qe4 and a defended Rb1 = +2)
      const after = pos.clone();
      after.play(move);
      const attackerSq = parseSquare(tactic.attacker.square)!;
      const nets = targets.filter((t) => t.role !== 'king').map((t) => {
        const g = seeCaptureWith(after, attackerSq, parseSquare(t.square)!);
        return g === undefined ? PIECE_VALUES[t.role] : Math.max(0, g);
      }).sort((a, b) => b - a);
      const withKing = targets.some((t) => t.role === 'king');
      const top = tactic.type === 'fork' && !withKing ? (nets[1] ?? nets[0] ?? 0) : (nets[0] ?? 0);
      gain = Math.min(gain, Math.max(top + capValue, captured ? seeMove(pos, standardUci(pos, move)) : 0));
    } else if (captured) gain = Math.max(THREAT_MIN_GAIN, seeMove(pos, best.move)); // a plain capture: its SEE (board-verified)
  }
  const fact: ThreatFact = { type: 'threat', move: standardUci(pos, move), san: makeSan(pos, move), gain, facts };
  if (mates) fact.mateIn = best.score.mate!;
  return fact;
}

/**
 * Does the opponent's `threat` (found at the null-move position before the move) still work after the move?
 * `fenAfter` = position after the move (the threatening side to move); `result` = a MultiPV-1 search there
 * restricted to the threat move (null if the move is illegal now). A mate threat must still mate (in <=
 * THREAT_MAX_MATE); a material threat must still gain >= THREAT_MIN_GAIN by lineMaterial over its line.
 */
export function threatStillWorks(fenAfter: string, threat: ThreatFact, result: Pick<SearchResult, 'lines'> | null): boolean {
  const pos = positionFromFen(fenAfter);
  if (pos.isEnd() || !legalMove(pos, threat.move) || !result) return false;
  const line = result.lines[0];
  if (!line || !sameMoveUci(fenAfter, line.move, threat.move)) return false;
  if (threat.mateIn !== undefined) return (line.score.mate ?? 0) > 0 && line.score.mate! <= THREAT_MAX_MATE;
  const lm = lineMaterial(fenAfter, legalPrefix(fenAfter, line.pv.length ? line.pv : [line.move]), { horizonPlies: THREAT_HORIZON });
  return lm.delta >= THREAT_MIN_GAIN;
}

export interface RefutationInput {
  /** Position before the move. */
  fenBefore: string;
  /** The move (UCI). */
  uci: string;
  /** The move's PV (legal UCI, starting with the move); pv[1] is the opponent's reply. */
  pv: readonly string[];
  /** The move's narrated line (gain / mate against the mover, whether a single target is really won). */
  line: LineFact;
  /** The reply's own verified threat: `threatFromSearch` at `nullMoveFen(position after the reply)`. */
  replyThreat?: ThreatFact | null;
  /**
   * The best move's short-line material change (mover POV), if it claims one (M5b): a quiet reply whose line costs
   * the mover >= QUIET_REFUTATION_MIN_LOSS points more than the best line is still worth naming ("Allows c4 — in the
   * engine line this costs White 3 points").
   */
  bestLineDelta?: number | null;
}

/** See `RefutationInput.bestLineDelta`. */
export const QUIET_REFUTATION_MIN_LOSS = 2;

/** The refutation of a move: what the opponent's PV reply does (see header). Null when nothing notable. */
export function refutationFact(input: RefutationInput): AllowsFact | null {
  const legal = legalPrefix(input.fenBefore, input.pv);
  if (legal.length < 2 || !sameMoveUci(input.fenBefore, legal[0]!, input.uci)) return null;
  const pos = positionFromFen(input.fenBefore);
  const startPos = pos.clone();
  const mover = pos.turn;
  pos.play(legalMove(pos, legal[0]!)!);
  const afterMove = pos.clone();
  const replyUci = legal[1]!;
  const reply = legalMove(pos, replyUci)!;
  const san = makeSan(pos, reply);
  const facts = immediateFactsFromPosition(pos, replyUci, { prev: { fenBefore: input.fenBefore, uci: legal[0]! } })
    .filter((f) => ALLOWS_FACT_TYPES.has(f.type) && !(f.type === 'capture' && f.outcome !== 'wins-material'));
  const kept: Fact[] = sortFacts(facts).slice(0, MAX_STEP_FACTS);
  if (kept.some((f) => f.type === 'checkmate')) kept.splice(0, kept.length, ...kept.filter((f) => f.type === 'checkmate'));
  pos.play(reply);
  const after = pos; // mover to move

  // mover pieces newly en prise after the reply
  const fresh: PieceRef[] = [];
  if (!after.isEnd()) {
    for (const sq of after.board[mover].diff(after.board.king)) {
      if (hangingLoss(after, sq) <= 0) continue;
      const was = afterMove.board.get(sq);
      const now = after.board.get(sq)!;
      if (was && was.color === now.color && was.role === now.role && hangingLoss(afterMove, sq) > 0) continue;
      // (round 8) en prise already before the move (the move's check only hid it for one ply: Rd1+ Kh2, a7 again)
      const orig = startPos.board.get(sq);
      if (afterMove.isCheck() && orig && orig.color === now.color && orig.role === now.role && hangingLoss(startPos, sq) > 0) continue;
      fresh.push(toPieceRef(now, sq));
    }
  }
  fresh.sort((a, b) => PIECE_VALUES[b.role] - PIECE_VALUES[a.role]);
  // a single target counts only if the line really wins it (an opponent capture on that square)
  const lineTakes = (sq: string) => input.line.steps.some((s, i) => i >= 2 && s.color !== mover && s.uci.slice(2, 4) === sq && s.facts.some((f) => f.type === 'capture'));
  // a reply piece the mover can simply win (…Qxf2+ Rbxf2) threatens nothing: no targets, no threat
  const replyLoose = !after.isEnd() && hangingLoss(after, reply.to) > 0;
  // (round 7) not while the mover is in check: "under attack" is distorted by the check (…Bd4+ "hitting" c4 and g4)
  const targets = replyLoose || after.isCheck() ? [] : fresh.length >= 2 ? fresh.slice(0, 3) : fresh.filter((t) => lineTakes(t.square) && input.line.result === 'loses-material');

  // (M5b) the reply's threat is told only when it is mate or the line carries it out: an attacked piece that simply
  // steps away (…Rfc8 "threatening" Rxc7 — Qd7) is not what refutes the move
  const rt = input.replyThreat ?? null;
  const threatPlayed = !!rt && (rt.mateIn !== undefined || lineTakes(rt.move.slice(2, 4)) || input.line.steps.some((s, i) => i >= 2 && s.color !== mover && s.uci === rt.move));
  // (round 7) …nor a material threat on a piece that was already en prise before the move (Rxa7 was on before Rd1+)
  const beforePos = positionFromFen(input.fenBefore);
  const tsq = rt && rt.mateIn === undefined ? parseSquare(rt.move.slice(2, 4)) : undefined;
  const wasEnPrise = tsq !== undefined && beforePos.board.get(tsq)?.color === mover && hangingLoss(beforePos, tsq) > 0;
  const threat = replyLoose || !threatPlayed || wasEnPrise ? null : rt;
  if (threat && !kept.some((f) => f.type === 'checkmate')) kept.push(threat);

  const out: AllowsFact = { type: 'allows', reply: { san, uci: standardUci(afterMove, reply) }, facts: kept };
  if (targets.length) out.targets = targets;
  if (input.line.result === 'loses-material') out.gain = -input.line.materialDelta;
  if (input.line.result === 'mated' && input.line.mateIn !== undefined) out.mateIn = input.line.mateIn;
  // a plain check (or nothing) is no refutation worth a sentence — unless the line then costs material
  const quietCost = (out.gain ?? 0) >= QUIET_REFUTATION_MIN_LOSS && input.bestLineDelta != null && input.line.materialDelta <= input.bestLineDelta - QUIET_REFUTATION_MIN_LOSS;
  if (!kept.some((f) => f.type !== 'check') && targets.length === 0 && out.mateIn === undefined && !((out.gain ?? 0) >= 1 && kept.length) && !quietCost) return null;
  // (round 8) a reply whose tactic costs nothing in the line (dxe4 uncovering an attack on a bishop that is simply
  // recaptured; Nxf6+ uncovering an attack on a defended rook) refutes nothing
  if (!((out.gain ?? 0) >= 1) && out.mateIn === undefined && !kept.some((f) => f.type === 'threat' || f.type === 'checkmate') && targets.length === 0 && input.line.result !== 'unclear') return null;
  if (replyWasAlreadyThere(input.fenBefore, replyUci, kept, targets)) out.already = true;
  return out;
}

/**
 * The reply would have done the same before the move (the mover just didn't deal with it): it is legal in the
 * null-move position at fenBefore (the opponent to move as if the mover had passed), its winning capture wins
 * there too, and the same targets end up en prise.
 */
function replyWasAlreadyThere(fenBefore: string, replyUci: string, facts: readonly Fact[], targets: readonly PieceRef[]): boolean {
  const nf = nullMoveFen(fenBefore);
  if (!nf) return false;
  const pos = positionFromFen(nf);
  const m = legalMove(pos, replyUci);
  if (!m) return false;
  // a mate-in-one threat the reply sets up that it would have set up before the move as well (…Qd6 hitting h2)
  // (only if the pieces it now hits were en prise then too — Qf3 taking the queen off d4's defence is new)
  const mateThreat = facts.some((f) => f.type === 'threat' && f.mateIn === 1);
  if (mateThreat) {
    const p = pos.clone();
    p.play(m);
    const sameTargets = targets.every((t) => {
      const q = p.board.get(parseSquare(t.square)!);
      return q?.role === t.role && q.color === t.color && hangingLoss(p, parseSquare(t.square)!) > 0;
    });
    if (threatensMateInOne(p) && sameTargets) return true;
  }
  const cap = facts.find((f): f is Extract<Fact, { type: 'capture' }> => f.type === 'capture');
  if (cap && !(capturedBy(pos, m) && seeMove(pos, replyUci) >= cap.net)) return false;
  // (round 8) a fork the reply would have made just the same before the move (same targets): the move didn't stop it
  const fork = facts.find((f): f is Extract<Fact, { type: 'fork' }> => f.type === 'fork');
  if (fork && !facts.some((f) => f.type === 'checkmate' || f.type === 'skewer' || f.type === 'discovered-attack')) {
    try {
      const was = immediateFactsFromPosition(pos, replyUci).find((f): f is Extract<Fact, { type: 'fork' }> => f.type === 'fork');
      if (was && fork.targets.every((t) => was.targets.some((w) => w.square === t.square && w.role === t.role))) return true;
    } catch {
      // not legal there
    }
    return false;
  }
  if (facts.some((f) => f.type === 'fork' || f.type === 'checkmate' || f.type === 'skewer' || f.type === 'discovered-attack')) return false;
  if (!cap && targets.length === 0) return false;
  pos.play(m);
  return targets.every((t) => {
    const p = pos.board.get(parseSquare(t.square)!);
    return p?.role === t.role && p.color === t.color && hangingLoss(pos, parseSquare(t.square)!) > 0;
  });
}
