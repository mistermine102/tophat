// Move classification: every label rule of SPEC.md "Move labels", incl. the material rule, Miss, Great, Forced
// and Book. Pure functions: no engine calls; all thresholds come from `AnalysisSettings` (shared/src/settings.ts).
//
// Conventions
//  - Every `Score` in the inputs is from the MOVER's POV, i.e. exactly what the engine reports for `fenBefore`
//    (UCI scores are side-to-move POV and the mover is the side to move at fenBefore). Do not flip them.
//  - Win% (0..100) and winLoss are mover POV, computed with the Lichess formula (shared/winchance.ts): cp clamped
//    to +-1000, mate for the mover = +1000 cp, mated = -1000 cp.
//  - Each rule is documented once, at the function that implements it.

import type { AllowedMate, Color, Label, LostPiece, MaterialCheck, MissedMate, MoveAnalysis, PieceRef, Score } from '@chess-coach/shared';
import { type AnalysisSettings, winPercentFromScore } from '@chess-coach/shared';
import { normalizeMove } from 'chessops/chess';
import type { NormalMove } from 'chessops/types';
import { parseSquare, parseUci } from 'chessops/util';
import { hangingLoss, see, seeMove } from '../chess/see';
import { makeBoardFen } from 'chessops/fen';
import { type LineMaterialResult, type LineMove, lineMaterial, materialBalance, PIECE_VALUES, positionFromFen } from '../chess/material';

// ---------------------------------------------------------------------------------------------------------------
// Input / output types

/** One engine line for a move at `fenBefore`. */
export interface EngineMoveLine {
  /** The move, UCI (castling king-to-square `e1g1`; king-takes-rook `e1h1` is accepted too). */
  uci: string;
  /** Deep-search score of this move, mover POV (= the engine's side-to-move score at fenBefore). */
  score: Score;
  /** Principal variation starting with `uci` (UCI moves). May be empty/short; illegal tails are ignored. */
  pv: string[];
}

/** Context about the opponent's previous move (the move that led to `fenBefore`). Enables Miss. */
export interface PrevMoveContext {
  /** winLoss of the opponent's previous move (opponent POV, as computed by classifyMove for that move). */
  winLoss: number;
  /** Opponent's win% before their move (opponent POV) = win% of their best move. */
  winBefore: number;
  /** Opponent's win% after their move (opponent POV) = win% of the move they played. */
  winAfter: number;
  /**
   * Position before the opponent's move (optional). Used as the material-rule baseline when the opponent's move
   * was a capture (the mover is entitled to recapture), see `materialCheck`.
   */
  fenBefore?: string;
  /** The opponent's move, UCI (optional). Used to exclude obvious take-backs from Great, see `isGreat`. */
  uci?: string;
}

export interface BookInput {
  /** Opening-book entry of the position after the move (book.ts `lookupBook(fenAfter)`), or null. */
  after: { eco: string; name: string } | null;
  /** Position before the move is the standard initial position or in the book (book.ts `bookInfo`). */
  beforeIsStartOrBook: boolean;
  /**
   * SPEC chain rule: every earlier move of the game was labelled Book. The caller (M2) knows the game; omit or
   * pass `undefined` when unknown (treated as true), `false` breaks the chain.
   */
  earlierMovesAllBook?: boolean;
}

export interface ClassifyInput {
  /** Position before the move (FEN). The mover is the side to move. */
  fenBefore: string;
  /** Number of legal moves at fenBefore (see `countLegalMoves`). */
  legalMoveCount: number;
  /** The played move with its deep score and PV (from the MultiPV search, or a `searchmoves=[move]` search). */
  played: EngineMoveLine;
  /** True if the played move is the engine's #1 move. Also detected automatically when `played.uci === best.uci`. */
  playedIsBest: boolean;
  /** Engine #1 line (deep MultiPV rank 1). */
  best: EngineMoveLine;
  /** Engine #2 line (deep MultiPV rank 2), if the engine reported one. Needed for Great. */
  second?: EngineMoveLine | null;
  /** Opening-book info; omit when not checked (no Book label then). */
  book?: BookInput | null;
  /** The opponent's previous move; omit for the first move of a game/line (no Miss then). */
  prev?: PrevMoveContext | null;
}

