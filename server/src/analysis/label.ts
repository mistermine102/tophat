// The label part of one move analysis: the searches classification needs + classifyMove. analyzeMove.ts calls it
// first and builds the explanation on top; the label benchmark (bench/label-benchmark.ts) calls it alone, so the
// benchmark's labels are the product's labels by construction.
//
// Searches (through the caller's `search`, i.e. SearchCache):
//   1. deep        fenBefore, MultiPV budget.deep            -> best, 2nd best (Great), played line
//   1b. searchmoves fenBefore, deep depth, [played]          -> only if the played move isn't among the deep lines
//   6. prev        only without a supplied previous result: the previous ply's own deep (+searchmoves) searches
//   7. verify      only when the label is within budget.verify.margin of a threshold: searchmoves=[best, played]
//                  (or [best, 2nd] for Great), MultiPV 2, deep depth + verify.depthPlus (see verifyNearThreshold)
// Classification (classify.ts) gets mover-POV scores from 1/1b, the previous ply's winLoss/win% (Miss),
// prev.fenBefore (material baseline), prev.uci (Great take-back rule) and the book chain.

import { type AnalysisSettings, type Color, type Label, winPercentFromScore } from '@chess-coach/shared';
import { bookInfo } from './book';
import { type ClassifyInput, type ClassifyResult, type EngineMoveLine, type PrevMoveContext, classifyMove, countLegalMoves, sameMoveUci } from './classify';
import type { SearchParams } from './searchCache';
import { legalPrefix, normalizeFen, playMove } from '../chess/notation';
import type { PvLine, SearchResult } from '../engine/uci';

export type SearchFn = (name: string, fen: string, p: SearchParams) => Promise<SearchResult>;

export interface PrevResult {
  winLoss: number;
  winBefore: number;
  label: Label;
}

export interface LabelInput {
  fenBefore: string;
  uci: string;
  /** The opponent's previous move; `result` = its finished analysis when known (main line: ply N-1). */
  prev?: { fenBefore: string; uci: string; result?: PrevResult | null } | null;
  /** SPEC book chain: every earlier move of the game was book (undefined = unknown, treated as true). */
  earlierMovesAllBook?: boolean;
}

export interface LabelWork {
  fen: string;
  played: { san: string; uci: string; fenAfter: string; color: Color };
  mover: Color;
  legalMoves: number;
  prevMove: { fenBefore: string; uci: string } | null;
  /** Deep lines at fenBefore whose first move is legal; [0] = best. */
  lines: PvLine[];
  best: PvLine;
  /** The played move's deep line (from `lines` or the searchmoves search). */
  playedLine: PvLine;
  classifyInput: ClassifyInput;
  cr: ClassifyResult;
  /** The label came from the near-threshold verification search (classifyInput holds its lines). */
  verified: boolean;
}

const toLine = (l: PvLine): EngineMoveLine => ({ uci: l.move, score: l.score, pv: l.pv });

export function deepParams(settings: AnalysisSettings): SearchParams {
  const d = settings.budget.deep;
  return { depth: d.depth, multipv: d.multipv, maxMs: d.maxMs };
}

/** Deep search at `fen` + the played move's line (searchmoves if it isn't among the deep lines). */
async function deepLines(search: SearchFn, settings: AnalysisSettings, fen: string, uci: string, name: string): Promise<{ lines: PvLine[]; playedLine: PvLine }> {
  const B = settings.budget.deep;
  const deep = await search(name, fen, deepParams(settings));
  const lines = deep.lines.filter((l) => legalPrefix(fen, [l.move]).length === 1);
  if (lines.length === 0) throw new Error(`engine returned no lines for ${fen}`);
  let playedLine = lines.find((l) => sameMoveUci(fen, l.move, uci));
  if (!playedLine) {
    const r = await search(name === 'deep' ? 'searchmoves' : name, fen, { depth: B.depth, multipv: 1, maxMs: B.maxMs, searchmoves: [uci] });
    playedLine = r.lines[0];
    if (!playedLine) throw new Error(`searchmoves ${uci} returned nothing in ${fen}`);
  }
  return { lines, playedLine };
}

async function classifyFrom(
  search: SearchFn,
  fen: string,
  uci: string,
  lines: PvLine[],
  playedLine: PvLine,
  extra: Pick<ClassifyInput, 'book' | 'prev'>,
  settings: AnalysisSettings,
): Promise<{ input: ClassifyInput; cr: ClassifyResult; verified: boolean }> {
  const best = lines[0]!;
  const input: ClassifyInput = {
    fenBefore: fen,
    legalMoveCount: countLegalMoves(fen),
    played: toLine(playedLine),
    playedIsBest: sameMoveUci(fen, best.move, uci),
    best: toLine(best),
    second: lines[1] ? toLine(lines[1]) : null,
    ...extra,
  };
  const cr = classifyMove(input, settings);
  const v = await verifyNearThreshold(search, settings, input, cr);
  return v ? { ...v, verified: true } : { input, cr, verified: false };
}

/** The pair of moves whose comparison decides the label, if it is within `margin` win% of a threshold. */
export function nearThresholdPair(input: ClassifyInput, cr: ClassifyResult, settings: AnalysisSettings): [EngineMoveLine, EngineMoveLine] | null {
  const margin = settings.budget.verify?.margin ?? 0;
  if (margin <= 0 || input.legalMoveCount < 2 || cr.checkmate) return null;
  if (cr.label === 'book' || cr.label === 'forced') return null;
  const isMate = (l: EngineMoveLine | null | undefined) => l?.score.mate !== undefined;
  const near = (x: number, ts: number[]) => ts.some((t) => Math.abs(x - t) <= margin);
  const t = settings.labels;
  if (!sameMoveUci(input.fenBefore, input.played.uci, input.best.uci)) {
    if (isMate(input.played) || isMate(input.best)) return null; // mate rules / clamp decide, not a threshold
    return near(cr.winLoss, [t.excellentMaxLoss, t.goodMaxLoss, t.inaccuracyMaxLoss, t.mistakeMaxLoss]) ? [input.best, input.played] : null;
  }
  const second = input.second;
  if (!second || isMate(second) || isMate(input.best)) return null;
  const secondLoss = cr.winBest - winPercentFromScore(second.score);
  return near(secondLoss, [settings.great.secondBestMinLoss]) ? [input.best, second] : null;
}

