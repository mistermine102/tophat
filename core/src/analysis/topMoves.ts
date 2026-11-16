// (Engine arrows) The engine's good moves in a position, for the "Show best move" arrows: the deep MultiPV search of
// the position (topParams = the analysis's own deep search, so an analysed position is answered from the cache), each
// line's loss against the best (side to move POV).
// `gap` (feedback round 4) is what the arrows are drawn by: the win-chance loss, or the centipawn loss / GAP_CP_PER_PCT
// when that is larger. Win% hardly moves once a side is far ahead or lost (at −6, letting the opponent queen "costs"
// 2 %), the centipawns still show the difference, so a move that only the best one avoids is punished there too.
// How many: always the best TOP_MIN (the weaker ones drawn faintly), then every move within `labels.excellentMaxLoss`
// gap of the best (almost as good), at most TOP_MAX. An opening with many equal moves gets five arrows, a position with
// one good move one bright arrow and two faint traces.
// (Brilliant lines) `addBrilliants` marks the moves that are sound sacrifices (the Brilliant !! rule of the labels,
// classify.ts `brilliantSacrifice`): one in the list keeps its place, one outside it is appended (`extra`), at most
// BRILLIANT_MAX in all. Outside the deep search's lines that takes one more search, restricted to the moves that leave
// a piece en prise, and only when such a move could still be within `brilliant.maxWinLoss` of the best (the last deep
// line is): in most positions there is no such search.

import type { AnalysisSettings, BrilliantSacrifice, TopMove, TopMovesResult } from '@chess-coach/shared';
import { scoreToCp, toWhitePov, winPercentFromScore } from '@chess-coach/shared';
import { makeUci } from 'chessops/util';
import type { PvLine, SearchResult } from '../engine/uci';
import { legalPrefix, playMove, positionStatus } from '../chess/notation';
import { positionFromFen } from '../chess/material';
import { hangingLoss } from '../chess/see';
import { brilliantSacrifice, type ClassifyInput, countLegalMoves, sameMoveUci } from './classify';
import { deepParams } from './label';
import type { SearchParams } from './searchCache';

/** The most arrows shown (the deep search's MultiPV gives at most that many lines). */
export const TOP_MAX = 5;
/** Always shown (when legal), however much they lose. */
export const TOP_MIN = 3;

/** Centipawns lost that count as one win-chance percent in `gap`. */
export const GAP_CP_PER_PCT = 30;

/** The search: the analysis's deep search of the position (shared through the SearchCache). */
export function topParams(settings: AnalysisSettings): SearchParams {
  return deepParams(settings);
}

/** The moves to draw, best first: TOP_MIN, then any within `excellentMaxLoss` gap of the best, at most TOP_MAX. */
export function pickTopMoves(fen: string, result: SearchResult, settings: AnalysisSettings): TopMove[] {
  const lines = legalLines(fen, result);
  const best = lines[0];
  const out: TopMove[] = [];
  for (const l of lines) {
    if (out.length >= TOP_MAX) break;
    const m = toTopMove(fen, l, best!);
    if (out.length >= TOP_MIN && m.gap > settings.labels.excellentMaxLoss) break;
    out.push(m);
  }
  return out;
}

/** The search's legal lines, best first, one per move. */
function legalLines(fen: string, result: SearchResult): PvLine[] {
  const out: PvLine[] = [];
  for (const l of [...result.lines].sort((a, b) => a.multipv - b.multipv)) {
    if (out.some((o) => o.move === l.move) || legalPrefix(fen, [l.move]).length !== 1) continue;
    out.push(l);
  }
  return out;
}

/** `line` as a TopMove, scored against `best` (win-chance loss and `gap`). */
function toTopMove(fen: string, line: PvLine, best: PvLine): TopMove {
  const mover = fen.split(' ')[1] === 'b' ? 'black' : 'white';
  const win = winPercentFromScore(line.score);
  const winLoss = Math.max(0, winPercentFromScore(best.score) - win);
  const gap = Math.max(winLoss, (scoreToCp(best.score) - scoreToCp(line.score)) / GAP_CP_PER_PCT);
  return { uci: line.move, san: playMove(fen, line.move).san, score: toWhitePov(line.score, mover), winLoss: Math.round(winLoss * 10) / 10, gap: Math.round(gap * 10) / 10 };
}

export function emptyTopMoves(fen: string): TopMovesResult | null {
  return positionStatus(fen) === 'ongoing' ? null : { fen, moves: [], depth: 0 };
}

// ---------------------------------------------------------------------------------------------------------------
// (Brilliant lines)

/** The most brilliant moves marked in one position. */
export const BRILLIANT_MAX = 3;

/** The move that led to the position (a take-back is no sacrifice; a capture there sets the material baseline). */
export interface PrevMove { fenBefore: string; uci: string }

export type TopSearch = (fen: string, params: SearchParams) => Promise<SearchResult>;

