// Orchestrates one move analysis: (fenBefore, uci, prev?) -> MoveAnalysis (shared/src/types.ts).
//
// Searches (all through SearchCache, so nothing is searched twice; the caller runs this inside one Scheduler job
// at the job's priority):
//   1. deep      fenBefore, MultiPV budget.deep          -> candidates, best, 2nd best (Great), played line
//   1b. searchmoves fenBefore, deep depth, [played]      -> only if the played move isn't among the deep lines
//   2. deepAfter fenAfter, MultiPV budget.deep           -> evalAfter (White POV). This is exactly the deep search
//                                                          of the next ply, so a game needs ~1 deep search/ply.
//   3. shallow   fenBefore, MultiPV budget.shallow       (+ shallow searchmoves for candidates outside it)
//   4. threat    null-move position after each candidate / the played move, budget.threat
//   5. forcedness at opponent replies of the narrated lines of the played move, the best move and the pick
//      (only replies under pressure, see facts/line.ts)
//   5b. refutation threat: for a bad played move (Inaccuracy / Mistake / Blunder / Miss), budget.threat at the
//      null-move position after the opponent's PV reply -> the 'allows' fact (what the reply threatens)
//   6. prev      if the previous ply's result isn't supplied: deep (+searchmoves) at prev.fenBefore — the same
//                searches that ply's own analysis uses (cached), to build the Miss / book-chain context.
// Searches 1, 1b, 6 and the classification live in label.ts (`labelMove`), shared with the label benchmark.
// Explanations: the played move's narration runs on until the material rule's loss is shown (targetDelta), its
// Immediate level leads with the refutation for bad labels, and the label text says why the best move is better
// (explain.ts betterReasons, from the best move's own verified facts).

import type { AnalysisSettings, Arrow, Candidate, Color, Fact, Label, MaterialCheck, MoveAnalysis, Score } from '@chess-coach/shared';
import { ANALYSIS_VERSION, moveAccuracy, toWhitePov, winPercentForColor, winPercentFromScore } from '@chess-coach/shared';
import { guardCp, materialCheck, missedChanceMiss, sameMoveUci, worseLabel } from './classify';
import { allowsText, BAD_LABELS, betterReasonFacts, contrastWithPlayed, type Cause, type ExplainContext, labelText, negativeSize, reasonsArePartial, renderExplanation, verdictText } from './explain';
import { type PrevResult, deepParams as labelDeepParams, labelMove } from './label';
import { type SearchParams, type Searcher, SearchCache } from './searchCache';
import { type ReasonCode, lineDelta, suggest } from './suggest';
import { legalMove as legalMoveAt, legalPrefix, playMove, positionStatus, pvToSan, topMoves, uciSquares } from '../chess/notation';
import { hangingLoss, seeCaptureWith, seeMove } from '../chess/see';
import { parseSquare } from 'chessops/util';
import type { PvLine, SearchResult } from '../engine/uci';
import { PIECE_VALUES, lineMaterial, materialBalance, positionFromFen } from '../chess/material';
import { immediateFacts } from '../facts/immediate';
import { type ForcedInfo, type NarratedLine, type ThreatFact, forcedFromSearch, forcednessChecks, mateLineSan, narrateLine, narrationPlies, nullMoveFen, preventsFact, pvFork, refutationFact, threatFromSearch, threatStillWorks } from '../facts/line';
import { longTermFacts } from '../facts/longterm';
import { chasedFact, fineAlternatives, loosensFact, passerFact, tradesDownFact, undevelopedFact } from '../facts/cause';
import { compareIdeas, median, movePoints, narratedDelta } from './movePoints';

export interface AnalyzeContext {
  searcher: Searcher;
  cache: SearchCache;
  settings: AnalysisSettings;
}

export type { PrevResult };

export interface PrevInput {
  fenBefore: string;
  uci: string;
  /** The previous move's analysis result, if known (main line: ply N-1). Otherwise it is computed. */
  result?: PrevResult | null;
}

export interface AnalyzeInput {
  fenBefore: string;
  uci: string;
  /** The opponent's previous move (Miss, recapture, material baseline, Great's take-back rule, book chain). */
  prev?: PrevInput | null;
  /** SPEC book chain: every earlier move of the game was book (undefined = unknown, treated as true). */
  earlierMovesAllBook?: boolean;
  /** (D1) The label the quick pass already showed: kept when the full one is only a small shift (`stickyLabel`). */
  provisionalLabel?: Label;
}

