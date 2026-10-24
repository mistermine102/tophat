// Analysis settings: every threshold and search budget from SPEC.md and ARCHITECTURE.md ("Analysis budget").
// Settings are passed explicitly (no globals) so the cache key can include `settingsHash(settings)`.
// Win-chance values are percentages (0..100) from the mover's point of view; cp values are centipawns.

/** Bump whenever analysis output semantics change. Part of the cache key, so bumping invalidates the cache. */
export const ANALYSIS_VERSION = 1;

export interface LabelThresholds {
  /** Best: engine #1 or winLoss <= this. */
  bestMaxLoss: number;
  /** Excellent: winLoss <= this. */
  excellentMaxLoss: number;
  /** Good: winLoss <= this. */
  goodMaxLoss: number;
  /** Inaccuracy: goodMaxLoss < winLoss <= this. */
  inaccuracyMaxLoss: number;
  /** Mistake: inaccuracyMaxLoss < winLoss <= this. Blunder: winLoss > this. */
  mistakeMaxLoss: number;
}

export interface GreatRule {
  /** The 2nd-best move must lose at least this much win% (the "mistake threshold"). */
  secondBestMinLoss: number;
  /** Mover's win% after the best move must be within [minWinAfterBest, maxWinAfterBest] ... */
  minWinAfterBest: number;
  maxWinAfterBest: number;
  /** ... unless the 2nd best throws away a win: win% after best >= maxWinAfterBest and win% after 2nd best < this. */
  throwsAwayWinBelow: number;
  /** Great requires at least this many legal moves. */
  minLegalMoves: number;
  /** Not Great: a check evasion with at most this many legal moves (an obvious only-move). */
  maxLegalMovesInCheck: number;
  /** Not Great: a capture whose static exchange wins at least this many pawns (taking free material). */
  freeCaptureMinGain: number;
}

export interface MaterialRule {
  /** Material loss (pawns, P=1 N=3 B=3 R=5 Q=9) >= this AND eval drop >= blunderMinEvalDropCp -> at least Blunder. */
  blunderMinLoss: number;
  blunderMinEvalDropCp: number;
  /** Material loss >= this AND eval drop >= mistakeMinEvalDropCp -> at least Mistake. */
  mistakeMinLoss: number;
  mistakeMinEvalDropCp: number;
  /** PV plies examined when resolving the line's material outcome to a quiet point. */
  quietHorizonPlies: number;
}

export interface MissRule {
  /** Opponent's previous move must have lost at least this much win% (i.e. it was a Mistake or worse). */
  opponentMinLoss: number;
  /** The best move now must keep at least this fraction of the win% the opponent gave away. */
  keepGainFraction: number;
  /** The played move must lose more than this (an inaccuracy's worth). */
  playedMinLoss: number;
}

export interface MateRule {
  /**
   * Allowed mate: the played move allows a forced mate in <= this many moves (engine score of the played move)
   * that the best move doesn't allow -> at least Blunder, even when win% was already ~0 (classify.ts).
   */
  allowedMaxMoves: number;
  /** ... a forced mate after the best move too counts as "doesn't allow" only if it is at least this many moves longer. */
  allowedMuchLongerBy: number;
  /** Missed mate: the best move forces mate in <= this many moves and the played move doesn't force mate -> at least Miss. */
  missedMaxMoves: number;
}

export interface SuggestionRule {
  /** Number of engine candidates considered (deep MultiPV). */
  candidates: number;
  /** The pick must itself be Good or better: winLoss <= this. */
  pickMaxLoss: number;
  /** Result keeping: if best keeps the mover at win% >= winningMin, the pick must too. */
  winningMin: number;
  /** If best holds win% >= drawishMin, the pick must not drop below drawishMin. */
  drawishMin: number;
  /** Near-term: the shallow search must rate the pick within this many win% of the deep best. */
  shallowTolerance: number;
}

export interface ExplanationRule {
  /** Plies of the PV narrated in the Short-term level (min..max). */
  shortLineMinPlies: number;
  shortLineMaxPlies: number;
  /** Opponent reply counts as "forced" if the 2nd-best reply is worse by at least this much win%. */
  forcedReplyMinGap: number;
  /** "necessary"/"you just had to play it": every alternative loses at least this much win%. */
  necessaryMinGap: number;
  /** Eval gain (cp) not explained by material in the short line needed for a "positional gain" fact. */
  positionalGainMinCp: number;
  /** "deep payoff": shallow search rates the move worse than deep by at least this much win%. */
  deepPayoffMinGap: number;
}

