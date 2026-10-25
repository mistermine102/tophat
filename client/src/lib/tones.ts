// Explanation sentences with their tone for the mover (server: Level.tones / Level.story, explain.ts). Older cached
// analyses without tones read as neutral.
import type { Fact, Level, StoryPart, Tone } from '@chess-coach/shared';

export interface ToneLine {
  text: string;
  tone: Tone;
}

export const TONE_META: Record<Tone, { icon: string; color: string; soft: string; word: string }> = {
  good: { icon: '✓', color: '#4ade80', soft: 'rgba(74, 222, 128, 0.10)', word: 'helps' },
  bad: { icon: '✗', color: '#f87171', soft: 'rgba(248, 113, 113, 0.10)', word: 'hurts' },
  neutral: { icon: '•', color: '#a3a3a3', soft: 'rgba(163, 163, 163, 0.08)', word: '' },
};

/** A level that only says "nothing notable" (shown muted / left out). */
export function isEmptyLevel(level: Level | null | undefined): boolean {
  if (!level) return true;
  const text = level.text.filter((t) => t.trim());
  return text.length === 0 || (level.facts.length === 1 && level.facts[0]!.type === 'nothing-notable');
}

/** The sentences of a level with their tones (empty for a "nothing notable" level). */
export function levelLines(level: Level | null | undefined): ToneLine[] {
  if (!level || isEmptyLevel(level)) return [];
  return level.text
    .map((text, i) => ({ text, tone: level.tones?.[i] ?? ('neutral' as Tone) }))
    .filter((l) => l.text.trim().length > 0);
}

/** The line fact of a Short-term level, if any. */
export function lineFact(level: Level | null | undefined): Extract<Fact, { type: 'line' }> | null {
  return (level?.facts.find((f) => f.type === 'line') as Extract<Fact, { type: 'line' }> | undefined) ?? null;
}

/**
 * The Short-term story as parts (server `Level.story`). Fallback for analyses without it: the sentence split at its
 * arrows, every part neutral except the last (the result), which gets the level's tone.
 */
export function storyParts(level: Level | null | undefined): StoryPart[] {
  if (!level || isEmptyLevel(level)) return [];
  if (level.story?.length) return level.story;
  const text = level.text[0]?.replace(/\.$/, '') ?? '';
  if (!text.includes(' → ')) return [];
  const parts = text.split(' → ');
  const tone = level.tones?.[0] ?? 'neutral';
  return parts.map((t, i) => ({ text: t, tone: i === parts.length - 1 ? tone : 'neutral' }));
}

/** The story's result part (its last part when it doesn't narrate a move). */
export function storyResult(parts: readonly StoryPart[]): StoryPart | null {
  const last = parts[parts.length - 1];
  return last && !last.plies && last.text !== '…' ? last : null;
}

const strip = (s: string) => s.replace(/\.$/, '');
/** "Allows d4, forking …" → "allows d4, forking …" (not for sentences that start with a side's name). */
export function lowerFirst(s: string): string {
  return /^(White|Black)\b/.test(s) || /^([KQRBN][a-h]?[1-8]?x?[a-h][1-8]|O-O)/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1);
}
export { strip as stripPeriod };
