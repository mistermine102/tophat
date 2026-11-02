<script setup lang="ts">
// Small word tags ("hanging", "forked" …) at the bottom of board squares, green / red for the mover (layout A's
// consequence marks). An overlay like BoardBadge: positioned in the board's box, never intercepts the mouse.
import type { Color } from '@chess-coach/shared';
import { computed, ref } from 'vue';
import type { SquareMark } from '../lib/consequences';
import { squareRect, useBoardBox } from '../lib/useBoardBox';

const props = defineProps<{ marks: readonly SquareMark[]; orientation: Color }>();
const root = ref<HTMLElement | null>(null);
const box = useBoardBox(root);

const tags = computed(() =>
  props.marks.flatMap((m) => {
    const r = squareRect(box.value, m.square, props.orientation);
    if (!r) return [];
    const font = Math.max(9, Math.min(13, Math.round(r.size * 0.15)));
    const max = r.size * 1.9;
    // a long tag on an edge square ("missed mate in 9" on h1) is nudged inwards instead of sticking out of the board
    const half = Math.min(max, m.tag.length * font * 0.62 + 10) / 2;
    const left = Math.min(Math.max(r.left + r.size / 2, half), r.size * 8 - half);
    return [{ ...m, left, top: r.top + r.size - 2, font, max }];
  }),
);
</script>

<template>
  <div ref="root" class="pointer-events-none absolute inset-0 z-[4]" aria-hidden="true">
    <span
      v-for="t in tags"
      :key="`${t.square}-${t.tag}`"
      class="cc-tag absolute -translate-x-1/2 -translate-y-full truncate rounded-md px-1.5 py-px font-bold leading-tight text-[#fff]"
      :class="t.tone === 'good' ? 'bg-[var(--th-good)]' : 'bg-[var(--th-bad)]'"
      :style="{ left: `${t.left}px`, top: `${t.top}px`, fontSize: `${t.font}px`, maxWidth: `${t.max}px` }"
      data-testid="board-tag"
      :data-square="t.square"
      :data-tone="t.tone"
      >{{ t.tag }}</span
    >
  </div>
</template>

<style scoped>
.cc-tag {
  box-shadow: 0 0 0 1.5px rgba(255, 250, 240, 0.9);
  animation: cc-tag-in 200ms ease-out;
}
@keyframes cc-tag-in {
  from {
    opacity: 0;
  }
}
</style>
