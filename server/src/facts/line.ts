// Short-term level: narration of an engine principal variation, opponent-reply forcedness, and the null-move
// threat fact. Pure functions — engine results are passed in (analysis/analyzeMove.ts runs the searches).
//
// Definitions
// - Narrated plies (`narrationPlies`): the first `explain.shortLineMinPlies` legal PV plies, extended one ply at a
//   time (up to `explain.shortLineMaxPlies`) while the line is still tactical: the last ply was a capture, check
//   or promotion, the next ply is a capture, or the position isn't stable (`isStable`: some piece of either side
//   can be won by SEE — the material count is about to change). A checkmate ends the line. If the line's score is a mate for
//   either side that fits within the maximum, the narration runs to the mate.
// - Step facts: `immediateFactsFromPosition` of each step (with the previous ply as `prev`, so recaptures are
//   recognised), filtered to STEP_FACT_TYPES (no negative facts — an engine line's "hanging" piece is a
//   deliberate offer, not a mistake) and capped at MAX_STEP_FACTS per step.
// - Forced reply: an opponent reply at PV index i (odd, i < budget.forcednessPlies, within the narrated plies) is
//   forced if it is the only legal move, or if a MultiPV-2 search of the position before it ranks it first and
//   the second-best reply is worse by >= `explain.forcedReplyMinGap` win% (replying side's POV).
//   `forced-reply.alternatives` = number of other legal moves (0 = it was the only legal move).
// - Line fact: `materialDelta` = mover's material change from `fenBefore` (incl. the first move) at the quiet
//   point of the narrated line (`lineMaterial` with horizon = narrated plies, extended through a pending
//   exchange, or — if the narration was capped in an unstable position — at the PV's quiet point after
//   `material.quietHorizonPlies`; then `measuredAt` = plies measured); `won`/`lost` = the net pieces gained/lost (equal roles cancel; a promotion counts as +promoted
//   piece / -pawn). `result`: 'mate' / 'mated' if the line's deep score is a mate (or a checkmate is reached
//   within the narration; `mateIn` = moves of the mating side), else 'wins-material' (delta >= 1),
//   'loses-material' (delta <= -1), 'trade' (pieces were captured, net 0), 'quiet'.
// - Threat (`nullMoveFen` + `threatFromSearch`): the mover's best move if the opponent passed. Null move = side
//   to move flipped, en passant cleared; skipped if the move gives check or ends the game. A threat is reported
//   only if it mates (search score is a mate in <= THREAT_MAX_MATE for the mover) or wins material: `lineMaterial` over the threat PV
//   (horizon THREAT_HORIZON plies, extended through captures) gains >= THREAT_MIN_GAIN, and the threat move itself
//   is a capture winning material by SEE or a fork / skewer / discovered attack (a quiet "threat" whose gain
//   comes two moves later is a plan, not a threat). Its own immediate facts (filtered like step facts) are
//   attached.