/**
 * Stability mitigation (settings.budget.verify, M3): when the label is within `margin` win% of the threshold that
 * decides it, re-search the two moves of that comparison together (searchmoves=[a, b], MultiPV 2) at deep depth +
 * depthPlus and classify again from that search. Both directions count (a Mistake may become a Blunder): it is a
 * more accurate measurement where the label is fragile, not hysteresis. Returns null when not needed / unusable.
 */
async function verifyNearThreshold(search: SearchFn, settings: AnalysisSettings, input: ClassifyInput, cr: ClassifyResult): Promise<{ input: ClassifyInput; cr: ClassifyResult } | null> {
  const pair = nearThresholdPair(input, cr, settings);
  if (!pair) return null;
  const v = settings.budget.verify;
  const fen = input.fenBefore;
  const r = await search('verify', fen, { depth: settings.budget.deep.depth + v.depthPlus, multipv: 2, maxMs: v.maxMs, searchmoves: [pair[0].uci, pair[1].uci] });
  const ls = r.lines.filter((l) => pair.some((p) => sameMoveUci(fen, l.move, p.uci)));
  if (ls.length < 2 || sameMoveUci(fen, ls[0]!.move, ls[1]!.move)) return null;
  const top = toLine(ls[0]!);
  const other = toLine(ls[1]!);
  const playedV = sameMoveUci(fen, top.uci, input.played.uci) ? top : sameMoveUci(fen, other.uci, input.played.uci) ? other : null;
  let next: ClassifyInput;
  if (playedV) {
    // [best, played]: the verified pair replaces both; if the played move is now on top, the old best is its 2nd
    const playedIsBest = playedV === top;
    next = { ...input, best: top, played: playedV, playedIsBest, second: playedIsBest ? other : input.second ?? null };
  } else {
    // [best, second] for Great (the played move is the best): if the order flips, the played move is no longer #1
    const bestIsPlayed = sameMoveUci(fen, top.uci, input.played.uci) || sameMoveUci(fen, top.uci, input.best.uci);
    next = bestIsPlayed ? { ...input, best: top, played: top, playedIsBest: true, second: other } : { ...input, best: top, played: other, playedIsBest: false, second: other };
  }
  return { input: next, cr: classifyMove(next, settings) };
}

export async function labelMove(settings: AnalysisSettings, search: SearchFn, input: LabelInput): Promise<LabelWork> {
  const fen = normalizeFen(input.fenBefore);
  const played = playMove(fen, input.uci);
  const prevMove = input.prev ? { fenBefore: normalizeFen(input.prev.fenBefore), uci: input.prev.uci } : null;

  const { lines, playedLine } = await deepLines(search, settings, fen, played.uci, 'deep');
  const prevInfo = prevMove ? await prevContext(settings, search, prevMove, fen, input.prev?.result ?? null, input.earlierMovesAllBook) : null;

  const info = bookInfo(fen, played.fenAfter);
  const chain = input.earlierMovesAllBook !== false && (prevInfo?.label === undefined || prevInfo.label === 'book');
  const { input: classifyInput, cr, verified } = await classifyFrom(search, fen, played.uci, lines, playedLine, {
    book: { after: info.after, beforeIsStartOrBook: info.beforeIsStartOrBook, earlierMovesAllBook: chain },
    prev: prevInfo?.ctx ?? null,
  }, settings);
  return { fen, played, mover: played.color, legalMoves: classifyInput.legalMoveCount, prevMove, lines, best: lines[0]!, playedLine, classifyInput, cr, verified };
}

/** Previous-move context for classify (Miss, baseline, take-back) and its label (book chain). */
async function prevContext(
  settings: AnalysisSettings,
  search: SearchFn,
  prev: { fenBefore: string; uci: string },
  fenNow: string,
  known: PrevResult | null,
  earlierMovesAllBook: boolean | undefined,
): Promise<{ ctx: PrevMoveContext; label?: Label }> {
  if (known) {
    return { ctx: { winLoss: known.winLoss, winBefore: known.winBefore, winAfter: known.winBefore - known.winLoss, fenBefore: prev.fenBefore, uci: prev.uci }, label: known.label };
  }
  const p = playMove(prev.fenBefore, prev.uci);
  if (normalizeFen(p.fenAfter) !== fenNow) throw new Error(`prev move ${prev.uci} does not lead to ${fenNow}`);
  const { lines, playedLine } = await deepLines(search, settings, prev.fenBefore, p.uci, 'prev');
  const info = bookInfo(prev.fenBefore, p.fenAfter);
  const { cr } = await classifyFrom(search, prev.fenBefore, p.uci, lines, playedLine, {
    book: { after: info.after, beforeIsStartOrBook: info.beforeIsStartOrBook, ...(earlierMovesAllBook === false ? { earlierMovesAllBook: false } : {}) },
    prev: null,
  }, settings);
  return { ctx: { winLoss: cr.winLoss, winBefore: cr.winBest, winAfter: cr.winPlayed, fenBefore: prev.fenBefore, uci: prev.uci }, label: cr.label };
}
