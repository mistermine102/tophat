// (Fast feedback, BACKLOG D1) A provisional move analysis in a fraction of the full one's time: the label part
// (label.ts) with a light deep budget (QUICK_BUDGET: shallower, MultiPV 2, no near-threshold verification) and the
// position after the move at the same budget (its eval and best move — the next ply's quick search, shared through
// the SearchCache). No explanations, no suggestion: `provisional: true`, the full analysis (analyzeMove) replaces it.
// The SearchCache keys searches by their parameters, so quick searches never stand in for full ones.

import type { AnalysisSettings, Arrow, MoveAnalysis, Score } from '@chess-coach/shared';
import { ANALYSIS_VERSION, moveAccuracy, toWhitePov, winPercentForColor } from '@chess-coach/shared';
import type { AnalyzeContext, AnalyzeInput } from './analyzeMove';
import { labelText, verdictText } from './explain';
import { worseLabel } from './classify';
import { deepParams, labelMove } from './label';
import type { SearchParams } from './searchCache';
import { legalPrefix, playMove, positionStatus, pvToSan, uciSquares } from '../chess/notation';
import type { SearchResult } from '../engine/uci';

/** The quick pass's deep search: depth, MultiPV (2: best + the played move or the 2nd best), time cap. */
export const QUICK_BUDGET = { depth: 10, multipv: 2, maxMs: 1500 } as const;

/** `settings` with the quick deep budget (and no verification search). */
export function quickSettings(settings: AnalysisSettings): AnalysisSettings {
  return {
    ...settings,
    budget: {
      ...settings.budget,
      deep: { ...QUICK_BUDGET },
      verify: { ...settings.budget.verify, margin: 0 },
    },
  };
}

export async function quickAnalysis(ctx: AnalyzeContext, input: AnalyzeInput): Promise<MoveAnalysis> {
  const t0 = performance.now();
  const settings = quickSettings(ctx.settings);
  const search = async (_name: string, fen: string, p: SearchParams): Promise<SearchResult> => (await ctx.cache.search(ctx.searcher, fen, p)).result;
  const lw = await labelMove(settings, search, input);
  const { fen, played, mover, best, playedLine, cr } = lw;
  // a generic Miss needs the best move's facts (analyzeMove: a concrete chance); without them the win-chance label stands
  if (cr.label === 'miss' && cr.labelReason.miss && !cr.labelReason.missedMate && !cr.labelReason.missedMaterial) {
    cr.label = worseLabel(cr.labelReason.winChance, cr.labelReason.material?.label);
  }
  const opp = mover === 'white' ? 'black' : 'white';
  let evalAfter: Score;
  let nextBest: MoveAnalysis['nextBest'];
  const status = positionStatus(played.fenAfter);
  if (status === 'checkmate') evalAfter = toWhitePov({ mate: 0 }, opp);
  else if (status === 'stalemate') evalAfter = { cp: 0 };
  else {
    const after = await search('deepAfter', played.fenAfter, deepParams(settings));
    const s = after.lines[0]?.score;
    evalAfter = s ? toWhitePov(s, opp) : toWhitePov(playedLine.score, mover);
    const nb = after.lines[0]?.move;
    if (nb && legalPrefix(played.fenAfter, [nb]).length === 1) nextBest = { uci: nb, san: playMove(played.fenAfter, nb).san };
  }
  const bestSan = playMove(fen, best.move).san;
  const playedIsBest = cr.label !== 'book' && cr.winLoss === 0 && best.move === played.uci;
  const cand = (uci: string, san: string, score: Score, pv: readonly string[], rank: number, winLoss: number) => {
    const pvUci = legalPrefix(fen, pv.length ? pv : [uci]);
    return { uci, san, rank, score: toWhitePov(score, mover), winLoss, pv: pvToSan(fen, pvUci), pvUci, explainable: false };
  };
  const arrows: Arrow[] = [{ ...uciSquares(played.uci), kind: 'played' }, { ...uciSquares(best.move), kind: 'best' }];
  const winAfter = winPercentForColor(evalAfter, mover);
  const analysis: MoveAnalysis = {
    version: ANALYSIS_VERSION,
    fenBefore: fen,
    fenAfter: played.fenAfter,
    uci: played.uci,
    san: played.san,
    color: mover,
    evalBefore: toWhitePov(best.score, mover),
    evalAfter,
    winBefore: cr.winBest,
    winAfter,
    winLoss: cr.winLoss,
    accuracy: moveAccuracy(cr.winBest, winAfter),
    label: cr.label,
    labelReason: cr.labelReason,
    played: cand(played.uci, played.san, playedLine.score, playedLine.pv, lw.lines.indexOf(playedLine) + 1, cr.winLoss),
    best: cand(best.move, bestSan, best.score, best.pv, 1, 0),
    pick: null,
    pickIsBest: false,
    deepOnly: false,
    candidates: [],
    arrows,
    timings: { total: Math.round(performance.now() - t0) },
    provisional: true,
  };
  if (nextBest) analysis.nextBest = nextBest;
  analysis.labelText = labelText({ ...analysis, bestSan, bestUci: best.move, checkmate: cr.checkmate, san: played.san }, ctx.settings);
  const verdict = verdictText(cr.label, playedIsBest || best.move === played.uci);
  if (verdict) analysis.verdictText = verdict;
  return analysis;
}
