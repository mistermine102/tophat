// Fixture/mock-only: assemble a complete, type-correct MoveAnalysis from a compact description. FENs, SAN and UCI
// are always derived with chessops so they are legal and consistent.
import type {
  Arrow, Candidate, Color, Explanation, Fact, Label, Level, MaterialCheck, MoveAnalysis, Score,
} from '@chess-coach/shared';
import { ANALYSIS_VERSION, BAD_MOVE_TONE_ORDER, DEFAULT_SETTINGS, factTone, lineTone, moveAccuracy, winPercentForColor, type StoryPart, type Tone } from '@chess-coach/shared';
import { legalDests, playSan, sanLineToUci, uciSquares } from '../lib/chess';
import { LABELS } from '../lib/labels';
import { factText } from './factText';

export interface LevelsSpec {
  immediate?: Fact[];
  short?: Fact[];
  long?: Fact[];
}

export interface CandidateSpec {
  /** Engine line in SAN, first move = the candidate. */
  pv: string[];
  /** White POV. */
  score: Score;
}

export interface AssembleSpec {
  fenBefore: string;
  san: string;
  /** Deep MultiPV lines in engine order (rank 1 first). */
  lines: CandidateSpec[];
  /** Line of the played move when it is not among `lines`. */
  playedLine?: CandidateSpec;
  label?: Label;
  material?: MaterialCheck;
  miss?: boolean;
  book?: { eco: string; name: string };
  /** SAN of the explainable pick; null = none (deepOnly). Default: the best move. */
  pick?: string | null;
  explain?: { played?: LevelsSpec; pick?: LevelsSpec; best?: LevelsSpec };
  /** Candidates (by SAN) that fail the explainability test, with reason codes. */
  notExplainable?: Record<string, string[]>;
}

export function makeLevel(facts: Fact[] | undefined, mover: Color): Level {
  const fs = facts ?? [];
  const rendered = fs.map((f) => ({ text: factText(f, mover), tone: factTone(f, mover) })).filter((r) => r.text);
  const level: Level = { facts: fs, text: rendered.map((r) => r.text), tones: rendered.map((r) => r.tone) };
  // the story of a line fact, as the server splits it (fixture wording)
  const line = fs.find((f): f is Extract<Fact, { type: 'line' }> => f.type === 'line');
  if (line && level.text.length === 1) {
    const parts = level.text[0]!.replace(/.$/, '').split(' → ');
    const story: StoryPart[] = parts.map((text, i) => {
      const step = line.steps[i];
      if (!step) return { text, tone: lineTone(line) };
      const tone: Tone = step.facts.length ? (step.color === mover ? 'good' : 'bad') : 'neutral';
      return { text, tone, plies: [i, i] };
    });
    level.story = story;
  }
  return level;
}

/** Bad moves list what hurts first (as the server does). */
function badFirst(level: Level): Level {
  const order = level.text.map((t, i) => ({ t, tone: level.tones?.[i] ?? ('neutral' as Tone), i }));
  order.sort((a, b) => BAD_MOVE_TONE_ORDER[a.tone] - BAD_MOVE_TONE_ORDER[b.tone] || a.i - b.i);
  return { ...level, text: order.map((o) => o.t), tones: order.map((o) => o.tone) };
}

export function makeExplanation(spec: LevelsSpec | undefined, mover: Color): Explanation {
  return {
    immediate: makeLevel(spec?.immediate, mover),
    short: makeLevel(spec?.short, mover),
    long: makeLevel(spec?.long, mover),
  };
}

export function winChanceLabel(rank: number, winLoss: number): Label {
  const t = DEFAULT_SETTINGS.labels;
  if (rank === 1) return 'best';
  if (winLoss <= t.excellentMaxLoss) return 'excellent';
  if (winLoss <= t.goodMaxLoss) return 'good';
  if (winLoss <= t.inaccuracyMaxLoss) return 'inaccuracy';
  if (winLoss <= t.mistakeMaxLoss) return 'mistake';
  return 'blunder';
}

