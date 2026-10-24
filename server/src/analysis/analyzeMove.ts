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
import { materialCheck, sameMoveUci } from './classify';
import { BAD_LABELS, betterReasons, labelText, renderExplanation, verdictText } from './explain';
import { type PrevResult, labelMove } from './label';
import { type SearchParams, type Searcher, SearchCache } from './searchCache';
import { type ReasonCode, lineDelta, suggest } from './suggest';
import { legalMove as legalMoveAt, legalPrefix, playMove, positionStatus, pvToSan, uciSquares } from '../chess/notation';
import { hangingLoss, seeMove } from '../chess/see';
import { parseSquare } from 'chessops/util';
import type { PvLine, SearchResult } from '../engine/uci';
import { materialBalance, positionFromFen } from '../chess/material';
import { immediateFacts } from '../facts/immediate';
import { type ForcedInfo, type NarratedLine, type ThreatFact, forcedFromSearch, forcednessChecks, narrateLine, narrationPlies, nullMoveFen, refutationFact, threatFromSearch, threatStillWorks } from '../facts/line';
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
  const deepParams: SearchParams = { depth: B.deep.depth, multipv: B.deep.multipv, maxMs: B.deep.maxMs };

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
  const oppThreat = oppNull ? threatFromSearch(oppNull, await search('threat', oppNull, threatParams)) : null;
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
    if (threat && !replyTakesMovedPiece(p.uci, pv[1]) && !threatExistedBefore(fen, threat) && !targetHitsBack(p.fenAfter, threat)) immediate.push(threat);
    // "stops the threat" only if the engine line doesn't play it anyway
    // (a mate threat may still be played without mating: only material threats are checked against the PV)
    if (defends && !((defends as { mateIn?: number }).mateIn === undefined && opponentPlays(pv, (defends as { move: string }).move))) immediate.push(defends);
    // engine-verified forced mate against the mover that the best move avoids (board check only sees mate in 1)
    const matedIn = line.score.mate !== undefined && line.score.mate < 0 ? -line.score.mate : 0;
    if (matedIn > 1 && !((best.score.mate ?? 0) < 0) && !immediate.some((f) => f.type === 'allows-mate')) immediate.push({ type: 'allows-mate', inMoves: matedIn });
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
  const explain = async (w: MoveWork, label?: Label): Promise<NonNullable<Candidate['explanation']>> => {
    const done = explained.get(w.uci);
    if (done) return done;
    const plies = narrationPlies(fen, w.pv, settings, w.score, w.targetDelta !== undefined ? { targetDelta: w.targetDelta } : {});
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
      lineEndFen: narrated.endFen,
      mover,
      immediate: w.immediate,
      lineMaterialDelta: narrated.line.materialDelta,
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
      const allows = refutationFact({ fenBefore: fen, uci: w.uci, pv: w.pv, line: narrated.line, replyThreat });
      // the best move allows the same reply with the same effect: that is not what makes this move worse
      const b = cands[0]!;
      const bestAllows = sameMoveUci(fen, b.uci, w.uci) ? null : refutationFact({ fenBefore: fen, uci: b.uci, pv: b.pv, line: b.narrated.line });
      // the reply is exactly the opponent's verified threat from before the move: the move "doesn't stop" it
      // (only when it hits nothing new: Rg8+ walking into Kh7 is the move's own doing)
      if (allows && oppThreat && allows.reply.uci === oppThreat.move && !(allows.targets?.length)) allows.already = true;
      if (allows && !(bestAllows && allowsSignature(bestAllows) === allowsSignature(allows))) immediate = [allows, ...immediate];
    }
    const short: Fact[] = [narrated.line, ...narrated.forcedReplies];
    shortFacts.set(w.uci, short);
    const e = renderExplanation({ immediate, short, long }, label ? { mover, label, uci: w.uci } : { mover, uci: w.uci });
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
  const playedCand = toCandidate(playedWork, await explain(playedWork, cr.label));
  playedCand.winLoss = cr.winLoss;
  const bestCand = toCandidate(bestWork, await explain(bestWork));
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
  const better = BAD_LABELS.has(cr.label) && !playedIsBest
    ? betterReasons([...bestWork.immediate, ...(shortFacts.get(bestWork.uci) ?? [])], [...playedWork.immediate, ...(shortFacts.get(playedWork.uci) ?? [])], mover)
    : [];
  const hangs = playedWork.immediate.filter((f): f is Extract<Fact, { type: 'hangs' }> => f.type === 'hangs').sort((a, b) => b.loss - a.loss);
  const hang = hangs.find((h) => h.piece.square === cr.labelReason.material?.hung?.square) ?? hangs[0];
  analysis.labelText = labelText({ ...analysis, bestSan: bestWork.san, bestUci: bestWork.uci, checkmate: cr.checkmate, better, verifiedHang: hang ? { piece: hang.piece, loss: hang.loss, ...(hang.already ? { already: true } : {}) } : null }, settings);
  const verdict = verdictText(cr.label, playedIsBest);
  if (verdict) analysis.verdictText = verdict;
  return analysis;
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
  return [f.reply.uci, cap?.captured.square ?? '', ...(f.targets ?? []).map((t) => t.square).sort()].join('|');
}

/** Plies of the move's PV used to confirm board claims ("hanging", "stops the threat"). */
export const VERIFY_PLIES = 6;

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
    .map((f) => {
      if (f.type !== 'hangs' || f.already) return f;
      const sq = parseSquare(f.piece.square)!;
      const p = before.board.get(sq);
      return p && p.role === f.piece.role && p.color === f.piece.color && hangingLoss(before, sq) >= f.loss ? { ...f, already: true } : f;
    });
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
  return legalMoveAt(pos, `${threat.move.slice(2, 4)}${threat.move.slice(0, 2)}`) !== undefined;
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
  return facts.filter((f) => !(f.type === 'attack' && f.attacker.square === to));
}


export { SearchCache };
