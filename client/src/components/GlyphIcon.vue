<script setup lang="ts">
// The symbol inside a round label badge (LabelGlyph, BoardBadge) as SVG on a 16×16 grid, each symbol's bounding box
// (stroke included) centred on (8, 8): font glyphs (✕ ★ ✓ ? …) sit off-centre in a circle because every font sizes
// and baselines them differently, so they are drawn instead. Also the board badge's tone markers (✓ / ✕ / •) and its
// "!" for a failed analysis. Fills its box; colour = currentColor.
import type { Label, Tone } from '@chess-coach/shared';
import { computed } from 'vue';
import { LABELS } from '../lib/labels';

type GlyphName = Label | Tone | 'error';
const props = defineProps<{ name: GlyphName }>();

type Part = { d: string; fill?: boolean; w?: number; dx?: number; sx?: number; color?: string } | { dot: [number, number]; r: number; dx?: number };

/** Best's star. */
const GOLD = '#ffd23f';

const CHECK: Part[] = [{ d: 'M3.4 8.6 6.7 11.6 12.6 4.6', w: 2.4 }];
const CROSS: Part[] = [{ d: 'M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2', w: 2.5 }];
const BANG: Part[] = [{ d: 'M8 2.9v6.6', w: 2.6 }, { dot: [8, 13.1], r: 1.5 }];
// "?": its arc centred on x = 8; top of the stroke at y ≈ 1.5, bottom of the dot at y ≈ 14.5
const Q = 'M5 5.65a3 3 0 1 1 4.6 2.5C8.6 8.75 8 9.35 8 10.25';
const question = (dx = 0, sx = 1, r = 1.3): Part[] => [{ d: Q, dx, sx }, { dot: [8, 13.25], r, dx }];

// (Partial: a label without a shape here falls back to its text glyph, centred as well as a font allows)
const SHAPES: Partial<Record<GlyphName, Part[]>> = {
  // five-pointed star around (8, 8.6): its bounding box (taller above the centre) spans y 2.2–13.8
  // (gold, so the top move stands out from Excellent's check in the same green)
  best: [{ d: 'M8 2.2 9.53 6.5 14.09 6.62 10.47 9.4 11.76 13.78 8 11.2 4.24 13.78 5.53 9.4 1.91 6.62 6.47 6.5z', fill: true, color: GOLD }],
  // !! : two slightly thinner bangs, the pair spanning x ≈ 4–12
  brilliant: [{ d: 'M5.2 2.9v6.6', w: 2.3 }, { dot: [5.2, 13.1], r: 1.35 }, { d: 'M10.8 2.9v6.6', w: 2.3 }, { dot: [10.8, 13.1], r: 1.35 }],
  great: BANG,
  error: BANG,
  excellent: CHECK,
  good: CHECK,
  // ?! : the pair spans x ≈ 2.1–14
  inaccuracy: [...question(-1.8, 1, 1.25), { d: 'M12.8 2.9v7.1', w: 2.3 }, { dot: [12.8, 13.25], r: 1.25 }],
  mistake: question(),
  // ?? : two narrower question marks
  blunder: [...question(-3.1, 0.85, 1.2), ...question(3.1, 0.85, 1.2)],
  miss: CROSS,
  bad: CROSS,
  neutral: [{ dot: [8, 8], r: 2.6 }],
  forced: [{ d: 'M4.3 4.3h7.4v7.4H4.3z', w: 1.9 }],
  // open book: two pages around a spine
  book: [{ d: 'M1 3.6 7.2 2v10.6L1 14zM15 3.6 8.8 2v10.6l6.2 1.4z', fill: true }],
};
const parts = computed(() => SHAPES[props.name] ?? null);
const fallback = computed(() => (props.name in LABELS ? LABELS[props.name as Label].glyph : '•'));

/** A part's transform: shift by dx, and squeeze it horizontally around its own centre (x = 8) by sx. */
const tf = (p: Part) => {
  const sx = 'sx' in p ? (p.sx ?? 1) : 1;
  const dx = p.dx ?? 0;
  return dx || sx !== 1 ? `translate(${8 + dx} 0) scale(${sx} 1) translate(-8 0)` : undefined;
};
</script>

<template>
  <svg viewBox="0 0 16 16" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" :data-glyph="name">
    <text v-if="!parts" x="8" y="8" text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="900" fill="currentColor">{{ fallback }}</text>
    <g v-else>
      <template v-for="(p, i) in parts" :key="i">
        <circle v-if="'dot' in p" :cx="p.dot[0]" :cy="p.dot[1]" :r="p.r" fill="currentColor" :transform="tf(p)" />
        <path v-else :d="p.d" :fill="p.fill ? (p.color ?? 'currentColor') : 'none'" :stroke="p.fill ? 'none' : 'currentColor'" :stroke-width="p.w ?? 2.2" :transform="tf(p)" />
      </template>
    </g>
  </svg>
</template>