export interface SearchBudget {
  depth: number;
  multipv: number;
  /**
   * Time cap (ms): the search stops at `depth` or after this long, whichever comes first. Needed because
   * Stockfish can take minutes for a fixed depth in sharp positions with mates around (measured: d12 MultiPV 2
   * 68 s, d18 MultiPV 1 > 120 s in the Opera game).
   */
  maxMs: number;
}

export interface AnalysisBudget {
  /** 1. Deep search at fenBefore -> candidates, best line, 2nd best. Also used for the searchmoves=[played] search. */
  deep: SearchBudget;
  /** 2. Shallow search at fenBefore -> explainability test. */
  shallow: SearchBudget;
  /** 3. Threat (null-move) search after the played move / the pick. */
  threat: SearchBudget;
  /** 4. Forcedness checks at opponent replies along the short line. */
  forcedness: SearchBudget;
  /** Number of plies of the short line in which opponent replies are checked for forcedness. */
  forcednessPlies: number;
  /** 5. Label verification near thresholds (analysis/label.ts `verifyNearThreshold`). */
  verify: VerifyBudget;
}

/**
 * Stability (M3): when a label sits within `margin` win% of a threshold that decides it (winLoss vs the
 * Excellent / Good / Inaccuracy / Mistake bounds, or the 2nd best's loss vs Great's bound), the two moves are
 * re-searched together (`searchmoves=[best, other]`, MultiPV 2) at deep depth + `depthPlus` and the label is
 * taken from that search. Not hysteresis: the deeper verdict wins in both directions. `margin` 0 disables it.
 */
export interface VerifyBudget {
  margin: number;
  depthPlus: number;
  maxMs: number;
}

export interface AnalysisSettings {
  labels: LabelThresholds;
  great: GreatRule;
  material: MaterialRule;
  miss: MissRule;
  mate: MateRule;
  suggest: SuggestionRule;
  explain: ExplanationRule;
  budget: AnalysisBudget;
}

export const DEFAULT_SETTINGS: AnalysisSettings = {
  labels: {
    bestMaxLoss: 0.5,
    excellentMaxLoss: 2,
    goodMaxLoss: 5,
    inaccuracyMaxLoss: 10,
    mistakeMaxLoss: 20,
  },
  great: {
    secondBestMinLoss: 10,
    minWinAfterBest: 10,
    maxWinAfterBest: 97,
    throwsAwayWinBelow: 70,
    minLegalMoves: 2,
    maxLegalMovesInCheck: 3,
    freeCaptureMinGain: 1,
  },
  material: {
    blunderMinLoss: 3,
    blunderMinEvalDropCp: 250,
    mistakeMinLoss: 2,
    mistakeMinEvalDropCp: 150,
    quietHorizonPlies: 12,
  },
  miss: {
    opponentMinLoss: 10,
    keepGainFraction: 0.5,
    playedMinLoss: 5,
  },
  mate: {
    allowedMaxMoves: 3,
    allowedMuchLongerBy: 3,
    missedMaxMoves: 3,
  },
  suggest: {
    candidates: 5,
    pickMaxLoss: 5,
    winningMin: 70,
    drawishMin: 30,
    shallowTolerance: 5,
  },
  explain: {
    shortLineMinPlies: 2,
    shortLineMaxPlies: 8,
    forcedReplyMinGap: 10,
    necessaryMinGap: 10,
    positionalGainMinCp: 50,
    deepPayoffMinGap: 5,
  },
  budget: {
    deep: { depth: 18, multipv: 5, maxMs: 5000 },
    shallow: { depth: 8, multipv: 5, maxMs: 500 },
    threat: { depth: 12, multipv: 1, maxMs: 500 },
    forcedness: { depth: 12, multipv: 2, maxMs: 500 },
    forcednessPlies: 6,
    verify: { margin: 1, depthPlus: 2, maxMs: 8000 },
  },
};

/** JSON with object keys sorted recursively, so equal settings always serialise identically. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const s = JSON.stringify(value);
    return s === undefined ? 'null' : s;
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** FNV-1a 64-bit over UTF-16 code units. Pure JS (no Node/browser crypto) so it runs on both sides. */
function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/** Stable 16-hex-char hash of the settings (key order independent). Used in the cache key. */
export function settingsHash(settings: AnalysisSettings): string {
  return fnv1a64(stableStringify(settings));
}