import type { AnalysisSettings, Color, Fact, LineStep, PieceRole, Score } from '@chess-coach/shared';
import { winPercentFromScore } from '@chess-coach/shared';
import { makeFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import { opposite } from 'chessops/util';
import { countLegalMoves, sameMoveUci } from '../analysis/classify';
import { withTurn } from '../chess/attacks';
import { lineMaterial, PIECE_VALUES, positionFromFen } from '../chess/material';
import { legalMove, legalPrefix, standardUci } from '../chess/notation';
import { capturedBy, hangingLoss, seeMove } from '../chess/see';
import type { PvLine, SearchResult } from '../engine/uci';
import { immediateFactsFromPosition, sortFacts } from './immediate';

export type LineFact = Extract<Fact, { type: 'line' }>;
export type ThreatFact = Extract<Fact, { type: 'threat' }>;
export type ForcedReplyFact = Extract<Fact, { type: 'forced-reply' }>;

/** Fact types kept for each narrated step (and for a threat move). */
export const STEP_FACT_TYPES: ReadonlySet<Fact['type']> = new Set<Fact['type']>([
  'checkmate', 'stalemate', 'fork', 'skewer', 'discovered-attack', 'pin', 'capture', 'promotion', 'check', 'attack',
]);
export const MAX_STEP_FACTS = 2;
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

const isCapture = (pos: ReturnType<typeof positionFromFen>, uci: string): boolean => {
  const m = legalMove(pos, uci);
  if (!m) return false;
  const target = pos.board.get(m.to);
  if (target && target.color !== pos.turn) return true;
  return pos.board.get(m.from)?.role === 'pawn' && m.to === pos.epSquare;
};

/** No piece of either side can be won right now (SEE): the material count is not about to change. */
export function isStable(pos: ReturnType<typeof positionFromFen>): boolean {
  for (const sq of pos.board.occupied.diff(pos.board.king)) if (hangingLoss(pos, sq) > 0) return false;
  return true;
}

/** Number of PV plies to narrate (see header). `pv` is trimmed to its legal prefix first. */
export function narrationPlies(fenBefore: string, pv: readonly string[], settings: AnalysisSettings, score?: Score): number {
  const legal = legalPrefix(fenBefore, pv);
  const { shortLineMinPlies: min, shortLineMaxPlies: max } = settings.explain;
  if (legal.length === 0) return 0;
  // a mate that fits: narrate to the mate
  if (score?.mate !== undefined && score.mate !== 0) {
    const plies = score.mate > 0 ? 2 * score.mate - 1 : 2 * -score.mate;
    if (plies <= max && plies <= legal.length) return plies;
  }
  const pos = positionFromFen(fenBefore);
  let n = 0;
  let lastTactical = false;
  for (; n < legal.length; n++) {
    if (n >= max) break;
    if (n >= min && !lastTactical && !isCapture(pos, legal[n]!) && isStable(pos)) break;
    const m = legalMove(pos, legal[n]!)!;
    const cap = isCapture(pos, legal[n]!);
    pos.play(m);
    const ctx = pos.ctx();
    lastTactical = cap || !!m.promotion || ctx.checkers.nonEmpty();
    if (pos.isCheckmate(ctx)) {
      n++;
      break;
    }
  }
  return n;
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

/** Opponent replies to verify for forcedness: odd PV indices < min(narrated plies, budget.forcednessPlies). */
export function forcednessChecks(fenBefore: string, pv: readonly string[], plies: number, settings: AnalysisSettings): ForcednessCheck[] {
  const legal = legalPrefix(fenBefore, pv).slice(0, Math.min(plies, settings.budget.forcednessPlies));
  const pos = positionFromFen(fenBefore);
  const out: ForcednessCheck[] = [];
  for (let i = 0; i < legal.length; i++) {
    const fen = makeFen(pos.toSetup());
    if (i % 2 === 1) out.push({ index: i, fen, uci: legal[i]!, legalMoves: countLegalMoves(fen) });
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
}

export interface NarratedLine {
  line: LineFact;
  forcedReplies: ForcedReplyFact[];
  /** Position at the end of the narrated steps. */
  endFen: string;
}

function netPieces(moves: ReturnType<typeof lineMaterial>['moves'], mover: Color): { won: PieceRole[]; lost: PieceRole[] } {
  const won: PieceRole[] = [];
  const lost: PieceRole[] = [];
  for (const m of moves) {
    const gain = m.color === mover ? won : lost;
    const loss = m.color === mover ? lost : won;
    if (m.captured) gain.push(m.captured.role);
    if (m.promotion) {
      gain.push(m.promotion);
      loss.push('pawn');
    }
  }
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

/** Narrate the first plies of `pv` from `fenBefore` (the mover = side to move at fenBefore). */
export function narrateLine(fenBefore: string, pv: readonly string[], opts: NarrateOptions): NarratedLine {
  const { settings } = opts;
  const legal = legalPrefix(fenBefore, pv);
  const plies = Math.min(opts.plies ?? narrationPlies(fenBefore, legal, settings, opts.score), legal.length);
  const pos = positionFromFen(fenBefore);
  const mover = pos.turn;
  const steps: LineStep[] = [];
  const forcedReplies: ForcedReplyFact[] = [];
  let prev = opts.prev ?? undefined;
  let mateBy: Color | null = null;
  let anyCapture = false;
  for (let i = 0; i < plies; i++) {
    const uci = legal[i]!;
    const move = legalMove(pos, uci)!;
    const fen = makeFen(pos.toSetup());
    const color = pos.turn;
    const san = makeSan(pos, move);
    const facts = stepFacts(immediateFactsFromPosition(pos, uci, prev ? { prev } : {}));
    if (facts.some((f) => f.type === 'capture') || isCapture(pos, uci)) anyCapture = true;
    const step: LineStep = { ply: i + 1, san, uci: standardUci(pos, move), color, facts };
    steps.push(step);
    pos.play(move);
    const fi = opts.forced?.get(i);
    // a mating move is not 'forced' in the reader's sense (it is simply the end)
    if (fi?.forced && color !== mover && !pos.isCheckmate()) {
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

  // material at the quiet point of the narrated line
  let lm = lineMaterial(fenBefore, legal.slice(0, steps.length), { horizonPlies: steps.length });
  if (steps.length < legal.length && !mateBy) {
    // narration capped while material was still changing: measure at the PV's quiet point further on
    if (!isStable(pos)) lm = lineMaterial(fenBefore, legal, { horizonPlies: Math.max(steps.length, settings.material.quietHorizonPlies) });
    else if (!lm.quiet) lm = lineMaterial(fenBefore, legal, { horizonPlies: steps.length });
  }
  const { won, lost } = netPieces(lm.moves, mover);
  if (lm.moves.some((m) => m.captured)) anyCapture = true;

  let result: LineFact['result'];
  let mateIn: number | undefined;
  const sm = opts.score?.mate;
  if (sm !== undefined && sm !== 0) {
    result = sm > 0 ? 'mate' : 'mated';
    mateIn = Math.abs(sm);
  } else if (mateBy) {
    result = mateBy === mover ? 'mate' : 'mated';
    mateIn = Math.ceil(steps.filter((s) => s.color === mateBy).length);
  } else if (lm.delta >= 1) result = 'wins-material';
  else if (lm.delta <= -1) result = 'loses-material';
  else if (anyCapture) result = 'trade';
  else result = 'quiet';

  const line: LineFact = { type: 'line', steps, materialDelta: lm.delta, result };
  if (mateIn !== undefined) line.mateIn = mateIn;
  if (won.length) line.won = won;
  if (lost.length) line.lost = lost;
  if (lm.plies > steps.length) line.measuredAt = lm.plies;
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
