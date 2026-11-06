// One-sentence verdict for a move ("Blunder — allows d4, forking White's knights on c3 and e3.") and the one
// sentence for the better move, picked from the server's toned sentences (explain.ts is still the only source of
// chess prose; this only picks). (Round 10) One sentence each, nothing under it: when no sentence says something
// concrete, a short plain fallback ("Nc6 was better.") or the label alone.
import type { Candidate, MoveAnalysis, Tone } from '@chess-coach/shared';
import { CONFIRMED, LABELS } from './labels';
import { labelReasonText, type ReasonContext } from './reason';
import { levelLines, lowerFirst, type ToneLine } from './tones';

export const BAD = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);
/** The verdict stands on its own: no pointer to a level the layout may show elsewhere. */
const SEE_SHORT = / (see the short term)/;

export interface Verdict {
  /** Label name ("Blunder"). */
  name: string;
  /** The reason, starting lower-case, ending with a full stop ("allows d4, forking …."); '' = the label alone. */
  sentence: string;
  /** Tone of the verdict for the mover. */
  tone: Tone;
  /** Index of the Immediate sentence used for the verdict, or null (a fallback). */
  usedIndex: number | null;
}

const mateIn = (n: number) => (n === 1 ? 'mate in one' : `a forced mate in ${n}`);

/**
 * The verdict when no Immediate sentence fits: short and plain, no percentages or point counts ("Nc6 was better.",
 * "almost as good as Bd6."); '' when the label says it all (a Best move with nothing to tell).
 */
export function plainReason(a: MoveAnalysis, ctx: ReasonContext): string {
  const r = a.labelReason;
  const best = a.best.uci !== a.uci ? a.best.san : null;
  if (r.allowedMate && a.label === 'blunder') return `allows ${mateIn(r.allowedMate.matedIn)}.`;
  if (r.missedMate && (a.label === 'miss' || a.label === 'blunder')) return `misses ${mateIn(r.missedMate.mateIn)} with ${a.best.san}.`;
  // (as labelReasonText: the piece is named only when losing it is the whole story)
  const m = r.material;
  const hung = m?.hung && m.hung.color === a.color && a.label === m.label && (m.hungLoss ?? m.loss) >= m.loss ? m.hung : null;
  switch (a.label) {
    case 'book':
    case 'forced':
      return lowerFirst(labelReasonText(a, ctx));
    case 'best':
      return /#$/.test(a.san) ? 'checkmate!' : '';
    case 'great':
      return 'the only good move here.';
    case 'brilliant':
      return r.brilliant ? `a sound sacrifice of the ${r.brilliant.piece.role}.` : 'a sound sacrifice.';
    case 'excellent':
      return best ? `almost as good as ${best}.` : '';
    case 'good':
      return best ? `${best} was a bit better.` : '';
    case 'inaccuracy':
      return best ? `${best} was better.` : '';
    case 'miss':
      if (r.missedMaterial && best) return r.missedMaterial.free ? `misses ${best}, which wins the ${r.missedMaterial.piece.role} for free.` : `misses ${best}, which wins material.`;
      return best ? `${best} would have punished ${ctx.prevMove ?? 'the last move'}.` : '';
    case 'mistake':
    case 'blunder':
      if (hung) return `leaves the ${hung.role} on ${hung.square} hanging.`;
      return best ? `${best} was much better.` : '';
  }
  return '';
}

export function moveVerdict(a: MoveAnalysis, ctx: ReasonContext): Verdict {
  const meta = LABELS[a.label];
  const imm = levelLines(a.played.explanation?.immediate);
  const bad = BAD.has(a.label);
  const tone: Tone = bad ? 'bad' : a.label === 'good' ? 'neutral' : 'good';
  if (a.label === 'book' || a.label === 'forced') return { name: meta.name, sentence: plainReason(a, ctx), tone: 'neutral', usedIndex: null };
  const want: Tone = bad ? 'bad' : 'good';
  const i = imm.findIndex((l) => l.tone === want);
  if (i >= 0) return { name: meta.name, sentence: lowerFirst(imm[i]!.text.replace(SEE_SHORT, '')), tone, usedIndex: i };
  return { name: meta.name, sentence: plainReason(a, ctx), tone, usedIndex: null };
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

/** "Nothing special happens right away (as with c5)." says nothing about the candidate. */
const FILLER = /^Nothing special happens/;

/** The better move's one sentence: its first good Immediate sentence, else its first neutral one; null = none. */
export function candidateSentence(c: Candidate): ToneLine | null {
  const imm = levelLines(c.explanation?.immediate).filter((l) => !FILLER.test(l.text));
  return imm.find((l) => l.tone === 'good') ?? imm.find((l) => l.tone === 'neutral') ?? null;
}
