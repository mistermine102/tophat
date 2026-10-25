// Explainable pick (SPEC "Suggestions"). Pure: candidates arrive with their deep/shallow scores and facts.
//
// Pick = first candidate in engine order (deep MultiPV rank) that passes all of:
//  1. Good or better: winLoss <= suggest.pickMaxLoss (code 'too-much-loss') and the material rule doesn't flag it
//     (materialCheck vs the best line gives no label; code 'material-rule'). Addition: it must not hang a piece,
//     make a losing capture or allow mate unless its own short line wins material or mates (code
//     'hangs-material') — in lost or crushing positions win% saturates and the material rule (relative to the
//     best line) lets e.g. a queen hang because the best line loses as much. Same code: its short line loses
//     LINE_LOSS_VS_BEST or more material than the best move's short line.
//  2. Keeps the result: if the best move keeps the mover winning (win% >= suggest.winningMin) the candidate must
//     too; else if the best holds a draw-ish position (win% >= suggest.drawishMin) the candidate must not drop
//     below it (code 'loses-result'). Also 'loses-result': the candidate gets mated by force while the best move
//     doesn't (win% saturates in lost positions, so mate in 2 and -13 look the same).
//  3. Near-term: the shallow search rates it within suggest.shallowTolerance win% of the deep best:
//     win%(deep best) - win%(shallow score of the candidate) <= tolerance (code 'shallow-disagrees'; also when no
//     shallow score is known) ...
//  4. ... and it has at least one concrete Immediate or Short-term fact (code 'no-concrete-fact'), see
//     `concreteFacts`: check, checkmate, a capture that wins material or recaptures, promotion, fork, pin,
//     skewer, discovered attack, escape (saving an attacked piece), stopping the opponent's verified threat
//     ('defends-threat'), a threat with verified gain or mate, a line that wins material or mates (the line's
//     result is only claimed at a quiet point, see facts/line.ts), an attack on an undefended / more valuable
//     piece or pawn that the line then really wins (the mover captures on that square and the line wins
//     material), and a double attack (one piece newly attacks two targets). (SPEC lists check / winning capture /
//     threat / fork / pin / escape / line gain / mate; skewer, discovered attack, promotion, recapture, a
//     converted attack and a double attack are the same kind of concrete point.) M5b: a trapped piece (the line wins
//     it), prophylaxis ('prevents') and an attack on a pinned piece that the line wins. M5c: a perpetual check by the
//     mover. Rule 3's shallow test is waived when the candidate's own short line shows the payoff (`storyPaysOff`:
//     mate, material won beyond what the opponent's last move took, a perpetual check by the mover) — the story the
//     reader sees is the near-term point, so it is never captioned "deep engine move — hard to explain".
// All candidates are judged (so every one gets `explainable` + `notExplainableReasons`).

import type { AnalysisSettings, Fact, MaterialCheck, Score } from '@chess-coach/shared';
import { winPercentFromScore } from '@chess-coach/shared';

export type ReasonCode = 'too-much-loss' | 'material-rule' | 'hangs-material' | 'loses-result' | 'shallow-disagrees' | 'no-concrete-fact';

export interface SuggestCandidate {
  uci: string;
  /** Deep score, mover POV. */
  score: Score;
  /** Shallow score, mover POV (null if unknown). */
  shallowScore: Score | null;
  /** materialCheck of this candidate's line against the best line (no label = passes). */
  material: MaterialCheck | null;
  /** Immediate facts (incl. the threat fact) and Short-term facts (line, forced-reply). */
  facts: readonly Fact[];
}

/** The facts among `facts` that count as concrete for rule 4. */
export function concreteFacts(facts: readonly Fact[]): Fact[] {
  const line = facts.find((f): f is Extract<Fact, { type: 'line' }> => f.type === 'line');
  const mover = line?.steps[0]?.color;
  const lineWins = (sq: string) =>
    line?.result === 'wins-material' && line.steps.some((s) => s.color === mover && s.uci.slice(2, 4) === sq && s.facts.some((x) => x.type === 'capture'));
  const attacksBy = new Map<string, Set<string>>();
  for (const f of facts) if (f.type === 'attack') attacksBy.set(f.attacker.square, (attacksBy.get(f.attacker.square) ?? new Set()).add(f.target.square));
  return facts.filter((f) => {
    switch (f.type) {
      case 'check':
      case 'checkmate':
      case 'promotion':
      case 'fork':
      case 'pin':
      case 'skewer':
      case 'discovered-attack':
      case 'escape':
      case 'defends-threat':
      case 'trapped': // (M5b: kept only when the engine line wins the piece)
      case 'prevents': // (M5b: prophylaxis against an engine-verified idea worth >= 1.5 pawns)
        return true;
      case 'attack-pinned':
        return lineWins(f.pinned.square);
      case 'capture':
        return f.outcome === 'wins-material' || f.outcome === 'recapture';
      case 'threat':
        return f.gain >= 1 || (f.mateIn ?? 0) > 0;
      case 'line':
        // (M5c) a perpetual check by the mover is a concrete point too (it saves a lost position)
        return f.result === 'wins-material' || f.result === 'mate' || (f.draw === 'perpetual' && f.drawBy === mover);
      case 'attack':
        return lineWins(f.target.square) || (attacksBy.get(f.attacker.square)?.size ?? 0) >= 2;
      default:
        return false;
    }
  });
}