/** Is `line` a sound sacrifice by the Brilliant !! rule? (`best`, `second`: the deep search's first two lines.) */
function brilliantOf(fen: string, line: PvLine, best: PvLine, second: PvLine | undefined, legalMoveCount: number, prev: PrevMove | null, settings: AnalysisSettings): BrilliantSacrifice | undefined {
  const isBest = sameMoveUci(fen, line.move, best.move);
  const input: ClassifyInput = {
    fenBefore: fen,
    legalMoveCount,
    played: { uci: line.move, score: line.score, pv: line.pv },
    playedIsBest: isBest,
    best: { uci: best.move, score: best.score, pv: best.pv },
    second: second ? { uci: second.move, score: second.score, pv: second.pv } : null,
    // the Brilliant rule reads only the move and the position before it
    prev: prev ? { winLoss: 0, winBefore: 50, winAfter: 50, fenBefore: prev.fenBefore, uci: prev.uci } : null,
  };
  const winPlayed = winPercentFromScore(line.score);
  const winLoss = isBest ? 0 : Math.max(0, winPercentFromScore(best.score) - winPlayed);
  return brilliantSacrifice(input, isBest, winPlayed, winLoss, settings);
}

/**
 * The legal moves (not in `exclude`) after which one of the mover's pieces (not a pawn or the king) is en prise that
 * wasn't before, or the moved piece itself is: the only moves that can be a sacrifice. Promotions to a queen only.
 */
export function sacrificeCandidates(fen: string, exclude: readonly string[]): string[] {
  const pos = positionFromFen(fen);
  const mover = pos.turn;
  const hangingBefore = new Set<number>();
  for (const sq of pos.board[mover]) {
    if (!pos.board.pawn.has(sq) && !pos.board.king.has(sq) && hangingLoss(pos, sq) > 0) hangingBefore.add(sq);
  }
  const out: string[] = [];
  for (const [from, dests] of pos.allDests()) {
    for (const to of dests) {
      const promo = pos.board.pawn.has(from) && (to >> 3 === 0 || to >> 3 === 7);
      const move = promo ? { from, to, promotion: 'queen' as const } : { from, to };
      const uci = makeUci(move);
      if (exclude.some((e) => sameMoveUci(fen, e, uci))) continue;
      const after = pos.clone();
      after.play(move);
      if (after.isEnd()) continue;
      for (const sq of after.board[mover]) {
        if (after.board.pawn.has(sq) || after.board.king.has(sq)) continue;
        if (hangingBefore.has(sq) && sq !== move.to) continue;
        if (hangingLoss(after, sq) > 0) {
          out.push(uci);
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Whether a brilliant move could hide outside the deep search's lines: the search is full (TOP_MAX lines, more legal
 * moves than that), the best move keeps the position good but not completely won, and the last line is still within
 * `brilliant.maxWinLoss` of the best (a move below it scores no better).
 */
export function brilliantSearchWorthIt(fen: string, result: SearchResult, settings: AnalysisSettings): boolean {
  const b = settings.brilliant;
  const lines = legalLines(fen, result);
  const best = lines[0];
  const last = lines[lines.length - 1];
  if (!best || !last || lines.length < TOP_MAX || countLegalMoves(fen) <= lines.length) return false;
  const winBest = winPercentFromScore(best.score);
  if (winBest < b.minWinAfter || winBest >= b.maxWinOther) return false;
  return winBest - winPercentFromScore(last.score) <= b.maxWinLoss;
}

/**
 * `top` (pickTopMoves) with its brilliant moves marked, and the brilliant moves outside it appended (`extra`): at most
 * BRILLIANT_MAX brilliant moves in all, best first. `search` (optional) runs the extra search for the moves outside
 * the deep lines (`brilliantSearchWorthIt`); without it only the deep lines are looked at.
 */
export async function addBrilliants(fen: string, result: SearchResult, top: TopMove[], settings: AnalysisSettings, prev: PrevMove | null, search: TopSearch | null): Promise<TopMove[]> {
  const lines = legalLines(fen, result);
  const best = lines[0];
  if (!best) return top;
  const legal = countLegalMoves(fen);
  const out = top.map((m) => ({ ...m }));
  let count = 0;
  for (const l of lines) {
    if (count >= BRILLIANT_MAX) break;
    const sac = brilliantOf(fen, l, best, lines[1], legal, prev, settings);
    if (!sac) continue;
    count++;
    const shown = out.find((m) => sameMoveUci(fen, m.uci, l.move));
    if (shown) shown.brilliant = sac;
    else out.push({ ...toTopMove(fen, l, best), brilliant: sac, extra: true });
  }
  if (count >= BRILLIANT_MAX || !search || !brilliantSearchWorthIt(fen, result, settings)) return out;
  const candidates = sacrificeCandidates(fen, lines.map((l) => l.move));
  if (!candidates.length) return out;
  const r = await search(fen, { ...topParams(settings), multipv: Math.min(candidates.length, BRILLIANT_MAX), searchmoves: candidates });
  for (const l of legalLines(fen, r)) {
    if (count >= BRILLIANT_MAX) break;
    if (!candidates.some((c) => sameMoveUci(fen, c, l.move)) || out.some((m) => sameMoveUci(fen, m.uci, l.move))) continue;
    const sac = brilliantOf(fen, l, best, lines[1], legal, prev, settings);
    if (!sac) continue;
    count++;
    out.push({ ...toTopMove(fen, l, best), brilliant: sac, extra: true });
  }
  return out;
}
