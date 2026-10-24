// Move classification: every label rule of SPEC.md "Move labels", incl. the material rule, Miss, Great, Forced
// and Book. Pure functions: no engine calls; all thresholds come from `AnalysisSettings` (shared/src/settings.ts).
//
// Conventions
//  - Every `Score` in the inputs is from the MOVER's POV, i.e. exactly what the engine reports for `fenBefore`
//    (UCI scores are side-to-move POV and the mover is the side to move at fenBefore). Do not flip them.
//  - Win% (0..100) and winLoss are mover POV, computed with the Lichess formula (shared/winchance.ts): cp clamped
//    to +-1000, mate for the mover = +1000 cp, mated = -1000 cp.
//  - Each rule is documented once, at the function that implements it.

import type { Color, Label, MaterialCheck, MoveAnalysis, PieceRef, Score } from '@chess-coach/shared';
import { type AnalysisSettings, scoreToCp, winPercentFromScore } from '@chess-coach/shared';
import { normalizeMove } from 'chessops/chess';
import type { NormalMove } from 'chessops/types';
import { parseUci } from 'chessops/util';
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

const moverMates = (line: LineMaterialResult, score: Score) => line.mate === 'mover' || (score.mate ?? 0) > 0;

/**
 * SPEC "Material rule". Measures the material the played move throws away compared with the best move:
 *
 * - Each line (played PV and best PV, both from fenBefore and including the move itself) is played to a quiet
 *   point with `lineMaterial` (`settings.material.quietHorizonPlies` plies, extended through captures and
 *   promotions) and the mover's material balance there is taken.
 * - Reference = the best line's balance, capped at the *baseline* = the material the mover already has: the
 *   balance at fenBefore, or — if the opponent's previous move changed it (e.g. they just captured and a
 *   recapture is pending) — the higher balance before that move (`prevFenBefore`). The cap means a material
 *   *gain* the played move fails to make (not taking a hanging piece) is not counted as material thrown away;
 *   that is the job of the win-chance label and Miss. (Interpretation: SPEC compares with the best line directly,
 *   which would turn every missed free piece into a "material" Blunder and make Miss unreachable.)
 *   If the best line is a forced mate for the mover, its material is meaningless (sacrifices on the way to mate),
 *   so the reference is the baseline.
 * - `loss = max(0, reference - playedLine)`; `evalDropCp = clampedCp(best) - clampedCp(played)` (mover POV,
 *   clamped to +-1000 like win%).
 * - `loss >= blunderMinLoss` (3) and `evalDropCp >= blunderMinEvalDropCp` (250) -> at least Blunder;
 *   else `loss >= mistakeMinLoss` (2) and `evalDropCp >= mistakeMinEvalDropCp` (150) -> at least Mistake.
 *   The eval-drop guard exempts correct sacrifices (material goes, eval doesn't); even trades lose no material.
 * - A played move that still forces mate is never flagged (material is irrelevant when you mate).
 * - `hung`: best-effort, the mover's piece that is first captured for nothing in the played line (see `findHung`).
 */
export function materialCheck(input: MaterialCheckInput, settings: AnalysisSettings): MaterialCheck {
  const m = settings.material;
  const opts = { horizonPlies: m.quietHorizonPlies };
  const played = lineMaterial(input.fenBefore, input.playedPv, opts);
  const best = lineMaterial(input.fenBefore, input.bestPv, opts);
  const evalDropCp = scoreToCp(input.bestScore) - scoreToCp(input.playedScore);

  let baseline = played.startBalance;
  if (input.prevFenBefore) {
    try {
      const prevPos = positionFromFen(input.prevFenBefore);
      // the previous move was the opponent's: at prevFenBefore the opponent is to move
      if (prevPos.turn !== played.mover) baseline = Math.max(baseline, materialBalance(prevPos.board, played.mover));
    } catch {
      // ignore an unusable prevFenBefore
    }
  }

  const reference = moverMates(best, input.bestScore) ? baseline : Math.min(best.balance, baseline);
  if (moverMates(played, input.playedScore)) {
    return { playedLine: played.balance, bestLine: reference, loss: 0, evalDropCp };
  }
  const loss = Math.max(0, reference - played.balance);
  const result: MaterialCheck = { playedLine: played.balance, bestLine: reference, loss, evalDropCp };
  if (loss >= m.blunderMinLoss && evalDropCp >= m.blunderMinEvalDropCp) result.label = 'blunder';
  else if (loss >= m.mistakeMinLoss && evalDropCp >= m.mistakeMinEvalDropCp) result.label = 'mistake';
  if (loss > 0) {
    const hung = findHung(played.moves, played.mover);
    if (hung) result.hung = hung;
  }
  return result;
}

/**
 * Best-effort "hung piece" of a line. The line is split into exchanges = maximal runs of consecutive captures
 * landing on the same square. The first exchange in which the opponent captures a mover's piece and the mover
 * comes out behind (net material < 0) gives the hung piece: the first mover piece captured in it.
 * (An even trade such as Qxd8 Rxd8 nets 0 and is not a hung piece; Qxd5 exd5 nets -8 and hangs the queen.)
 */
export function findHung(moves: readonly LineMove[], mover: Color): PieceRef | undefined {
  let i = 0;
  while (i < moves.length) {
    if (!moves[i]!.captured) {
      i++;
      continue;
    }
    const to = moves[i]!.uci.slice(2, 4);
    let net = 0;
    let first: PieceRef | undefined;
    let j = i;
    for (; j < moves.length; j++) {
      const mv = moves[j]!;
      if (!mv.captured || mv.uci.slice(2, 4) !== to) break;
      if (mv.color === mover) {
        net += PIECE_VALUES[mv.captured.role];
      } else {
        net -= PIECE_VALUES[mv.captured.role];
        first ??= { role: mv.captured.role, square: mv.captured.square, color: mover };
      }
    }
    if (first && net < 0) return first;
    i = j;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Great / Miss

/**
 * SPEC "Great !": the played move is Best (engine #1) **and** the engine's 2nd-best move would be a Mistake or
 * worse (`winLoss(2nd) >= great.secondBestMinLoss`) **and** the position wasn't already decided: mover's win%
 * after the best move within [great.minWinAfterBest, great.maxWinAfterBest], or the 2nd best throws away a win
 * (win% after best >= maxWinAfterBest and win% after 2nd best < great.throwsAwayWinBelow). Requires
 * >= great.minLegalMoves legal moves.
 * Interpretation (not in SPEC): an obvious take-back — the played move captures on the square the opponent's
 * previous move just landed on (recapture, or taking the piece that just moved) — is not Great: it is "only move"
 * by the numbers, but praising every recapture would drown the label. Needs `prev.uci`.
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
 *     worse of 4. and the material label (`LABEL_SEVERITY`).
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
  }

  const book = input.book;
  if (book?.after && book.beforeIsStartOrBook && book.earlierMovesAllBook !== false && LABEL_SEVERITY[label] < LABEL_SEVERITY.miss) {
    return result('book');
  }
  return result(label);
}
