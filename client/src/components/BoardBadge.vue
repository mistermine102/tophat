<script setup lang="ts">
// chess.com-style round badge at the top-right corner of a square (the destination of the move): the label glyph,
// a spinner while the move is analysed, "!" when its analysis failed, or a ✓ / ✗ / • tone marker (replays).
// An overlay over the board: absolutely positioned in the board's box, follows orientation and square size
// (ResizeObserver on the parent), never intercepts the mouse.
import type { Color, Label, Tone } from '@chess-coach/shared';
import { computed, ref } from 'vue';
import { LABELS } from '../lib/labels';
import { TONE_META } from '../lib/tones';
import { squareRect, useBoardBox } from '../lib/useBoardBox';

const props = defineProps<{
  square: string;
  orientation: Color;
  label?: Label | null;
  pending?: boolean;
  error?: boolean;
  tone?: Tone | null;
}>();

const root = ref<HTMLElement | null>(null);
const box = useBoardBox(root);

const geom = computed(() => {
  const r = squareRect(box.value, props.square, props.orientation);
  if (!r) return null;
  const s = box.value.size;
  const sq = r.size;
  const d = Math.max(18, Math.round(sq * 0.44));
  // centre near the square's top-right corner, kept inside the board
  const cx = Math.min(s - d / 2 - 1, Math.max(d / 2 + 1, r.left - box.value.x + sq - sq * 0.12));
  const cy = Math.min(s - d / 2 - 1, Math.max(d / 2 + 1, r.top - box.value.y + sq * 0.12));
  return { d, left: box.value.x + cx - d / 2, top: box.value.y + cy - d / 2 };
});

const meta = computed(() => (props.label ? LABELS[props.label] : null));
const kind = computed(() => (props.label ? 'label' : props.pending ? 'pending' : props.error ? 'error' : props.tone ? 'tone' : null));
const bg = computed(() => {
  if (kind.value === 'label') return meta.value!.color;
  if (kind.value === 'tone') return TONE_META[props.tone!].color;
  if (kind.value === 'error') return '#f43f5e';
  return '#27272a';
});
const title = computed(() => (meta.value ? `${meta.value.name} — ${meta.value.rule}` : props.pending ? 'Analysing this move…' : props.error ? 'Analysis failed' : undefined));
</script>

<template>
  <div ref="root" class="pointer-events-none absolute inset-0 z-[5]" aria-hidden="true">
    <div
      v-if="geom && kind"
      :key="`${square}-${kind}-${label ?? tone ?? ''}`"
      class="cc-badge absolute flex items-center justify-center rounded-full font-black leading-none text-neutral-950"
      :style="{ left: `${geom.left}px`, top: `${geom.top}px`, width: `${geom.d}px`, height: `${geom.d}px`, background: bg, fontSize: `${Math.round(geom.d * (meta && meta.glyph.length > 1 ? 0.46 : 0.56))}px` }"
      :title="title"
      data-testid="board-badge"
      :data-square="square"
      :data-label="label ?? undefined"
      :data-kind="kind"
      :data-tone="tone ?? undefined"
    >
      <span
        v-if="kind === 'pending'"
        class="block animate-spin rounded-full border-2 border-[var(--th-paper)] border-t-transparent"
        :style="{ width: `${geom.d * 0.55}px`, height: `${geom.d * 0.55}px` }"
      ></span>
      <svg v-else-if="label === 'book'" viewBox="0 0 16 16" class="h-[62%] w-[62%]" fill="currentColor">
        <path d="M1 4.2 7.2 2.6v10.6L1 14.6zM15 4.2 8.8 2.6v10.6l6.2 1.4z" />
      </svg>
      <span v-else-if="kind === 'label'" class="tracking-tighter">{{ meta!.glyph }}</span>
      <span v-else-if="kind === 'error'" class="text-neutral-950">!</span>
      <span v-else>{{ TONE_META[tone!].icon }}</span>
    </div>
  </div>
</template>

<style scoped>
.cc-badge {
  box-shadow:
    0 0 0 2px #fffaf0,
    0 0 0 3.5px rgba(74, 46, 31, 0.55);
  animation: cc-pop 180ms ease-out;
}
@keyframes cc-pop {
  from {
    transform: scale(0.4);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