export type LabelReason = MoveAnalysis['labelReason'];

export interface ClassifyResult {
  label: Label;
  labelReason: LabelReason;
  /** Mover's win% after the best move / after the played move, and their difference (>= 0). */
  winBest: number;
  winPlayed: number;
  winLoss: number;
  /** The played move delivers checkmate. */
  checkmate: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers

/** Severity used for "worse of" (SPEC): Blunder > Miss > Mistake > Inaccuracy > Good > Excellent > Best/Great/Book/Forced. */
export const LABEL_SEVERITY: Readonly<Record<Label, number>> = Object.freeze({
  forced: 0,
  book: 0,
  best: 0,
  great: 0,
  excellent: 1,
  good: 2,
  inaccuracy: 3,
  mistake: 4,
  miss: 5,
  blunder: 6,
});

/** The more severe of two labels (ties keep `a`). */
export function worseLabel(a: Label, b: Label | undefined): Label {
  if (b === undefined) return a;
  return LABEL_SEVERITY[b] > LABEL_SEVERITY[a] ? b : a;
}

/** Number of legal moves in `fen`. */
export function countLegalMoves(fen: string): number {
  const pos = positionFromFen(fen);
  let n = 0;
  for (const [from, dests] of pos.allDests()) {
    for (const to of dests) {
      // promotions count once per piece type (4 moves)
      const promo = pos.board.pawn.has(from) && (to >> 3 === 0 || to >> 3 === 7);
      n += promo ? 4 : 1;
    }
  }
  // chessops lists a castle once (as king-takes-rook), so each castle is counted once
  return n;
}

/** True if UCI moves `a` and `b` are the same move in `fen` (castling `e1g1` == `e1h1`). */
export function sameMoveUci(fen: string, a: string, b: string): boolean {
  if (a === b) return true;
  const ma = parseUci(a);
  const mb = parseUci(b);
  if (!ma || !mb || !('from' in ma) || !('from' in mb)) return false;
  const pos = positionFromFen(fen);
  const na = normalizeMove(pos, ma) as NormalMove;
  const nb = normalizeMove(pos, mb) as NormalMove;
  return na.from === nb.from && na.to === nb.to && (ma.promotion ?? null) === (mb.promotion ?? null);
}

/** PV that starts with `uci` (if `pv[0]` isn't the move, the PV is unusable: fall back to just the move). */
function pvFor(line: EngineMoveLine, fen: string): string[] {
  if (line.pv.length > 0 && sameMoveUci(fen, line.pv[0]!, line.uci)) return line.pv;
  return [line.uci];
}

// ---------------------------------------------------------------------------------------------------------------
// Win-chance label

/**
 * SPEC win-chance bands (thresholds `settings.labels`, all inclusive upper bounds):
 * Best `winLoss <= bestMaxLoss` (0.5), Excellent `<= excellentMaxLoss` (2), Good `<= goodMaxLoss` (5),
 * Inaccuracy `<= inaccuracyMaxLoss` (10), Mistake `<= mistakeMaxLoss` (20), Blunder above.
 * (The "engine #1 is always Best" part of the Best rule is applied in `classifyMove`.)
 */
export function labelFromWinLoss(winLoss: number, settings: AnalysisSettings): Label {
  const t = settings.labels;
  if (winLoss <= t.bestMaxLoss) return 'best';
  if (winLoss <= t.excellentMaxLoss) return 'excellent';
  if (winLoss <= t.goodMaxLoss) return 'good';
  if (winLoss <= t.inaccuracyMaxLoss) return 'inaccuracy';
  if (winLoss <= t.mistakeMaxLoss) return 'mistake';
  return 'blunder';
}

// ---------------------------------------------------------------------------------------------------------------
// Material rule

export interface MaterialCheckInput {
  fenBefore: string;
  /** PV of the played move (starting with the move). */
  playedPv: readonly string[];
  /** PV of the engine's best move (starting with that move). */
  bestPv: readonly string[];
  /** Deep scores, mover POV. */
  playedScore: Score;
  bestScore: Score;
  /** Position before the opponent's previous move (optional), see the baseline below. */
  prevFenBefore?: string;
}

/** Mate scores in the material guard: +-(MATE_CP - MATE_STEP_CP * distance); `mate: 0` (mated now) = -MATE_CP. */
export const MATE_CP = 100_000;
export const MATE_STEP_CP = 100;

/**
 * Unclamped centipawns for the material rule's eval-drop guard (mover POV). Mate in n for the mover =
 * MATE_CP - 100n (a faster mate is worth more), getting mated in n = -(MATE_CP - 100n). Win% does NOT use this.
 */
export function guardCp(score: Score): number {
  if (score.mate !== undefined) {
    const n = Math.abs(score.mate);
    if (score.mate === 0) return -MATE_CP;
    return Math.sign(score.mate) * (MATE_CP - MATE_STEP_CP * Math.min(n, 999));
  }
  if (score.cp !== undefined) return score.cp;
  throw new Error('guardCp: score has neither cp nor mate');
}

const moverMates = (line: LineMaterialResult, score: Score) => line.mate === 'mover' || (score.mate ?? 0) > 0;

/**
 * SPEC "Material rule". Measures the material the played move throws away compared with the best move:
 *
 * - Each line (played PV and best PV, both from fenBefore and including the move itself) is played to a quiet
 *   point with `lineMaterial` (`settings.material.quietHorizonPlies` plies, extended through captures and
 *   promotions) and the mover's material balance there is taken.
 * - Reference = the best line's balance, capped at the *baseline* = the material the mover already has: the
 *   balance at fenBefore, or — if the opponent's previous move changed it and a recapture is pending — the higher
 *   balance before that move (`prevFenBefore`), but only as far as the exchange on that square can win it back
 *   (see `materialBaseline`; M3 fix: 42.Kxe3 taking a queen that can't be recaptured left the old baseline in
 *   place, so every later move "threw away" 8 pawns). The cap means a material
 *   *gain* the played move fails to make (not taking a hanging piece) is not counted as material thrown away;
 *   that is the job of the win-chance label and Miss. (Interpretation: SPEC compares with the best line directly,
 *   which would turn every missed free piece into a "material" Blunder and make Miss unreachable.)
 *   If the best line is a forced mate for the mover, its material is meaningless (sacrifices on the way to mate),
 *   so the reference is the baseline.
 * - `loss = max(0, reference - playedLine)`; `evalDropCp = guardCp(best) - guardCp(played)` (mover POV) on
 *   UNCLAMPED centipawns, mates mapped to +-(100000 - 100 * distance) (see `guardCp`). Deviation from SPEC
 *   ("clamped"), requested by the user: with clamping, hanging the queen at +20 -> +11, or while having a forced
 *   mate, showed no drop and was never flagged. Win% / winLoss stay clamped. Material loss is the primary signal;
 *   the guard only exempts sacrifices, and a real hang drops the eval by far more than the threshold even when
 *   the engine's cp is noisy at huge evals.
 * - `loss >= blunderMinLoss` (3) and `evalDropCp >= blunderMinEvalDropCp` (250) -> at least Blunder;
 *   else `loss >= mistakeMinLoss` (2) and `evalDropCp >= mistakeMinEvalDropCp` (150) -> at least Mistake.
 *   The eval-drop guard exempts correct sacrifices (material goes, eval doesn't); even trades lose no material.
 * - A played move that still forces mate is never flagged (material is irrelevant when you mate).
 * - Already lost (M3): when even the best move leaves the mover at <= -`material.lostPositionCp` (9 pawns, win% <= 3.5) or
 *   mated, the rule fires only for a piece the move leaves hanging (`hung`, not `hungAlready`). In a lost position the winning side
 *   has many winning plans and its PV picks one arbitrarily, so the material difference between two lines measured
 *   12 plies deep is noise (benchmark: promotion races in dead-lost pawn endings, spite checks in the PV) —
 *   whereas leaving a piece en prise is still the habit to fix.
 * - `lostInLine` (when loss > 0): the mover's pieces lost for nothing in the played line, with the ply (see
 *   `lostInLine`); `hung`: one of them that is en prise right after the move (see `findHung`), else absent;
 *   `hungLoss`: its static-exchange loss (`hungSeeLoss`, = the Immediate 'hangs' number).
 */
export function materialCheck(input: MaterialCheckInput, settings: AnalysisSettings): MaterialCheck {
  const m = settings.material;
  const opts = { horizonPlies: m.quietHorizonPlies };
  const played = lineMaterial(input.fenBefore, input.playedPv, opts);
  const best = lineMaterial(input.fenBefore, input.bestPv, opts);
  const evalDropCp = guardCp(input.bestScore) - guardCp(input.playedScore);

  const baseline = input.prevFenBefore ? materialBaseline(input.fenBefore, input.prevFenBefore, played.startBalance) : played.startBalance;

  const reference = moverMates(best, input.bestScore) ? baseline : Math.min(best.balance, baseline);
  if (moverMates(played, input.playedScore)) {
    return { playedLine: played.balance, bestLine: reference, loss: 0, evalDropCp };
  }
  const loss = Math.max(0, reference - played.balance);
  const result: MaterialCheck = { playedLine: played.balance, bestLine: reference, loss, evalDropCp };
  if (loss >= m.blunderMinLoss && evalDropCp >= m.blunderMinEvalDropCp) result.label = 'blunder';
  else if (loss >= m.mistakeMinLoss && evalDropCp >= m.mistakeMinEvalDropCp) result.label = 'mistake';
  if (loss > 0) {
    const lost = lostInLine(played.moves, played.mover);
    if (lost.length) result.lostInLine = lost;
    const hung = findHung(input.fenBefore, played.moves, played.mover, lost);
    if (hung) {
      result.hung = hung;
      const hl = hungSeeLoss(input.fenBefore, input.playedPv[0]!, hung.square);
      if (hl > 0) result.hungLoss = hl;
      if (wasHangingBefore(input.fenBefore, input.playedPv[0]!, hung.square)) result.hungAlready = true;
    }
  }
  // already lost: only a piece the move itself leaves hanging counts (see the doc comment)
  if (result.label && !(result.hung && !result.hungAlready) && guardCp(input.bestScore) <= -m.lostPositionCp) delete result.label;
  return result;
}

/**
 * Material baseline for the material rule: the mover's balance now, raised towards the balance before the
 * opponent's previous move only by what the mover can win back on that move's destination square (static
 * exchange `see`, mover to move). A capture that can be recaptured keeps the mover's entitlement (QxP, PxQ
 * pending: baseline = before); a capture that can't be answered (the king took an undefended queen) doesn't.
 */
export function materialBaseline(fenBefore: string, prevFenBefore: string, balanceNow: number): number {
  try {
    const pos = positionFromFen(fenBefore);
    const prevPos = positionFromFen(prevFenBefore);
    // the previous move was the opponent's: at prevFenBefore the opponent is to move
    if (prevPos.turn === pos.turn) return balanceNow;
    const prevBalance = materialBalance(prevPos.board, pos.turn);
    if (prevBalance <= balanceNow) return balanceNow;
    // the opponent's move: the legal move from prevFenBefore that reaches fenBefore's board
    const target = makeBoardFen(pos.board);
    for (const [from, dests] of prevPos.allDests()) {
      for (const to of dests) {
        const promos = prevPos.board.pawn.has(from) && (to >> 3 === 0 || to >> 3 === 7) ? (['queen', 'rook', 'bishop', 'knight'] as const) : [undefined];
        for (const promotion of promos) {
          const next = prevPos.clone();
          next.play(promotion ? { from, to, promotion } : { from, to });
          if (makeBoardFen(next.board) !== target) continue;
          const sq = next.board.get(to) ? to : undefined;
          const winBack = sq === undefined ? 0 : see(pos, sq, pos.turn);
          return Math.max(balanceNow, Math.min(prevBalance, balanceNow + winBack));
        }
      }
    }
    return balanceNow;
  } catch {
    return balanceNow; // an unusable prevFenBefore
  }
}

/**
 * The mover's pieces lost in a line. The line is split into exchanges = maximal runs of consecutive captures
 * landing on the same square. Every exchange in which the opponent captures a mover's piece and the mover comes
 * out behind (net material < 0) contributes its first captured mover piece, with the line ply of that capture
 * and the square it was captured on. (An even trade such as Qxd8 Rxd8 nets 0; Qxd5 exd5 nets -8 and loses the queen.)
 */
export function lostInLine(moves: readonly LineMove[], mover: Color): LostPiece[] {
  const out: LostPiece[] = [];
  let i = 0;
  while (i < moves.length) {
    if (!moves[i]!.captured) {
      i++;
      continue;
    }
    const to = moves[i]!.uci.slice(2, 4);
    let net = 0;
    let first: LostPiece | undefined;
    let j = i;
    for (; j < moves.length; j++) {
      const mv = moves[j]!;
      if (!mv.captured || mv.uci.slice(2, 4) !== to) break;
      if (mv.color === mover) {
        net += PIECE_VALUES[mv.captured.role];
      } else {
        net -= PIECE_VALUES[mv.captured.role];
        first ??= { role: mv.captured.role, square: mv.captured.square, color: mover, ply: mv.ply };
      }
    }
    if (first && net < 0) out.push(first);
    i = j;
  }
  return out;
}

/**
 * The "hung" piece of a line: a lost piece (`lostInLine`) that is en prise RIGHT AFTER the move — it stands on the
 * square where it is later captured, untouched by the line until then, and the opponent's SEE against it is > 0 in
 * the position after the move. A piece that only becomes loose later in the line (it moves there, or a defender is
 * deflected first) is not "hung" — the loss happens in the follow-up, and `MaterialCheck.lostInLine` says so.
 * (M3 fix: before, the first lost piece of the whole line was called hung, e.g. Opera game 10...cxb5 "leaves the
 * knight on d7 hanging" for a knight that only reached d7 three moves later.)
 */
export function findHung(fenBefore: string, moves: readonly LineMove[], mover: Color, lost: readonly LostPiece[] = lostInLine(moves, mover)): PieceRef | undefined {
  if (moves.length === 0) return undefined;
  const pos = positionFromFen(fenBefore);
  const first = parseUci(moves[0]!.uci);
  if (!first || !pos.isLegal(first)) return undefined;
  pos.play(normalizeMove(pos, first));
  for (const l of lost) {
    const sq = parseSquare(l.square);
    if (sq === undefined) continue;
    const piece = pos.board.get(sq);
    if (!piece || piece.color !== mover || piece.role !== l.role) continue;
    // the piece must stand there untouched from the move until it is captured
    const touched = moves.some((m) => m.ply > 1 && m.ply < l.ply && (m.uci.slice(0, 2) === l.square || m.uci.slice(2, 4) === l.square));
    if (touched) continue;
    if (hangingLoss(pos, sq) > 0) return { role: l.role, square: l.square, color: mover };
  }
  return undefined;
}

/** The piece on `square` after the move stood there before the move (it isn't the moved piece) and was en prise already. */
export function wasHangingBefore(fenBefore: string, uci: string, square: string): boolean {
  if (uci.slice(2, 4) === square || uci.slice(0, 2) === square) return false;
  const sq = parseSquare(square);
  if (sq === undefined) return false;
  return hangingLoss(positionFromFen(fenBefore), sq) > 0;
}

/**
 * Static-exchange loss of the hung piece right after the move — the same number as the Immediate 'hangs' fact
 * (facts/immediate.ts): for the moved piece the move's net SEE (`-seeMove`, so a capture's gain is counted), for
 * another piece the opponent's SEE against it. MaterialCheck.loss is the line-based comparison with the best move
 * and can differ (the line may win something back, or lose more).
 */
export function hungSeeLoss(fenBefore: string, uci: string, square: string): number {
  const pos = positionFromFen(fenBefore);
  const move = parseUci(uci);
  if (!move || !('from' in move) || !pos.isLegal(move)) return 0;
  if (uci.slice(2, 4) === square) return Math.max(0, -seeMove(pos, uci));
  pos.play(normalizeMove(pos, move));
  const sq = parseSquare(square);
  return sq === undefined ? 0 : hangingLoss(pos, sq);
}

// ---------------------------------------------------------------------------------------------------------------
// Great / Miss

/**
 * SPEC "Great !": the played move is Best (engine #1) **and** the engine's 2nd-best move would be a Mistake or
 * worse (`winLoss(2nd) >= great.secondBestMinLoss`) **and** the position wasn't already decided: mover's win%
 * after the best move within [great.minWinAfterBest, great.maxWinAfterBest], or the 2nd best throws away a win
 * (win% after best >= maxWinAfterBest and win% after 2nd best < great.throwsAwayWinBelow). Requires
 * >= great.minLegalMoves legal moves.
 * Interpretation (not in SPEC): obvious only-moves are not Great — they are "only move" by the numbers, but
 * praising them would drown the label (chess.com gives Great rarely; M3 benchmark: 60 Lichess games). Excluded:
 *  - a take-back: the played move captures on the square the opponent's previous move just landed on (recapture,
 *    or taking the piece that just moved). Needs `prev.uci`.
 *  - a check evasion with few options: in check with <= `great.maxLegalMovesInCheck` (3) legal moves.
 *  - grabbing free material: a capture whose static exchange alone wins >= `great.freeCaptureMinGain` (1) pawn
 *    (`seeMove`), e.g. taking a hanging piece or a free pawn. A capture that only works tactically (SEE <= 0)
 *    can still be Great.
 *  - the continuation of a combination: the opponent's previous move was their only legal move (`prev.fenBefore`),
 *    so this position was already on the board when the mover chose the previous move.
 * Returns the 2nd best's winLoss if Great, else null.
 */
function isGreat(input: ClassifyInput, playedIsBest: boolean, winBest: number, settings: AnalysisSettings): number | null {
  const g = settings.great;
  if (!playedIsBest || input.legalMoveCount < g.minLegalMoves || !input.second) return null;
  if (sameMoveUci(input.fenBefore, input.second.uci, input.best.uci)) return null;
  const winSecond = winPercentFromScore(input.second.score);
  const secondBestLoss = winBest - winSecond;
  if (secondBestLoss < g.secondBestMinLoss) return null;
  const undecided = winBest >= g.minWinAfterBest && winBest <= g.maxWinAfterBest;
  const throwsAwayWin = winBest >= g.maxWinAfterBest && winSecond < g.throwsAwayWinBelow;
  if (!undecided && !throwsAwayWin) return null;
  if (input.prev?.uci && isTakeBack(input.fenBefore, input.played.uci, input.prev.uci)) return null;
  const pos = positionFromFen(input.fenBefore);
  if (pos.isCheck() && input.legalMoveCount <= g.maxLegalMovesInCheck) return null;
  if (seeMove(pos, input.played.uci) >= g.freeCaptureMinGain) return null;
  if (input.prev?.fenBefore && countLegalMoves(input.prev.fenBefore) === 1) return null;
  return secondBestLoss;
}

/** The move captures on the destination square of the opponent's previous move. */
function isTakeBack(fenBefore: string, uci: string, prevUci: string): boolean {
  const move = parseUci(uci);
  const prev = parseUci(prevUci);
  if (!move || !prev || !('from' in move)) return false;
  const pos = positionFromFen(fenBefore);
  const target = pos.board.get(move.to);
  return prev.to === move.to && !!target && target.color !== pos.turn;
}

/**
 * SPEC "Miss" (precise definition): the opponent's previous move was a Mistake or worse by win chance
 * (`prev.winLoss >= miss.opponentMinLoss`), the best move now keeps at least `miss.keepGainFraction` of that gain
 * (`winBest - (100 - prev.winBefore) >= keepGainFraction * prev.winLoss`, i.e. measured from the mover's win% before
 * the opponent's mistake), and the played move gives back more than an inaccuracy's worth
 * (`winLoss > miss.playedMinLoss`). Miss replaces Inaccuracy/Mistake; a Blunder stays a Blunder.
 */
function missApplies(prev: PrevMoveContext | null | undefined, winBest: number, winLoss: number, settings: AnalysisSettings): boolean {
  if (!prev) return false;
  const r = settings.miss;
  if (!(prev.winLoss >= r.opponentMinLoss)) return false;
  const moverWinBeforeMistake = 100 - prev.winBefore;
  const kept = winBest - moverWinBeforeMistake;
  if (kept < r.keepGainFraction * prev.winLoss) return false;
  return winLoss > r.playedMinLoss;
}

/**
 * Mate rules (M3, user requirement — same philosophy as the material rule: honest labels for bad habits even when
 * the position is already decided, where the win% clamp hides everything). Only for a played move that isn't the
 * engine's #1 move and doesn't itself deliver mate; scores are the deep scores, mover POV.
 * - **Allowed mate**: the played move's score is mated-in-n with n <= `mate.allowedMaxMoves` (3) and the best
 *   move is not mated, or only in m >= n + `mate.allowedMuchLongerBy` (3) moves -> at least **Blunder**.
 *   E.g. Opera game 15...Nxd7?? (mate in 2: 16.Qb8+! Nxb8 17.Rd8#) when 15...Qxd7 (-10) avoids mate: both are ~2 %
 *   by win chance (clamped to -1000 cp), so it used to be Best. "Much longer" (not just "longer"): when every move
 *   gets mated soon, choosing the mate in 2 over a mate in 3 is not a habit worth a Blunder.
 * - **Missed mate**: the best move mates in n <= `mate.missedMaxMoves` (3) and the played move's score is not a
 *   forced mate for the mover -> at least **Miss** (a Blunder stays a Blunder). A slower mate is not missed.
 */
export function mateRules(input: ClassifyInput, settings: AnalysisSettings): { allowedMate?: AllowedMate; missedMate?: MissedMate } {
  const r = settings.mate;
  const out: { allowedMate?: AllowedMate; missedMate?: MissedMate } = {};
  const pm = input.played.score.mate;
  const bm = input.best.score.mate;
  if (pm !== undefined && pm <= 0) {
    const n = Math.max(1, -pm); // mate: 0 here would mean mated on the board; treat as mate in 1
    const bestMated = bm !== undefined && bm <= 0 ? Math.max(1, -bm) : undefined;
    if (n <= r.allowedMaxMoves && (bestMated === undefined || bestMated >= n + r.allowedMuchLongerBy)) {
      out.allowedMate = { matedIn: n, ...(bestMated !== undefined ? { bestMatedIn: bestMated } : {}) };
    }
  }
  if (bm !== undefined && bm > 0 && bm <= r.missedMaxMoves && !(pm !== undefined && pm > 0)) out.missedMate = { mateIn: bm };
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// classifyMove

/**
 * Label one move. Rules in order of precedence:
 *  1. **Forced** — the played move was the only legal move (`legalMoveCount === 1`); overrides everything.
 *  2. A move that delivers **checkmate** is **Best**.
 *  3. Win-chance label: `winLoss = win%(best) - win%(played)` (>= 0). If the played move is the engine's #1 move
 *     it is **Best** with winLoss 0, whatever score its own search reported (same move, different searches).
 *     Mate scores need no special case: a slower mate keeps win% (mate = +1000 cp) so it stays Best; losing a mate
 *     is classified by the win% that remains; in lost positions the clamp keeps losses small.
 *  4. **Great** (`isGreat`) upgrades Best; **Miss** (`missApplies`) replaces Inaccuracy/Mistake.
 *  5. **Material rule** (`materialCheck`, skipped when the played move is the best move): the final label is the
 *     worse of 4. and the material label (`LABEL_SEVERITY`). Then the **mate rules** (`mateRules`, same skip): an
 *     allowed short mate -> at least Blunder (`labelReason.allowedMate`), a missed short mate -> at least Miss
 *     (`labelReason.missedMate`).
 *  6. **Book** — SPEC: the position after the move is in the opening book and every earlier move was book
 *     (`book.after`, `book.beforeIsStartOrBook`, `book.earlierMovesAllBook !== false`). Interpretation: the Lichess
 *     list also names traps and their victims' moves (e.g. "Barnes Opening: Fool's Mate" 2.g4?? Qh4#, "Noah's Ark
 *     Trap" 8.Qxd4??), so a book move whose label from 1.–5. is Miss or Blunder keeps that label instead of Book.
 *     Dubious-but-known gambits (Mistake or milder, e.g. the Halloween Gambit) stay Book.
 */
export function classifyMove(input: ClassifyInput, settings: AnalysisSettings): ClassifyResult {
  const pos = positionFromFen(input.fenBefore);
  const move = parseUci(input.played.uci);
  if (!move || !('from' in move) || !pos.isLegal(move)) {
    throw new Error(`classifyMove: illegal move ${input.played.uci} in ${input.fenBefore}`);
  }
  const after = pos.clone();
  after.play(move);
  const checkmate = after.isCheckmate();

  const playedIsBest = input.playedIsBest || sameMoveUci(input.fenBefore, input.played.uci, input.best.uci);
  const winBest = winPercentFromScore(input.best.score);
  const winPlayed = playedIsBest ? winBest : winPercentFromScore(input.played.score);
  const winLoss = playedIsBest || checkmate ? 0 : Math.max(0, winBest - winPlayed);
  const winChance: Label = playedIsBest || checkmate ? 'best' : labelFromWinLoss(winLoss, settings);
  const reason: LabelReason = { winChance };
  if (input.book?.after) reason.book = { eco: input.book.after.eco, name: input.book.after.name };
  const result = (label: Label): ClassifyResult => ({ label, labelReason: reason, winBest, winPlayed, winLoss, checkmate });

  if (input.legalMoveCount === 1) return result('forced');
  if (checkmate) return result('best');

  let label: Label = winChance;
  const secondBestLoss = isGreat(input, playedIsBest, winBest, settings);
  if (secondBestLoss !== null) {
    label = 'great';
    reason.great = { secondBestLoss };
  }
  if (missApplies(input.prev, winBest, winLoss, settings)) {
    reason.miss = true;
    if (label === 'inaccuracy' || label === 'mistake') label = 'miss';
  }
  if (!playedIsBest) {
    const material = materialCheck(
      {
        fenBefore: input.fenBefore,
        playedPv: pvFor(input.played, input.fenBefore),
        bestPv: pvFor(input.best, input.fenBefore),
        playedScore: input.played.score,
        bestScore: input.best.score,
        ...(input.prev?.fenBefore ? { prevFenBefore: input.prev.fenBefore } : {}),
      },
      settings,
    );
    reason.material = material;
    label = worseLabel(label, material.label);
    const mate = mateRules(input, settings);
    if (mate.allowedMate) {
      reason.allowedMate = mate.allowedMate;
      label = worseLabel(label, 'blunder');
    }
    if (mate.missedMate) {
      reason.missedMate = mate.missedMate;
      label = worseLabel(label, 'miss');
    }
  }

  const book = input.book;
  if (book?.after && book.beforeIsStartOrBook && book.earlierMovesAllBook !== false && LABEL_SEVERITY[label] < LABEL_SEVERITY.miss) {
    return result('book');
  }
  return result(label);
}
