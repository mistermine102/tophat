<script setup lang="ts">
// "?" button with a popover explaining the label symbols and the eval sign convention.
import { onBeforeUnmount, ref, watch } from 'vue';
import { EVAL_POV_HINT } from '../lib/format';
import { LABEL_ORDER, LABELS } from '../lib/labels';
import LabelGlyph from './LabelGlyph.vue';

const open = ref(false);
const root = ref<HTMLElement | null>(null);

function onDoc(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false;
}
watch(open, (v) => {
  if (v) {
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
  } else {
    document.removeEventListener('mousedown', onDoc);
    document.removeEventListener('keydown', onKey);
  }
});
onBeforeUnmount(() => (open.value = false));
</script>

<template>
  <div ref="root" class="relative">
    <button
      class="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-700 text-[11px] font-bold text-neutral-200 hover:bg-neutral-600"
      title="What do the symbols mean?"
      aria-label="Label legend"
      data-testid="legend-button"
      @click="open = !open"
    >
      ?
    </button>
    <div
      v-if="open"
      class="absolute left-0 top-7 z-30 w-[340px] rounded-lg bg-neutral-900 p-3 text-left shadow-xl ring-1 ring-white/10"
      data-testid="legend"
    >
      <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Move labels</div>
      <ul class="space-y-1.5">
        <li v-for="l in LABEL_ORDER" :key="l" class="flex items-start gap-2 text-[12px] leading-snug">
          <LabelGlyph :label="l" size="sm" class="mt-px" />
          <span class="min-w-0">
            <span class="font-semibold" :style="{ color: LABELS[l].color }">{{ LABELS[l].name }}</span>
            <span class="text-neutral-300"> — {{ LABELS[l].rule }}</span>
          </span>
        </li>
      </ul>
      <p class="mt-2.5 border-t border-white/5 pt-2 text-[11px] leading-snug text-neutral-400">
        Win chance is from the point of view of the side that moved. {{ EVAL_POV_HINT }}
      </p>
    </div>
  </div>
</template>
