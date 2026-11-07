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
import { guardCp, materialCheck, sameMoveUci } from './classify';
import { BAD_LABELS, betterReasonFacts, contrastWithPlayed, type ExplainContext, labelText, reasonsArePartial, renderExplanation, verdictText } from './explain';
import { type PrevResult, deepParams as labelDeepParams, labelMove } from './label';
import { type SearchParams, type Searcher, SearchCache } from './searchCache';
import { type ReasonCode, lineDelta, suggest } from './suggest';
import { legalMove as legalMoveAt, legalPrefix, playMove, positionStatus, pvToSan, uciSquares } from '../chess/notation';
import { hangingLoss, seeCaptureWith, seeMove } from '../chess/see';
import { parseSquare } from 'chessops/util';
import type { PvLine, SearchResult } from '../engine/uci';
import { PIECE_VALUES, lineMaterial, materialBalance, positionFromFen } from '../chess/material';
import { immediateFacts } from '../facts/immediate';
import { type ForcedInfo, type NarratedLine, type ThreatFact, forcedFromSearch, forcednessChecks, mateLineSan, narrateLine, narrationPlies, nullMoveFen, preventsFact, pvFork, refutationFact, threatFromSearch, threatStillWorks } from '../facts/line';
import { longTermFacts } from '../facts/longterm';

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
  if (status === 'checkmate') evalAfter = toWhitePov({ mate: 0 }, opp);
  else if (status === 'stalemate') evalAfter = { cp: 0 };
  else {
    const after = await search('deepAfter', played.fenAfter, deepParams);
    const s = after.lines[0]?.score;
    evalAfter = s ? toWhitePov(s, opp) : toWhitePov(playedLine.score, mover);
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
      if (allows && !(bestAllows && allowsSignature(bestAllows) === allowsSignature(allows))) immediate = [allows, ...immediate];
    }
    const short: Fact[] = [narrated.line, ...narrated.forcedReplies];
    shortFacts.set(w.uci, short);
    const ectx: ExplainContext = label ? { mover, label, uci: w.uci } : { mover, uci: w.uci };
    // (M5c) the played bad move's eval drop, for the honest hedge (only without mate scores: the number then means something)
    if (label && BAD_LABELS.has(label) && best.score.mate === undefined && w.score.mate === undefined && w.uci !== cands[0]!.uci) ectx.hedge = { dropPawns: (guardCp(best.score) - guardCp(w.score)) / 100, bestSan: cands[0]!.san };
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
  // why the best move is better (its own verified facts, incl. quiet / long-term ones — M5b), for the label text and,
  // when the played move's Immediate level has nothing else to say, as a 'misses' sentence there
  const bf = allFacts.get(bestWork.uci);
  const pf = allFacts.get(playedWork.uci);
  const betterR = BAD_LABELS.has(cr.label) && !playedIsBest && bf && pf
    ? betterReasonFacts([...bf.immediate, ...bf.short, ...bf.long], [...pf.immediate, ...pf.short, ...pf.long], mover, bestWork.uci, { positional: cr.label === 'inaccuracy', playedFenAfter: playedWork.fenAfter })
    : [];
  const better = betterR.map((r) => r.phrase);
  // (M5c) the eval drop (pawns, mover POV, mates as big numbers) vs the biggest verified reason
  const dropPawns = (guardCp(best.score) - guardCp(playedLine.score)) / 100;
  const partial = reasonsArePartial(betterR, dropPawns, cr.label === 'mistake' || cr.label === 'blunder' || cr.label === 'miss');
  if (BAD_LABELS.has(cr.label) && !playedIsBest && pf) {
    const misses: Extract<Fact, { type: 'misses' }> = { type: 'misses', san: bestWork.san, uci: bestWork.uci, facts: betterR.flatMap((r) => r.facts) };
    if (partial) misses.partial = true;
    // (B1) missed free material: say "for free", and name a threat the played move parried that the best move
    // stops as well (only when the threat move is no longer legal after the best move, e.g. its piece was taken)
    const free = cr.labelReason.missedMaterial;
    if (free?.free) {
      misses.free = free.piece;
      const parried = pf.immediate.find((f): f is Extract<Fact, { type: 'defends-threat' }> => f.type === 'defends-threat');
      if (parried && legalPrefix(bestWork.fenAfter, [parried.move]).length === 0) misses.alsoStops = parried.san;
    }
    playedCand.explanation = renderExplanation({ immediate: [...pf.immediate, misses], short: pf.short, long: pf.long }, pf.ctx);
  }
  // (M5c) the suggestions shown next to the played move don't repeat its sentences as their own point
  const pe = playedCand.explanation;
  if (pe) {
    for (const c of [bestCand, pickCand]) {
      if (c?.explanation && !sameMoveUci(fen, c.uci, playedCand.uci)) c.explanation = contrastWithPlayed(c.explanation, pe, played.san);
    }
  }
  const hangs = playedWork.immediate.filter((f): f is Extract<Fact, { type: 'hangs' }> => f.type === 'hangs').sort((a, b) => b.loss - a.loss);
  const hang0 = hangs.find((h) => h.piece.square === cr.labelReason.material?.hung?.square) ?? hangs[0];
  // (M5c) a hung piece the refutation takes with a tactic (Nxc7+ forking king and rook): the tactic is the reason, not the pawn
  const refut = pf?.immediate.find((f): f is Extract<Fact, { type: 'allows' }> => f.type === 'allows');
  const tacticTakes = !!refut && refut.facts.some((x) => x.type === 'fork' || x.type === 'skewer' || x.type === 'discovered-attack') && refut.facts.some((x) => x.type === 'capture' && x.captured.square === hang0?.piece.square);
  const hang = tacticTakes ? undefined : hang0;
  analysis.labelText = labelText({ ...analysis, bestSan: bestWork.san, bestUci: bestWork.uci, checkmate: cr.checkmate, better, ...(partial ? { betterPartial: true } : {}), verifiedHang: hang ? { piece: hang.piece, loss: hang.loss, ...(hang.already ? { already: true } : {}) } : null }, settings);
  const verdict = verdictText(cr.label, playedIsBest);
  if (verdict) analysis.verdictText = verdict;
  return analysis;
}

/** Allowed / missed mates up to this many moves are told with their moves. */
export const MATE_LINE_MAX_MOVES = 3;

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
function replyTakesMovedPiece(uci: string, reply: string | undefined): boolean {
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
function opponentPlays(pv: readonly string[], uci: string): boolean {
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

function pruneRefuted(facts: Fact[], uci: string, reply: string | undefined): Fact[] {
  if (!replyTakesMovedPiece(uci, reply)) return facts;
  if (!facts.some((f) => f.type === 'capture')) return facts;
  const to = uci.slice(2, 4);
  return facts.filter((f) => !((f.type === 'attack' || f.type === 'attack-pinned') && f.attacker.square === to));
}


export { SearchCache };