export function worseLabel(a: Label, b: Label): Label {
  return LABELS[b].severity > LABELS[a].severity ? b : a;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export function assembleAnalysis(spec: AssembleSpec): MoveAnalysis {
  const played = playSan(spec.fenBefore, spec.san);
  if (!played) throw new Error(`fixture: illegal move ${spec.san} in ${spec.fenBefore}`);
  const mover = played.color;
  if (spec.lines.length === 0) throw new Error('fixture: no engine lines');
  const bestWin = winPercentForColor(spec.lines[0]!.score, mover);

  const toCandidate = (c: CandidateSpec, rank: number): Candidate => {
    const { uci } = sanLineToUci(spec.fenBefore, c.pv);
    const first = playSan(spec.fenBefore, c.pv[0]!);
    if (!first || uci.length === 0) throw new Error(`fixture: illegal line ${c.pv.join(' ')} in ${spec.fenBefore}`);
    const reasons = spec.notExplainable?.[first.san];
    return {
      uci: first.uci,
      san: first.san,
      rank,
      score: c.score,
      winLoss: round1(Math.max(0, bestWin - winPercentForColor(c.score, mover))),
      pv: c.pv.slice(0, uci.length),
      pvUci: uci,
      explainable: !reasons,
      ...(reasons ? { notExplainableReasons: reasons } : {}),
    };
  };

  const candidates = spec.lines.map((l, i) => toCandidate(l, i + 1));
  const best = { ...candidates[0]! };
  let found = candidates.find((c) => c.uci === played.uci);
  if (!found) {
    if (!spec.playedLine) throw new Error(`fixture: ${spec.san} not among lines and no playedLine`);
    found = toCandidate(spec.playedLine, candidates.length + 1);
  }
  const playedCand: Candidate = { ...found, explanation: makeExplanation(spec.explain?.played, mover) };

  const legalMoves = [...legalDests(spec.fenBefore).values()].reduce((n, d) => n + d.length, 0);
  const winBefore = bestWin;
  const winAfter = winPercentForColor(playedCand.score, mover);
  const winLoss = round1(Math.max(0, winBefore - winAfter));
  const winChance = winChanceLabel(playedCand.rank, winLoss);

  let label: Label = spec.label ?? winChance;
  if (legalMoves === 1) label = 'forced';
  if (spec.material?.label) label = worseLabel(label, spec.material.label);
  if (spec.book) label = 'book';

  if ((label === 'inaccuracy' || label === 'mistake' || label === 'miss' || label === 'blunder') && playedCand.explanation) {
    playedCand.explanation = { ...playedCand.explanation, immediate: badFirst(playedCand.explanation.immediate) };
  }

  const confirmed = label === 'best' || label === 'great' || label === 'brilliant' || label === 'book' || label === 'forced';
  let pick: Candidate | null;
  const pickSan = spec.pick === undefined ? (confirmed ? played.san : best.san) : spec.pick;
  if (pickSan === null) pick = null;
  else {
    const p = candidates.find((c) => c.san === pickSan) ?? (pickSan === playedCand.san ? playedCand : undefined);
    if (!p) throw new Error(`fixture: pick ${pickSan} not among candidates`);
    pick = { ...p, explanation: p.uci === playedCand.uci ? playedCand.explanation : makeExplanation(spec.explain?.pick, mover) };
  }
  best.explanation =
    best.uci === playedCand.uci
      ? playedCand.explanation
      : pick && pick.uci === best.uci
        ? pick.explanation
        : makeExplanation(spec.explain?.best ?? spec.explain?.pick, mover);
  if (pick && pick.uci === best.uci) best.explanation = pick.explanation;

  const arrows: Arrow[] = [];
  const pushArrow = (uci: string, kind: Arrow['kind']) => {
    const sq = uciSquares(uci);
    if (sq) arrows.push({ from: sq[0], to: sq[1], kind });
  };
  pushArrow(played.uci, 'played');
  if (best.uci !== played.uci) pushArrow(best.uci, 'best');
  if (pick && pick.uci !== best.uci && pick.uci !== played.uci) pushArrow(pick.uci, 'pick');
  const threat = playedCand.explanation?.immediate.facts.find((f) => f.type === 'threat');
  if (threat && threat.type === 'threat') pushArrow(threat.move, 'threat');

  const second = candidates[1];
  return {
    version: ANALYSIS_VERSION,
    fenBefore: spec.fenBefore,
    fenAfter: played.fenAfter,
    uci: played.uci,
    san: played.san,
    color: mover,
    evalBefore: spec.lines[0]!.score,
    evalAfter: playedCand.score,
    winBefore: round1(winBefore),
    winAfter: round1(winAfter),
    winLoss,
    accuracy: round1(moveAccuracy(winBefore, winAfter)),
    label,
    labelReason: {
      winChance,
      ...(spec.material ? { material: spec.material } : {}),
      ...(label === 'miss' || spec.miss ? { miss: true } : {}),
      ...(label === 'great' && second ? { great: { secondBestLoss: second.winLoss } } : {}),
      ...(spec.book ? { book: spec.book } : {}),
    },
    played: playedCand,
    best,
    pick,
    pickIsBest: !!pick && pick.uci === best.uci,
    deepOnly: pick === null,
    candidates: candidates.map((c) => (c.uci === playedCand.uci ? playedCand : c)),
    arrows,
  };
}
