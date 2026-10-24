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
//   now — e.g. Qxb7 that also hits the rook on a8). A checkmate ends the line; a mate score that fits within
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

import type { AnalysisSettings, Color, Fact, LineStep, PieceRef, PieceRole, Score } from '@chess-coach/shared';
import { winPercentFromScore } from '@chess-coach/shared';
import { makeFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import { opposite } from 'chessops/util';
import { countLegalMoves, sameMoveUci } from '../analysis/classify';
import { toPieceRef, withTurn } from '../chess/attacks';
import { lineMaterial, PIECE_VALUES, positionFromFen } from '../chess/material';
import { legalMove, legalPrefix, standardUci } from '../chess/notation';
import { capturedBy, hangingLoss, see, seeMove } from '../chess/see';
import type { PvLine, SearchResult } from '../engine/uci';
import { hasMateInOne, immediateFactsFromPosition, sortFacts } from './immediate';

export type LineFact = Extract<Fact, { type: 'line' }>;
export type ThreatFact = Extract<Fact, { type: 'threat' }>;
export type ForcedReplyFact = Extract<Fact, { type: 'forced-reply' }>;
export type AllowsFact = Extract<Fact, { type: 'allows' }>;

type Pos = ReturnType<typeof positionFromFen>;

/** Fact types kept for each narrated step (and for a threat move). */
export const STEP_FACT_TYPES: ReadonlySet<Fact['type']> = new Set<Fact['type']>([
  'checkmate', 'stalemate', 'fork', 'skewer', 'discovered-attack', 'pin', 'capture', 'promotion', 'check', 'attack',
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
    if (f.type === 'attack') return f.target.role !== 'pawn';
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
  const out: PlyInfo = { quiet, settled, captured, forcing, delta };
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
  const claimOk = (k: number) => info.settled[k]! && info.captured[k]! && (k === n || !info.forcing[k]);
  const first = (from: number, ok: (k: number) => boolean): number | undefined => {
    for (let k = from; k <= n; k++) if (ok(k)) return k;
    return undefined;
  };
  const lo = Math.min(min, n);
  const end = first(lo, (k) => stopOk(k) || claimOk(k));
  if (end === undefined) return Math.min(max, n); // never quiet: the material result will be resolved or 'unclear'
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
  for (const m of moves) {
    if (m.captured) add(m.color, m.captured.role);
    if (m.promotion) {
      add(m.color, m.promotion);
      (m.color === mover ? lost : won).push('pawn');
    }
  }
  if (extra) add(extra.by, extra.role);
  // cancel equal roles
  for (let i = won.length - 1; i >= 0; i--) {
    const j = lost.indexOf(won[i]!);
    if (j >= 0) {
      lost.splice(j, 1);
      won.splice(i, 1);
    }
  }
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

/** Narrate the first plies of `pv` from `fenBefore` (the mover = side to move at fenBefore). */
export function narrateLine(fenBefore: string, pv: readonly string[], opts: NarrateOptions): NarratedLine {
  const { settings } = opts;
  const legal = legalPrefix(fenBefore, pv);
  const plies = Math.min(opts.plies ?? narrationPlies(fenBefore, legal, settings, opts.score, opts.targetDelta !== undefined ? { targetDelta: opts.targetDelta } : {}), legal.length);
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
    const facts = stepFacts(immediateFactsFromPosition(pos, uci, prev ? { prev } : {}));
    const cap = isCapture(pos, uci);
    if (cap) anyCapture = true;
    lastTo = cap || move.promotion ? move.to : undefined;
    const pressured = color !== mover && underPressure(pos);
    const step: LineStep = { ply: i + 1, san, uci: standardUci(pos, move), color, facts };
    steps.push(step);
    pos.play(move);
    const fi = opts.forced?.get(i);
    // only a defensive reply is 'forced' in the reader's sense: not a mating move (it is simply the end), not a
    // reply that answers nothing or that attacks (check, a winning capture, a fork…), and not the opponent's
    // punishing reply to a bad move (`noForcedFirstReply`)
    const attacking = pos.isCheck() || facts.some((f) => FORCING_FACT_TYPES.has(f.type) || (f.type === 'capture' && f.outcome === 'wins-material'));
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

  // material at the end of the narrated line: a quiet point, or a pending recapture resolved with SEE
  const lm = lineMaterial(fenBefore, legal.slice(0, steps.length), { horizonPlies: steps.length });
  let delta = lm.delta;
  let unclear = false;
  let extra: { role: PieceRole; by: Color } | null = null;
  if (!mateBy && !pos.isStalemate() && !isQuiet(pos) && !(lastTo !== undefined && isSettled(pos))) {
    const r = resolvePending(pos, lastTo);
    if (!r) unclear = true;
    else {
      delta += pos.turn === mover ? r.gain : -r.gain;
      if (r.gain > 0) {
        if (r.takes) extra = { role: r.takes, by: pos.turn };
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
  if (lost.length) line.lost = lost;
  // the opponent just captured: the line's gain is partly winning that back, so the resulting balance tells more
  if (opts.prev && !unclear && (result === 'wins-material' || result === 'trade')) {
    try {
      const pp = positionFromFen(opts.prev.fenBefore);
      if (isCapture(pp, opts.prev.uci)) line.balance = materialOf(positionFromFen(fenBefore), mover) + delta;
    } catch {
      // an unusable prev: no balance
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
  const facts = stepFacts(immediateFactsFromPosition(pos, best.move));
  if (!mates) {
    if (lm.delta < THREAT_MIN_GAIN) return null;
    // the threat move itself must be the point: a winning capture or a double attack
    const winningCapture = !!capturedBy(pos, move) && seeMove(pos, best.move) >= THREAT_MIN_GAIN;
    const tactic = facts.some((f) => f.type === 'fork' || f.type === 'skewer' || f.type === 'discovered-attack');
    if (!winningCapture && !tactic) return null;
  }
  const fact: ThreatFact = { type: 'threat', move: standardUci(pos, move), san: makeSan(pos, move), gain: Math.max(0, lm.delta), facts };
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
}

/** The refutation of a move: what the opponent's PV reply does (see header). Null when nothing notable. */
export function refutationFact(input: RefutationInput): AllowsFact | null {
  const legal = legalPrefix(input.fenBefore, input.pv);
  if (legal.length < 2 || !sameMoveUci(input.fenBefore, legal[0]!, input.uci)) return null;
  const pos = positionFromFen(input.fenBefore);
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
      fresh.push(toPieceRef(now, sq));
    }
  }
  fresh.sort((a, b) => PIECE_VALUES[b.role] - PIECE_VALUES[a.role]);
  // a single target counts only if the line really wins it (an opponent capture on that square)
  const lineTakes = (sq: string) => input.line.steps.some((s, i) => i >= 2 && s.color !== mover && s.uci.slice(2, 4) === sq && s.facts.some((f) => f.type === 'capture'));
  const targets = fresh.length >= 2 ? fresh.slice(0, 3) : fresh.filter((t) => lineTakes(t.square) && input.line.result === 'loses-material');

  const threat = input.replyThreat ?? null;
  if (threat && !kept.some((f) => f.type === 'checkmate')) kept.push(threat);

  const out: AllowsFact = { type: 'allows', reply: { san, uci: standardUci(afterMove, reply) }, facts: kept };
  if (targets.length) out.targets = targets;
  if (input.line.result === 'loses-material') out.gain = -input.line.materialDelta;
  if (input.line.result === 'mated' && input.line.mateIn !== undefined) out.mateIn = input.line.mateIn;
  // a plain check (or nothing) is no refutation worth a sentence
  if (!kept.some((f) => f.type !== 'check') && targets.length === 0 && out.mateIn === undefined) return null;
  return out;
}