/** A new hanging piece / losing capture / allowed mate that the candidate's own short line doesn't justify. */
export function hangsWithoutPayoff(facts: readonly Fact[]): boolean {
  const line = facts.find((f): f is Extract<Fact, { type: 'line' }> => f.type === 'line');
  if (line && (line.result === 'mate' || line.result === 'wins-material')) return false;
  return facts.some((f) => (f.type === 'hangs' && !f.already) || f.type === 'allows-mate' || (f.type === 'capture' && f.outcome === 'loses-material'));
}

/** Material change (mover POV) claimed by a candidate's short line, or null when it claims none. */
export function lineDelta(facts: readonly Fact[]): number | null {
  const line = facts.find((f): f is Extract<Fact, { type: 'line' }> => f.type === 'line');
  if (!line || line.result === 'unclear' || line.result === 'mate' || line.result === 'mated') return null;
  return line.materialDelta;
}

/**
 * (M5c) The candidate's short line itself shows the payoff: it mates, wins material beyond what the opponent's last
 * move took (`owed`), or ends in a perpetual check by the mover.
 */
export function storyPaysOff(facts: readonly Fact[]): boolean {
  const line = facts.find((f): f is Extract<Fact, { type: 'line' }> => f.type === 'line');
  if (!line) return false;
  if (line.result === 'mate') return true;
  if (line.result === 'wins-material' && line.materialDelta - (line.owed ?? 0) >= 1) return true;
  return line.draw === 'perpetual' && !!line.drawBy && line.drawBy === line.steps[0]?.color;
}

/** A candidate line that loses this much more material than the best line is no teaching pick. */
export const LINE_LOSS_VS_BEST = 2;

/**
 * Reason codes why a candidate is not an explainable pick (empty = explainable). `bestScore`: deep, mover POV;
 * `bestLineDelta`: the best move's short-line material change (`lineDelta`), if known.
 */
export function judgeCandidate(c: SuggestCandidate, bestScore: Score, settings: AnalysisSettings, bestLineDelta: number | null = null): ReasonCode[] {
  const r = settings.suggest;
  const reasons: ReasonCode[] = [];
  const winBest = winPercentFromScore(bestScore);
  const win = winPercentFromScore(c.score);
  const winLoss = Math.max(0, winBest - win);
  if (winLoss > r.pickMaxLoss) reasons.push('too-much-loss');
  if (c.material?.label) reasons.push('material-rule');
  const own = lineDelta(c.facts);
  // in lost / crushing positions win% saturates: a line that gives away much more than the best line's
  // (a queen and a rook for two bishops) is not "as good" for a learner
  if (hangsWithoutPayoff(c.facts) || (own !== null && bestLineDelta !== null && own <= bestLineDelta - LINE_LOSS_VS_BEST)) reasons.push('hangs-material');
  const getsMated = (c.score.mate ?? 0) < 0 && !((bestScore.mate ?? 0) < 0);
  if (getsMated || (winBest >= r.winningMin && win < r.winningMin) || (winBest >= r.drawishMin && winBest < r.winningMin && win < r.drawishMin)) {
    reasons.push('loses-result');
  }
  // (M5c) a candidate whose own short line shows a verified payoff (mate, material won, a perpetual check) is near-term
  // by its story, even when the shallow search misses it: "deep engine move — hard to explain" must not sit on top of
  // a story that explains it
  const shallowOff = !c.shallowScore || winBest - winPercentFromScore(c.shallowScore) > r.shallowTolerance;
  if (shallowOff && !storyPaysOff(c.facts)) reasons.push('shallow-disagrees');
  if (concreteFacts(c.facts).length === 0) reasons.push('no-concrete-fact');
  return reasons;
}

export interface SuggestResult {
  /** Index into the candidates of the pick, or null (deep engine move, hard to explain). */
  pick: number | null;
  reasons: ReasonCode[][];
}

/**
 * Judge all candidates (engine order) and pick the first explainable one. `bestLineDelta` defaults to the first
 * candidate's (= the engine's best) short-line material change.
 */
export function suggest(candidates: readonly SuggestCandidate[], bestScore: Score, settings: AnalysisSettings, bestLineDelta?: number | null): SuggestResult {
  const ref = bestLineDelta !== undefined ? bestLineDelta : candidates[0] ? lineDelta(candidates[0].facts) : null;
  const reasons = candidates.map((c) => judgeCandidate(c, bestScore, settings, ref));
  const i = reasons.findIndex((r) => r.length === 0);
  return { pick: i >= 0 ? i : null, reasons };
}