/** (D1) The win-chance labels in order; a shown label sticks to a neighbour near the threshold between them. */
const WIN_CHANCE_SCALE: readonly Label[] = ['excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];
/** (D1) Win% around a threshold within which the quick label stays (the full search is just as noisy there). */
export const STICKY_MARGIN = 3;
/** (D1) A quick Best stays when the full analysis puts the move this close (win%) to its top move. */
export const BEST_STICKY_LOSS = 1;

/**
 * (D1) "Fast, then final": the label the quick pass showed stays unless the full analysis finds a real difference.
 * Kept only when the full label came from win chance alone (no material / mate / Miss / Great / Brilliant rule), both
 * are neighbours on the win-chance scale and the full winLoss is within STICKY_MARGIN of the threshold between them.
 */
export function stickyLabel(full: Label, provisional: Label | undefined, winChance: Label, winLoss: number, settings: AnalysisSettings): Label {
  if (!provisional || provisional === full || full !== winChance) return full;
  // a quick Best within BEST_STICKY_LOSS of the full search's top move: the two searches only disagree within their
  // noise — the star stays ("as good as the best move")
  if (provisional === 'best' && full === 'excellent' && winLoss <= BEST_STICKY_LOSS) return 'best';
  const i = WIN_CHANCE_SCALE.indexOf(full);
  const j = WIN_CHANCE_SCALE.indexOf(provisional);
  if (i < 0 || j < 0 || Math.abs(i - j) !== 1) return full;
  const t = settings.labels;
  const thresholds = [t.excellentMaxLoss, t.goodMaxLoss, t.inaccuracyMaxLoss, t.mistakeMaxLoss];
  return Math.abs(winLoss - thresholds[Math.min(i, j)]!) <= STICKY_MARGIN ? provisional : full;
}

/** Everything known about one move (a candidate or the played move) while building the analysis. */
interface MoveWork {
  uci: string;
  san: string;
  rank: number; // 0 = not among the deep lines
  score: Score; // deep, mover POV
  pv: string[]; // legal UCI, starting with the move
  fenAfter: string;
  immediate: Fact[];
  threat: ThreatFact | null;
  narrated: NarratedLine;
  shallow: Score | null;
  material: MaterialCheck | null;
  reasons?: ReasonCode[];
  /** Material rule verdict to show in the narration (played move, when the rule fired). */
  targetDelta?: number;
}

const now = () => performance.now();

export async function analyzeMove(ctx: AnalyzeContext, input: AnalyzeInput): Promise<MoveAnalysis> {
  const t0 = now();
  const { settings, cache, searcher } = ctx;
  const B = settings.budget;
  const timings: Record<string, number> = {};
  let cachedSearches = 0;
  const search = async (name: string, fen: string, p: SearchParams): Promise<SearchResult> => {
    const t = now();
    const o = await cache.search(searcher, fen, p);
    if (o.cached) cachedSearches++;
    else timings[name] = Math.round((timings[name] ?? 0) + (now() - t));
    return o.result;
  };
  const deepParams: SearchParams = labelDeepParams(settings); // = the next ply's deep search (label.ts)

  // 1. + 6. + classification (label.ts: deep, searchmoves, previous-move context, classifyMove)
  const lw = await labelMove(settings, search, input);
  const { fen, played, mover, legalMoves, prevMove, lines, best, playedLine, cr } = lw;
  const opp: Color = mover === 'white' ? 'black' : 'white';

  // 2. evaluation after the move (= next ply's deep search)
  const status = positionStatus(played.fenAfter);
  let evalAfter: Score;
  let nextBest: MoveAnalysis['nextBest'];
  let nextTop: MoveAnalysis['nextTop'];
  if (status === 'checkmate') evalAfter = toWhitePov({ mate: 0 }, opp);
  else if (status === 'stalemate') evalAfter = { cp: 0 };
  else {
    const after = await search('deepAfter', played.fenAfter, deepParams);
    const s = after.lines[0]?.score;
    evalAfter = s ? toWhitePov(s, opp) : toWhitePov(playedLine.score, mover);
    const nb = after.lines[0]?.move;
    if (nb && legalPrefix(played.fenAfter, [nb]).length === 1) nextBest = { uci: nb, san: playMove(played.fenAfter, nb).san };
    const top = topMoves(played.fenAfter, after.lines.map((l) => l.move));
    if (top.length) nextTop = top;
  }

  // 3. shallow search
  const shallow = await search('shallow', fen, { depth: B.shallow.depth, multipv: B.shallow.multipv, maxMs: B.shallow.maxMs });
  const shallowScore = async (uci: string): Promise<Score | null> => {
    const l = shallow.lines.find((x) => sameMoveUci(fen, x.move, uci));
    if (l) return l.score;
    const r = await search('shallow', fen, { depth: B.shallow.depth, multipv: 1, maxMs: B.shallow.maxMs, searchmoves: [uci] });
    return r.lines[0]?.score ?? null;
  };

  // facts per move (candidates + played)
  const tFacts = now();
  let factsMs = 0;
  const prevOpt = prevMove ? { prev: prevMove } : {};
  const threatParams: SearchParams = { depth: B.threat.depth, multipv: B.threat.multipv, maxMs: B.threat.maxMs };
  // the opponent's threat right now (what they'd play if the mover passed) — candidates that stop it say so
  const oppNull = nullMoveFen(fen);
  const oppNullSearch = oppNull ? await search('threat', oppNull, threatParams) : null;
  const oppThreat = oppNull && oppNullSearch ? threatFromSearch(oppNull, oppNullSearch) : null;
  const work = async (line: PvLine, rank: number): Promise<MoveWork> => {
    const p = playMove(fen, line.move);
    const pv = legalPrefix(fen, line.pv.length && sameMoveUci(fen, line.pv[0]!, line.move) ? line.pv : [line.move]);
    let threat: ThreatFact | null = null;
    const nf = nullMoveFen(p.fenAfter);
    if (nf) threat = threatFromSearch(nf, await search('threat', nf, threatParams));
    let defends: Fact | null = null;
    if (oppThreat && nf) {
      // (nf === null: the move gives check or ends the game — that answers a threat only for one move)
      const still = legalPrefix(p.fenAfter, [oppThreat.move]).length === 1
        ? threatStillWorks(p.fenAfter, oppThreat, await search('threat', p.fenAfter, { ...threatParams, multipv: 1, searchmoves: [oppThreat.move] }))
        : false;
      // taking the threatening piece is already told by the capture fact
      const takesThreatener = p.uci.slice(2, 4) === oppThreat.move.slice(0, 2);
      if (!still && !takesThreatener) defends = { type: 'defends-threat', move: oppThreat.move, san: oppThreat.san, gain: oppThreat.gain, facts: oppThreat.facts, ...(oppThreat.mateIn !== undefined ? { mateIn: oppThreat.mateIn } : {}) };
    }
    const tf = now();
    const immediate = verifyWithLine(pruneRefuted(immediateFacts(fen, p.uci, prevOpt), p.uci, pv[1]), fen, pv);
    addLineFork(immediate, fen, pv);
    // prophylaxis: the opponent's best idea (null move) no longer works — unless the move answers a verified threat
    if (oppNullSearch && !defends) {
      const pf = preventsFact({ fenBefore: fen, uci: p.uci, nullSearch: oppNullSearch, score: line.score, threatMove: oppThreat?.move ?? null });
      if (pf && !opponentPlays(pv, pf.move)) immediate.push(pf);
    }
    if (threat && !replyTakesMovedPiece(p.uci, pv[1]) && !threatExistedBefore(fen, threat) && !targetHitsBack(p.fenAfter, threat)) immediate.push(threat);
    // "stops the threat" only if the engine line doesn't play it anyway
    // (a mate threat may still be played without mating: only material threats are checked against the PV)
    // (M5b) nor when the threatened piece is still en prise after the move (the threat is only parried by a counter-attack)
    if (defends && !((defends as { mateIn?: number }).mateIn === undefined && (opponentPlays(pv, (defends as { move: string }).move) || stillEnPrise(p.fenAfter, (defends as { move: string }).move)))) immediate.push(defends);
    // engine-verified forced mate against the mover that the best move avoids (board check only sees mate in 1)
    const matedIn = line.score.mate !== undefined && line.score.mate < 0 ? -line.score.mate : 0;
    if (matedIn > 1 && !((best.score.mate ?? 0) < 0) && !immediate.some((f) => f.type === 'allows-mate')) {
      const am: Extract<Fact, { type: 'allows-mate' }> = { type: 'allows-mate', inMoves: matedIn };
      const ml = matedIn <= MATE_LINE_MAX_MOVES ? mateLineSan(p.fenAfter, pv.slice(1), 2 * matedIn - 1) : null;
      if (ml) am.line = ml;
      immediate.push(am);
    }
    const narrated = narrateLine(fen, pv, { settings, prev: prevMove, score: line.score });
    const isBest = sameMoveUci(fen, line.move, best.move);
    const material = isBest
      ? null
      : materialCheck({ fenBefore: fen, playedPv: pv, bestPv: best.pv, playedScore: line.score, bestScore: best.score, ...(prevMove ? { prevFenBefore: prevMove.fenBefore } : {}) }, settings);
    factsMs += now() - tf;
    return { uci: p.uci, san: p.san, rank, score: line.score, pv, fenAfter: p.fenAfter, immediate, threat, narrated, shallow: await shallowScore(p.uci), material };
  };
  const cands: MoveWork[] = [];
  for (let i = 0; i < lines.length; i++) cands.push(await work(lines[i]!, i + 1));
  const playedIdx = cands.findIndex((c) => sameMoveUci(fen, c.uci, played.uci));
  const playedWork = playedIdx >= 0 ? cands[playedIdx]! : await work(playedLine, 0);
  const mat = cr.labelReason.material;
  if (mat?.label) playedWork.targetDelta = mat.playedLine - materialBalance(positionFromFen(fen).board, mover);

  // 4. suggestion
  const judge = (ws: MoveWork[]) => suggest(ws.map((w) => ({ uci: w.uci, score: w.score, shallowScore: w.shallow, material: w.material, facts: [...w.immediate, w.narrated.line] })), best.score, settings, lineDelta([cands[0]!.narrated.line]));
  const sug = judge(cands);
  cands.forEach((c, i) => (c.reasons = sug.reasons[i]));
  if (playedIdx < 0) playedWork.reasons = judge([playedWork]).reasons[0];
  const pickWork = sug.pick !== null ? cands[sug.pick]! : null;

  // 5. forcedness + full explanations for played / best / pick
  const winBest = winPercentFromScore(best.score);
  const secondBestLoss = lines[1] ? Math.max(0, winBest - winPercentFromScore(lines[1].score)) : null;
  const explained = new Map<string, Candidate['explanation']>();
  const shortFacts = new Map<string, Fact[]>();
  const allFacts = new Map<string, { immediate: Fact[]; short: Fact[]; long: Fact[]; ctx: ExplainContext }>();
  const ownPlies = (w: MoveWork) => narrationPlies(fen, w.pv, settings, w.score, w.targetDelta !== undefined ? { targetDelta: w.targetDelta } : {});
  // M5b: a bad move's line and the best move's line are told to a comparable length when only one of them reaches
  // a material result at its own length (each still stops at its own quiet point at or after the longer one), so
  // "Kh2 → Rd1+" isn't set against a best line that goes on to win a pawn
  const bestW = cands[0]!;
  const claims = (w: MoveWork) => {
    const r = narrateLine(fen, w.pv, { settings, prev: prevMove, score: w.score, plies: ownPlies(w) }).line.result;
    return r === 'wins-material' || r === 'loses-material';
  };
  // the line without a material result is told on to the other one's length; kept only if it then has a result too
  const extend = new Map<string, number>();
  if (BAD_LABELS.has(cr.label) && !sameMoveUci(fen, playedWork.uci, bestW.uci)) {
    const [cp, cb] = [claims(playedWork), claims(bestW)];
    if (cp && !cb && ownPlies(playedWork) > ownPlies(bestW)) extend.set(bestW.uci, ownPlies(playedWork));
    if (cb && !cp && ownPlies(bestW) > ownPlies(playedWork)) extend.set(playedWork.uci, ownPlies(bestW));
  }
  const explain = async (w: MoveWork, label?: Label): Promise<NonNullable<Candidate['explanation']>> => {
    const done = explained.get(w.uci);
    if (done) return done;
    const nOpts: { targetDelta?: number; minPlies?: number } = {};
    if (w.targetDelta !== undefined) nOpts.targetDelta = w.targetDelta;
    const ext = extend.get(w.uci);
    let plies = narrationPlies(fen, w.pv, settings, w.score, nOpts);
    const resultAt = (n: number) => narrateLine(fen, w.pv, { settings, prev: prevMove, score: w.score, plies: n }).line.result;
    const material = (r: string) => r === 'wins-material' || r === 'loses-material';
    if (ext !== undefined) {
      const longer = narrationPlies(fen, w.pv, settings, w.score, { ...nOpts, minPlies: ext });
      if (material(resultAt(longer))) plies = longer;
    } else if (label && BAD_LABELS.has(label) && !material(resultAt(plies)) && !['mate', 'mated'].includes(resultAt(plies))) {
      // (M5b) a bad move whose story ends before anything happens: tell it on to the first stop point where the
      // engine line has a material result (a run of checks ending in a fork), within the quiet horizon
      for (let k = plies + 1; k <= settings.material.quietHorizonPlies && k <= w.pv.length;) {
        const longer = narrationPlies(fen, w.pv, settings, w.score, { ...nOpts, minPlies: k });
        if (longer < k) break;
        // (M5c) …or, past the quiet horizon, where the material swings back to level (a pawn lost and regained)
        if (material(resultAt(longer)) || (longer > settings.material.quietHorizonPlies && resultAt(longer) === 'trade')) {
          plies = longer;
          break;
        }
        k = longer + 1;
      }
    }
    const forced = new Map<number, ForcedInfo>();
    for (const c of forcednessChecks(fen, w.pv, plies, settings)) {
      if (c.legalMoves <= 1) forced.set(c.index, { forced: true, alternatives: 0 });
      else {
        const r = await search('forcedness', c.fen, { depth: B.forcedness.depth, multipv: B.forcedness.multipv, maxMs: B.forcedness.maxMs });
        forced.set(c.index, forcedFromSearch(c, r.lines, settings));
      }
    }
    const tf = now();
    const narrated = narrateLine(fen, w.pv, { settings, prev: prevMove, score: w.score, forced, plies, noForcedFirstReply: !!label && BAD_LABELS.has(label) });
    const isBest = sameMoveUci(fen, w.uci, best.move);
    const long = longTermFacts({
      fenBefore: fen,
      fenAfter: w.fenAfter,
      // (M5c) a story run on past the quiet horizon: no line-end structure notes from that far out
      lineEndFen: narrated.line.steps.length > settings.material.quietHorizonPlies ? w.fenAfter : narrated.endFen,
      mover,
      immediate: w.immediate,
      lineMaterialDelta: narrated.line.materialDelta,
      lineResult: narrated.line.result,
      ...(narrated.line.draw ? { lineDraw: true } : {}),
      ...(label && BAD_LABELS.has(label) ? { bad: true } : {}),
      score: isBest ? best.score : w.score,
      bestScore: best.score,
      shallowScore: w.shallow,
      isBest,
      secondBestLoss,
      legalMoves,
      settings,
    });
    let immediate = w.immediate;
    if (label && BAD_LABELS.has(label) && w.pv.length >= 2) {
      // the refutation: what the opponent's reply does, incl. its own verified threat
      const afterReply = playMove(w.fenAfter, w.pv[1]!).fenAfter;
      const nf = nullMoveFen(afterReply);
      const replyThreat = nf ? threatFromSearch(nf, await search('threat', nf, threatParams)) : null;
      const allows = refutationFact({ fenBefore: fen, uci: w.uci, pv: w.pv, line: narrated.line, replyThreat, bestLineDelta: lineDelta(shortFacts.get(cands[0]!.uci) ?? [cands[0]!.narrated.line]) });
      // the best move allows the same reply with the same effect: that is not what makes this move worse
      const b = cands[0]!;
      // (M5b) with the best line's own reply threat, so "Allows f4: then … threatens fxe5" is dropped when Qe7 allows it too
      let bestReplyThreat: ThreatFact | null = null;
      if (!sameMoveUci(fen, b.uci, w.uci) && b.pv.length >= 2 && b.pv[1]!.slice(0, 4) === w.pv[1]!.slice(0, 4)) {
        const bnf = nullMoveFen(playMove(b.fenAfter, b.pv[1]!).fenAfter);
        bestReplyThreat = bnf ? threatFromSearch(bnf, await search('threat', bnf, threatParams)) : null;
      }
      const bestLine = (shortFacts.get(b.uci)?.find((x) => x.type === 'line') as Extract<Fact, { type: 'line' }> | undefined) ?? b.narrated.line;
      const bestAllows = sameMoveUci(fen, b.uci, w.uci) ? null : refutationFact({ fenBefore: fen, uci: b.uci, pv: b.pv, line: bestLine, replyThreat: bestReplyThreat });
      // the reply is exactly the opponent's verified threat from before the move: the move "doesn't stop" it
      // (only when it hits nothing new: Rg8+ walking into Kh7 is the move's own doing)
      if (allows && oppThreat && allows.reply.uci === oppThreat.move && !(allows.targets?.length)) allows.already = true;
      // (M5b) the reply's threat is the opponent's threat from before the move (Rxa7 was already on): the move doesn't deal with it
      // (only if that threat is playable right now: …Nxd4 needing Nf5 first is a plan, not a threat — round 6)
      if (allows && oppThreat && (allows.targets ?? []).every((t) => t.square === oppThreat.move.slice(2, 4)) && allows.facts.some((x) => x.type === 'threat' && x.move === oppThreat.move) && legalPrefix(w.fenAfter, [oppThreat.move]).length === 1) allows.keepsThreat = true;
      // a short forced mate against the mover: name its moves (verified to end in checkmate on the board)
      if (allows?.mateIn !== undefined && allows.mateIn <= MATE_LINE_MAX_MOVES) {
        const ml = mateLineSan(w.fenAfter, w.pv.slice(1), 2 * allows.mateIn - 1);
        if (ml) allows.mateLine = ml;
      }
      // (Feedback round 3) a reply whose tactic costs nothing ("Allows Qe3, uncovering an attack on the queen" that just
      // moves) refutes nothing: no sentence rather than a hollow one
      const hollow = allows && allows.mateIn === undefined && !allows.perpetual && !((allows.gain ?? 0) >= 1)
        && !allows.facts.some((x) => x.type === 'checkmate' || x.type === 'fork' || x.type === 'threat' || (x.type === 'capture' && x.outcome === 'wins-material'));
      if (allows && !hollow && !(bestAllows && allowsSignature(bestAllows) === allowsSignature(allows))) immediate = [allows, ...immediate];
    }
    const short: Fact[] = [narrated.line, ...narrated.forcedReplies];
    shortFacts.set(w.uci, short);
    const ectx: ExplainContext = label ? { mover, label, uci: w.uci } : { mover, uci: w.uci };
    // (M5c) the played bad move's eval drop, for the honest hedge (only without mate scores: the number then means something)
    if (label && BAD_LABELS.has(label) && best.score.mate === undefined && w.score.mate === undefined && w.uci !== cands[0]!.uci) {
      ectx.hedge = { dropPawns: (guardCp(best.score) - guardCp(w.score)) / 100, bestSan: cands[0]!.san };
      const later = -laterMaterial(fen, w.pv);
      if (later >= 1) ectx.hedge.laterLoss = later;
    }
    allFacts.set(w.uci, { immediate, short, long, ctx: ectx });
    const e = renderExplanation({ immediate, short, long }, ectx);
    factsMs += now() - tf;
    explained.set(w.uci, e);
    return e;
  };

  const toCandidate = (w: MoveWork, withExplanation?: NonNullable<Candidate['explanation']>): Candidate => {
    const isBest = sameMoveUci(fen, w.uci, best.move);
    const winLoss = isBest ? 0 : Math.max(0, winBest - winPercentFromScore(w.score));
    const c: Candidate = {
      uci: w.uci,
      san: w.san,
      rank: w.rank,
      score: toWhitePov(w.score, mover),
      winLoss,
      pv: pvToSan(fen, w.pv),
      pvUci: w.pv,
      explainable: (w.reasons ?? []).length === 0,
    };
    if (w.reasons?.length) c.notExplainableReasons = [...w.reasons];
    if (withExplanation) c.explanation = withExplanation;
    return c;
  };

  const bestWork = cands[0]!;
  const playedIsBest = sameMoveUci(fen, playedWork.uci, bestWork.uci);
  // (Why round) a Miss is a missed chance: the generic rule (the opponent's last move was a mistake and this one
  // doesn't punish it) keeps Miss only when the best move has a concrete point — it wins material, mates or carries
  // a tactic. Otherwise the win-chance label stands: missing a quiet developing move is no missed opportunity.
  if (cr.label === 'miss' && cr.labelReason.miss && !cr.labelReason.missedMate && !cr.labelReason.missedMaterial && !concreteChance(fen, bestWork)) {
    cr.label = worseLabel(cr.labelReason.winChance, cr.labelReason.material?.label);
  }
  // (Feedback round 3) a Blunder only because a concrete win was missed is a Miss — a tactic the played move doesn't
  // carry as well (e8=N+ instead of e8=Q promotes too: the wrong piece is its own mistake, not a missed chance)
  const bestAhead = laterMaterial(fen, bestWork.pv) >= 1;
  if (!playedIsBest) missedChanceMiss(cr, bestWork.immediate.some((f) => CONCRETE_TYPES.has(f.type) && (bestAhead || !PAYOFF_TYPES.has(f.type)) && !playedWork.immediate.some((g) => g.type === f.type)));
  // (D1) the label the quick pass showed stays for a small shift
  cr.label = stickyLabel(cr.label, input.provisionalLabel, cr.labelReason.winChance, cr.winLoss, settings);
  // M3 missed-mate rule: the Immediate level names the mate the move misses (best line, ends in checkmate)
  const mm = cr.labelReason.missedMate;
  if (mm && !playedIsBest && !cr.checkmate && mm.mateIn <= MATE_LINE_MAX_MOVES) {
    const ml = mateLineSan(fen, bestWork.pv, 2 * mm.mateIn - 1);
    if (ml) playedWork.immediate = [{ type: 'misses-mate', mateIn: mm.mateIn, best: bestWork.san, line: ml }, ...playedWork.immediate];
  }
  // the best move first (when it isn't the played move): the played move's refutation compares with its line
  const bestExplanation = playedIsBest ? null : await explain(bestWork);
  const playedCand = toCandidate(playedWork, await explain(playedWork, cr.label));
  playedCand.winLoss = cr.winLoss;
  const bestCand = toCandidate(bestWork, bestExplanation ?? (await explain(bestWork)));
  const pickCand = pickWork ? toCandidate(pickWork, await explain(pickWork)) : null;
  timings.facts = Math.round(factsMs);
  timings.factsTotal = Math.round(now() - tFacts);

  // evals, accuracy, arrows
  const evalBefore = toWhitePov(best.score, mover);
  const winBefore = winBest;
  const winAfter = winPercentForColor(evalAfter, mover);
  const arrows: Arrow[] = [{ ...uciSquares(played.uci), kind: 'played' }, { ...uciSquares(bestWork.uci), kind: 'best' }];
  if (pickWork) arrows.push({ ...uciSquares(pickWork.uci), kind: 'pick' });
  if (playedWork.threat) arrows.push({ ...uciSquares(playedWork.threat.move), kind: 'threat' });

  timings.cachedSearches = cachedSearches;
  timings.total = Math.round(now() - t0);
  const analysis: MoveAnalysis = {
    version: ANALYSIS_VERSION,
    fenBefore: fen,
    fenAfter: played.fenAfter,
    uci: played.uci,
    san: played.san,
    color: mover,
    evalBefore,
    evalAfter,
    winBefore,
    winAfter,
    winLoss: cr.winLoss,
    accuracy: moveAccuracy(winBefore, winAfter),
    label: cr.label,
    labelReason: cr.labelReason,
    played: playedCand,
    best: bestCand,
    pick: pickCand,
    pickIsBest: !!pickWork && pickWork.uci === bestWork.uci,
    deepOnly: !pickWork,
    candidates: cands.map((w) => toCandidate(w)),
    arrows,
    timings,
  };
  if (nextBest) analysis.nextBest = nextBest;
  if (nextTop) analysis.nextTop = nextTop;
  // (Points) what the played move does, as short points, and — when it isn't the best move — the best move's, the
  // played move told by how it differs when they share the idea (movePoints.ts, from the same facts and searches)
  {
    const delta = (w: MoveWork) => narratedDelta(fen, w.pv, w.score, settings);
    const baseline = median(cands.map(delta));
    const laterBaseline = median(cands.map((w) => laterMaterial(fen, w.pv)));
    const pointsOf = (w: MoveWork, winLoss: number) => movePoints(fen, { uci: w.uci, pv: w.pv, score: w.score, winLoss, baseline, laterBaseline, prev: prevMove ?? null }, settings, {
      threat: w.immediate.find((f): f is ThreatFact => f.type === 'threat') ?? null,
      defends: w.immediate.find((f): f is Extract<Fact, { type: 'defends-threat' }> => f.type === 'defends-threat') ?? null,
      prevents: w.immediate.find((f): f is Extract<Fact, { type: 'prevents' }> => f.type === 'prevents') ?? null,
    });
    const played = pointsOf(playedWork, cr.winLoss);
    if (playedIsBest) analysis.points = { played: compareIdeas([played])[0]! };
    else {
      const [b, p] = compareIdeas([pointsOf(bestWork, 0), played]);
      analysis.points = { played: p!, best: b! };
    }
  }
  // why the best move is better (its own verified facts, incl. quiet / long-term ones — M5b), for the label text and,
  // when the played move's Immediate level has nothing else to say, as a 'misses' sentence there
  const bf = allFacts.get(bestWork.uci);
  const pf = allFacts.get(playedWork.uci);
  const betterR = BAD_LABELS.has(cr.label) && !playedIsBest && bf && pf
    ? betterReasonFacts([...bf.immediate, ...bf.short, ...bf.long], [...pf.immediate, ...pf.short, ...pf.long], mover, bestWork.uci, { positional: cr.label === 'inaccuracy', playedFenAfter: playedWork.fenAfter, laterGain: laterMaterial(fen, bestWork.pv), playedUci: playedWork.uci })
      // (Feedback round 3) a quiet reason ("develops the bishop") explains an Inaccuracy, never a Mistake / Blunder / Miss
      .filter((r) => cr.label === 'inaccuracy' || r.magnitude >= QUIET_REASON_MAX)
    : [];
  const better = betterR.map((r) => r.phrase);
  // (M5c) the eval drop (pawns, mover POV, mates as big numbers) vs the biggest verified reason
  const dropPawns = (guardCp(best.score) - guardCp(playedLine.score)) / 100;
  const partial = reasonsArePartial(betterR, dropPawns, cr.label === 'mistake' || cr.label === 'blunder' || cr.label === 'miss');
  // (Why round) what goes wrong in the played move's own line — a piece it leaves loose that the line goes after, a
  // trade into a lost / drawn ending — told when nothing verified covers the drop yet: no label rule names the
  // reason (allowed / missed mate, missed free material, the material rule), the best move's reasons are missing or
  // small, and the played move's own negative facts are small next to the drop. A Miss stays about the chance.
  let cause: Cause | null = null;
  let fine: string[] = [];
  if (BAD_LABELS.has(cr.label) && !playedIsBest && pf) {
    const lr = cr.labelReason;
    const ruled = !!lr.allowedMate || !!lr.missedMate || !!lr.missedMaterial || (lr.material?.label !== undefined && lr.material.label === cr.label);
    const covered = betterR.length > 0 && !partial;
    if (!ruled && !covered && cr.label !== 'miss' && negativeSize(pf.immediate) < dropPawns / 2) {
      const loose = loosensFact(fen, playedWork.pv);
      // (Feedback round 3) the moved piece chased with tempo — unless the best move's piece gets chased the same way
      const bestChased = chasedFact(fen, bestWork.pv);
      const chased = chasedFact(fen, playedWork.pv);
      const chase = chased && !(bestChased && bestChased.piece.role === chased.piece.role) ? chased : null;
      cause = tradesDownFact({ fenBefore: fen, pv: playedWork.pv, bestPv: bestWork.pv, winBest, winPlayed: winBest - cr.winLoss }) ?? (loose?.won ? loose : null) ?? passerFact(fen, playedWork.pv, bestWork.pv) ?? chase ?? loose;
      // (Feedback round 3) an opening move that brings nothing out, when clearly better moves do
      if (!cause && (cr.label === 'inaccuracy' || cr.label === 'mistake')) {
        const better = cands.filter((c) => c.uci !== playedWork.uci && winBest - winPercentFromScore(c.score) <= Math.max(1.5, cr.winLoss / 3));
        cause = undevelopedFact(fen, playedWork.uci, better);
      }
    }
    fine = fineAlternatives(cands.map((c) => ({ san: c.san, uci: c.uci, winLoss: Math.max(0, winBest - winPercentFromScore(c.score)) })), playedWork.uci, cr.winLoss);
  }
  if (BAD_LABELS.has(cr.label) && !playedIsBest && pf) {
    const misses: Extract<Fact, { type: 'misses' }> = { type: 'misses', san: bestWork.san, uci: bestWork.uci, facts: betterR.flatMap((r) => r.facts) };
    if (partial) misses.partial = true;
    if (fine.length) misses.fine = fine;
    // (B1) missed free material: say "for free", and name a threat the played move parried that the best move
    // stops as well (only when the threat move is no longer legal after the best move, e.g. its piece was taken)
    const free = cr.labelReason.missedMaterial;
    if (free?.free) {
      misses.free = free.piece;
      const parried = pf.immediate.find((f): f is Extract<Fact, { type: 'defends-threat' }> => f.type === 'defends-threat');
      if (parried && legalPrefix(bestWork.fenAfter, [parried.move]).length === 0) misses.alsoStops = parried.san;
    }
    // the cause leads the Immediate level, unless the refutation sentence already tells that same reply ("Allows Qa5,
    // pinning the knight on c3" vs "…Qa5 attacks it"): then it only shapes the label text
    const sameReply = cause?.type === 'loosens' && cause.route.length === 1 && pf.immediate.some((f) => f.type === 'allows' && f.reply.san === cause!.route[0]);
    playedCand.explanation = renderExplanation({ immediate: [...(cause && !sameReply ? [cause] : []), ...pf.immediate, misses], short: pf.short, long: pf.long }, pf.ctx);
  }
  // (M5c) the suggestions shown next to the played move don't repeat its sentences as their own point
  const pe = playedCand.explanation;
  if (pe) {
    for (const c of [bestCand, pickCand]) {
      if (c?.explanation && !sameMoveUci(fen, c.uci, playedCand.uci)) c.explanation = contrastWithPlayed(c.explanation, pe, played.san);
    }
  }
  // (Why round) the best line's material further on, when it shows more than the reasons told
  const told = Math.max(0, ...betterR.map((r) => r.magnitude));
  const bl = partial && !playedIsBest ? laterMaterial(fen, bestWork.pv) : 0;
  const betterLater = bl >= told + 1 ? bl : 0;
  const hangs = playedWork.immediate.filter((f): f is Extract<Fact, { type: 'hangs' }> => f.type === 'hangs').sort((a, b) => b.loss - a.loss);
  const hang0 = hangs.find((h) => h.piece.square === cr.labelReason.material?.hung?.square) ?? hangs[0];
  // (M5c) a hung piece the refutation takes with a tactic (Nxc7+ forking king and rook): the tactic is the reason, not the pawn
  const refut = pf?.immediate.find((f): f is Extract<Fact, { type: 'allows' }> => f.type === 'allows');
  const tacticTakes = !!refut && refut.facts.some((x) => x.type === 'fork' || x.type === 'skewer' || x.type === 'discovered-attack') && refut.facts.some((x) => x.type === 'capture' && x.captured.square === hang0?.piece.square);
  const hang = tacticTakes ? undefined : hang0;
  // (Feedback round 3) the played move's refutation, as its Immediate level tells it
  const pa = pf?.immediate.find((f): f is Extract<Fact, { type: 'allows' }> => f.type === 'allows');
  // (not when the move's own capture loses material: that is the story — Rxe2 giving up the exchange)
  const losingCapture = playedWork.immediate.some((f) => f.type === 'capture' && f.outcome === 'loses-material');
  const refutation = pa && pf && BAD_LABELS.has(cr.label) && !losingCapture ? allowsText(pa, pf.ctx) : undefined;
  analysis.labelText = labelText({ ...analysis, bestSan: bestWork.san, bestUci: bestWork.uci, checkmate: cr.checkmate, better, ...(partial ? { betterPartial: true } : {}), verifiedHang: hang ? { piece: hang.piece, loss: hang.loss, ...(hang.already ? { already: true } : {}) } : null, cause, fine, ...(betterLater ? { betterLater } : {}), ...(refutation ? { refutation } : {}) }, settings);
  const verdict = verdictText(cr.label, playedIsBest);
  if (verdict) analysis.verdictText = verdict;
  return analysis;
}

/** (Feedback round 3) Better-move reasons below this size (develop 0.2, castle 0.3, positional 0.4) are quiet ones. */
export const QUIET_REASON_MAX = 0.5;

/** (Why round) Plies of a PV read for the material it has won or lost further on (no sentence claims more than this). */
export const LATER_PLIES = 14;

/** (Why round) The mover's material change along `pv` up to LATER_PLIES, at a quiet point (0 when the line ends mid-exchange or in mate). */
export function laterMaterial(fen: string, pv: readonly string[]): number {
  if (pv.length < 2) return 0;
  const m = lineMaterial(fen, pv, { horizonPlies: Math.min(pv.length, LATER_PLIES) });
  return m.quiet && !m.mate ? m.delta : 0;
}

/** Allowed / missed mates up to this many moves are told with their moves. */
export const MATE_LINE_MAX_MOVES = 3;

/** Board facts that make a move a concrete chance (Miss): a tactic or a material / mating point. */
const CONCRETE_TYPES = new Set<Fact['type']>(['checkmate', 'fork', 'pin', 'skewer', 'discovered-attack', 'trapped', 'attack-pinned', 'promotion']);
/** (Feedback round 3) Tactics that are a chance only when the line ends up material ahead ("e5 uncovers an attack on the queen" that just moves). */
const PAYOFF_TYPES = new Set<Fact['type']>(['pin', 'skewer', 'discovered-attack', 'attack-pinned']);

/**
 * (Why round) The move has a concrete point: it wins material at once, carries a tactic, threatens mate or material
 * (>= a pawn), or its narrated line wins material or mates.
 */
function concreteChance(fen: string, w: Pick<MoveWork, 'immediate' | 'narrated' | 'pv'>): boolean {
  if (w.narrated.line.result === 'wins-material' || w.narrated.line.result === 'mate') return true;
  // (Feedback round 3) a threat alone is no chance: Bg4 "threatening" Bxf3 on a queen that steps away with Qg3
  // wins nothing. A mate threat counts; a material threat only when the line is material up further on.
  const ahead = laterMaterial(fen, w.pv) >= 1;
  return w.immediate.some((f) => (CONCRETE_TYPES.has(f.type) && (ahead || !PAYOFF_TYPES.has(f.type)))
    || (f.type === 'capture' && f.outcome === 'wins-material')
    || (f.type === 'threat' && (f.mateIn !== undefined || (f.gain >= 1 && laterMaterial(fen, w.pv) >= 1))));
}

/**
 * A checking fork the engine line carries out (`pvFork`): attach the follow-up to the board fork of the same piece,
 * or — when the board-only test couldn't confirm it — add it, replacing the plain check / attack on the target.
 */
export function addLineFork(facts: Fact[], fen: string, pv: readonly string[]): void {
  const fk = pvFork(fen, pv);
  if (!fk || !fk.followUp) return;
  const target = fk.targets.find((t) => t.role !== 'king')!;
  const board = facts.find((f): f is Extract<Fact, { type: 'fork' }> => f.type === 'fork' && f.attacker.square === fk.attacker.square);
  if (board) {
    if (board.targets.some((t) => t.square === target.square)) board.followUp = fk.followUp;
    return;
  }
  for (let i = facts.length - 1; i >= 0; i--) {
    const f = facts[i]!;
    if ((f.type === 'check' && !f.double && !f.discovered) || (f.type === 'attack' && f.target.square === target.square)) facts.splice(i, 1);
  }
  facts.unshift(fk);
}

/** The engine's expected reply (PV ply 2) captures the piece that just moved (on its destination square). */
export function replyTakesMovedPiece(uci: string, reply: string | undefined): boolean {
  return !!reply && reply.slice(2, 4) === uci.slice(2, 4);
}

/**
 * When the move is a capture and the expected reply simply takes the piece back, the capturing piece's new
 * attacks are moot (a trade): drop its 'attack' facts (the threat fact is dropped by the caller for any move
 * whose piece is taken). A quiet move keeps its attacks — they are its point, and the line shows the refutation.
 * Forks/pins are verified against every reply and stay.
 */
/** What a refutation does: reply, what it captures, which pieces it puts en prise. */
function allowsSignature(f: Extract<Fact, { type: 'allows' }>): string {
  const cap = f.facts.find((x): x is Extract<Fact, { type: 'capture' }> => x.type === 'capture');
  const threat = f.facts.find((x): x is Extract<Fact, { type: 'threat' }> => x.type === 'threat');
  return [f.reply.uci, cap?.captured.square ?? '', threat?.move ?? '', ...(f.targets ?? []).map((t) => t.square).sort()].join('|');
}

/** Plies of the move's PV used to confirm board claims ("hanging", "stops the threat"). */
export const VERIFY_PLIES = 6;
/** (M5b, round 6) a trapped piece may be collected a little later (…c4 trapping the bishop, axb3 at ply 9). */
export const TRAPPED_VERIFY_PLIES = 12;

/** The opponent plays `uci` (normalised) within the first VERIFY_PLIES of the move's PV. */
export function opponentPlays(pv: readonly string[], uci: string): boolean {
  return pv.slice(0, VERIFY_PLIES).some((m, i) => i % 2 === 1 && m.slice(0, 4) === uci.slice(0, 4));
}

/**
 * Board claims confirmed by the engine line (SEE alone misses pins, forks and forced recaptures):
 * a 'hangs' piece must actually be captured on its square by the opponent within the first VERIFY_PLIES of the
 * move's PV — when the engine doesn't take it, it isn't hanging.
 */
export function verifyWithLine(facts: Fact[], fen: string, pv: readonly string[]): Fact[] {
  const taken = new Set<string>();
  const pos = positionFromFen(fen);
  for (const [i, m] of pv.slice(0, VERIFY_PLIES).entries()) {
    const mv = legalMoveAt(pos, m);
    if (!mv) break;
    const to = m.slice(2, 4);
    if (i % 2 === 1 && pos.board.get(mv.to)) taken.add(to);
    pos.play(mv);
  }
  // a piece that stood on the same square and could be won just as well before the move: "already" hanging
  const before = positionFromFen(fen);
  return facts
    .filter((f) => f.type !== 'hangs' || taken.has(f.piece.square))
    // (M5c) …and the line's material shows it (a 'trapped' knight that trades itself off on b4 isn't won)
    .filter((f) => f.type !== 'trapped' || (moverWins(fen, pv, f.piece.square, TRAPPED_VERIFY_PLIES) && lineMaterial(fen, pv, { horizonPlies: TRAPPED_VERIFY_PLIES }).delta >= PIECE_VALUES[f.piece.role] - 1))
    // (M5c) a pawn fork the pawn can be taken from: only when the engine line then wins material
    .filter((f) => !(f.type === 'fork' && f.byLine) || lineMaterial(fen, pv, { horizonPlies: VERIFY_PLIES }).delta >= 1)
    // (M5b) a pin the opponent ignores at once (the pinned piece moves in the reply: 6.Bg5? Nxe4!) isn't one
    .filter((f) => !(f.type === 'pin' && pv[1]?.slice(0, 2) === f.pinned.square))
    // (round 8) an offered attacker the reply simply takes attacks nothing
    .filter((f) => !(f.type === 'attack' && f.offered && (!pv[1] || pv[1].slice(2, 4) === f.attacker.square)))
    // (M5b) "saves the piece" only if the reply doesn't attack it again (…Nh4+ Kg3)
    .filter((f) => f.type !== 'escape' || !hangsAfterReply(fen, pv, f.piece.square))
    .map((f) => {
      if (f.type !== 'hangs' || f.already) return f;
      const sq = parseSquare(f.piece.square)!;
      const p = before.board.get(sq);
      return p && p.role === f.piece.role && p.color === f.piece.color && hangingLoss(before, sq) >= f.loss ? { ...f, already: true } : f;
    });
}

/** The piece the threat `uci` would capture is still on its square and en prise in `fenAfter`. */
export function stillEnPrise(fenAfter: string, threatUci: string): boolean {
  const pos = positionFromFen(fenAfter);
  const sq = parseSquare(threatUci.slice(2, 4));
  if (sq === undefined) return false;
  const p = pos.board.get(sq);
  return !!p && p.color !== pos.turn && hangingLoss(pos, sq) > 0;
}

/** The mover's piece on `square` (after the move) is en prise again after the opponent's PV reply. */
export function hangsAfterReply(fen: string, pv: readonly string[], square: string): boolean {
  if (pv.length < 2) return false;
  const pos = positionFromFen(fen);
  for (const m of pv.slice(0, 2)) {
    const mv = legalMoveAt(pos, m);
    if (!mv) return false;
    pos.play(mv);
  }
  const sq = parseSquare(square)!;
  return !!pos.board.get(sq) && hangingLoss(pos, sq) > 0;
}

/**
 * The mover captures the opponent piece standing on `square` after the move (following it if it moves) within the
 * first VERIFY_PLIES of the move's PV.
 */
export function moverWins(fen: string, pv: readonly string[], square: string, plies: number = VERIFY_PLIES): boolean {
  const pos = positionFromFen(fen);
  const mover = pos.turn;
  let sq: number | undefined = parseSquare(square);
  for (const [i, m] of pv.slice(0, plies).entries()) {
    const mv = legalMoveAt(pos, m);
    if (!mv || sq === undefined) return false;
    if (i > 0) {
      if (pos.turn !== mover && mv.from === sq) sq = mv.to;
      else if (pos.turn === mover && mv.to === sq) return true;
    }
    pos.play(mv);
  }
  return false;
}

/**
 * The move's null-move threat was already there before the move: the threat move is legal right now and wins the
 * same (a capture worth as much by SEE, or mate in one) — then it is not something the move created.
 */
export function threatExistedBefore(fen: string, threat: ThreatFact): boolean {
  const pos = positionFromFen(fen);
  const mv = legalMoveAt(pos, threat.move);
  if (!mv) return false;
  if (threat.mateIn === 1) {
    const p = pos.clone();
    p.play(mv);
    return p.isCheckmate();
  }
  if (threat.mateIn) return false;
  return !!pos.board.get(mv.to) && seeMove(pos, threat.move) >= Math.min(threat.gain, 1) && seeMove(pos, threat.move) >= seeMoveAfter(threat);
}

/**
 * The threatened piece attacks the threatening piece and the opponent is to move (queens facing each other): the
 * opponent can take first or simply step away — "Qf7 threatens Qxd5, winning a queen" is no threat.
 */
export function targetHitsBack(fenAfter: string, threat: ThreatFact): boolean {
  if (threat.mateIn) return false;
  const pos = positionFromFen(fenAfter); // opponent to move
  const from = parseSquare(threat.move.slice(0, 2));
  const to = parseSquare(threat.move.slice(2, 4));
  if (from === undefined || to === undefined) return false;
  const target = pos.board.get(to);
  if (!target || target.color !== pos.turn) return false;
  // (M5b: only when taking back doesn't lose material — Bf1 hitting the queen on c4 is a threat even if Qxf1 is legal)
  if (legalMoveAt(pos, `${threat.move.slice(2, 4)}${threat.move.slice(0, 2)}`) === undefined) return false;
  const back = seeCaptureWith(pos, to, from);
  return back === undefined || back >= 0;
}

/** SEE value of the threat's own capture (from its facts), for comparing with the same capture now. */
function seeMoveAfter(threat: ThreatFact): number {
  const cap = threat.facts.find((f): f is Extract<Fact, { type: 'capture' }> => f.type === 'capture');
  return cap ? cap.net : Infinity;
}

export function pruneRefuted(facts: Fact[], uci: string, reply: string | undefined): Fact[] {
  if (!replyTakesMovedPiece(uci, reply)) return facts;
  if (!facts.some((f) => f.type === 'capture')) return facts;
  const to = uci.slice(2, 4);
  return facts.filter((f) => !((f.type === 'attack' || f.type === 'attack-pinned') && f.attacker.square === to));
}


export { SearchCache };
