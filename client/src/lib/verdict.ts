// One-sentence verdict for a move ("Blunder — allows d4, forking White's knights on c3 and e3.") and the few key
// points under it, built from the server's toned sentences (explain.ts is still the only source of chess prose;
// this only picks and joins sentences). Shared by the prototype layouts.
import type { Candidate, MoveAnalysis, Tone } from '@chess-coach/shared';
import { CONFIRMED, LABELS } from './labels';
import { labelReasonText, type ReasonContext } from './reason';
import { levelLines, lowerFirst, storyParts, storyResult, type ToneLine } from './tones';

export const BAD = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);

export interface Verdict {
  /** Label name ("Blunder"). */
  name: string;
  /** The reason, starting lower-case, ending with a full stop ("allows d4, forking …."). */
  sentence: string;
  /** Tone of the verdict for the mover. */
  tone: Tone;
  /** Index of the Immediate sentence used for the verdict (left out of the key points), or null. */
  usedIndex: number | null;
}

export function moveVerdict(a: MoveAnalysis, ctx: ReasonContext): Verdict {
  const meta = LABELS[a.label];
  const imm = levelLines(a.played.explanation?.immediate);
  const bad = BAD.has(a.label);
  const tone: Tone = bad ? 'bad' : a.label === 'good' ? 'neutral' : 'good';
  const reason = () => labelReasonText(a, ctx);
  if (a.label === 'book' || a.label === 'forced') return { name: meta.name, sentence: lowerFirst(reason()), tone: 'neutral', usedIndex: null };
  const want: Tone = bad ? 'bad' : 'good';
  const i = imm.findIndex((l) => l.tone === want);
  if (i >= 0) return { name: meta.name, sentence: lowerFirst(imm[i]!.text), tone, usedIndex: i };
  return { name: meta.name, sentence: lowerFirst(reason()), tone, usedIndex: null };
}

/**
 * The points under the verdict: the other Immediate sentences (a bad move's bad ones first — the server orders them)
 * and the short line's result when it helps or hurts. At most `max`.
 */
export function keyPoints(a: MoveAnalysis, v: Verdict, max = 3): ToneLine[] {
  const ex = a.played.explanation;
  const imm = levelLines(ex?.immediate).filter((_, i) => i !== v.usedIndex);
  const result = storyResult(storyParts(ex?.short));
  const out: ToneLine[] = [];
  const room = result && result.tone !== 'neutral' ? max - 1 : max;
  // skip neutral filler when there are toned sentences
  const toned = imm.filter((l) => l.tone !== 'neutral');
  out.push(...(toned.length ? toned : imm).slice(0, room));
  if (result && result.tone !== 'neutral') out.push({ text: `In the engine line: ${lowerFirst(result.text)}.`, tone: result.tone });
  return out;
}

export interface Suggestions {
  pick: Candidate | null;
  best: Candidate | null;
  deepOnly: boolean;
}

/** What to suggest instead of the played move (same rules as the classic panel's "Try this" / "Engine's top"). */
export function suggestionsFor(x: MoveAnalysis | null): Suggestions {
  if (!x) return { pick: null, best: null, deepOnly: false };
  const playedIsBest = x.best.uci === x.uci;
  if (x.label === 'book' || x.label === 'forced') return { pick: null, best: null, deepOnly: false };
  if (CONFIRMED.has(x.label)) return { pick: null, best: playedIsBest ? null : x.best, deepOnly: false };
  if (x.deepOnly || !x.pick) return { pick: null, best: playedIsBest ? null : x.best, deepOnly: !playedIsBest };
  const pick = x.pick.uci === x.uci ? null : x.pick;
  return { pick, best: (pick && x.pickIsBest) || playedIsBest ? null : x.best, deepOnly: false };
}

/** The one move to show as "Better" (the explainable pick, else the engine's top) — only for moves that weren't best. */
export function betterMove(x: MoveAnalysis | null): { candidate: Candidate; kind: 'pick' | 'best'; deepOnly: boolean } | null {
  if (!x || CONFIRMED.has(x.label)) return null;
  const s = suggestionsFor(x);
  if (s.pick) return { candidate: s.pick, kind: 'pick', deepOnly: false };
  if (s.best) return { candidate: s.best, kind: 'best', deepOnly: s.deepOnly };
  return null;
}

/** A candidate's own points: its good Immediate sentences, then its line's result when it helps. */
export function candidatePoints(c: Candidate, max = 3): ToneLine[] {
  const ex = c.explanation;
  const imm = levelLines(ex?.immediate);
  const result = storyResult(storyParts(ex?.short));
  const good = imm.filter((l) => l.tone === 'good');
  const out: ToneLine[] = (good.length ? good : imm.filter((l) => l.tone !== 'bad')).slice(0, result?.tone === 'good' ? max - 1 : max);
  if (result?.tone === 'good') out.push({ text: `In the engine line: ${lowerFirst(result.text)}.`, tone: 'good' });
  return out;
}
