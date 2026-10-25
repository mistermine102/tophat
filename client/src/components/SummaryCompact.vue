<script setup lang="ts">
// Compact game summary for the prototype layouts: per side accuracy and the error counts (?! ? ✕ ??) plus great
// moves, one row each ("You" first).
import type { Color, Label } from '@chess-coach/shared';
import { computed } from 'vue';
import { LABELS } from '../lib/labels';
import { useSession } from '../stores/session';
import LabelGlyph from './LabelGlyph.vue';
import LabelLegend from './LabelLegend.vue';

const session = useSession();
const summary = computed(() => session.summary.value);
const progress = computed(() => session.progress.value);
const you = computed<Color>(() => session.state.you);
const rows = computed(() => {
  const opp: Color = you.value === 'white' ? 'black' : 'white';
  return [
    { who: 'You', color: you.value },
    { who: 'Opp', color: opp },
  ].map((r) => {
    const s = r.color === 'white' ? summary.value?.white : summary.value?.black;
    return {
      ...r,
      name: session.state.game?.headers[r.color === 'white' ? 'White' : 'Black'] ?? (r.color === 'white' ? 'White' : 'Black'),
      acc: s?.accuracy === null || s?.accuracy === undefined ? '—' : s.accuracy.toFixed(1),
      counts: SHOWN.map((l) => ({ l, n: s?.counts[l] ?? 0 })),
    };
  });
});
const SHOWN: Label[] = ['great', 'inaccuracy', 'mistake', 'miss', 'blunder'];
const complete = computed(() => progress.value.total > 0 && progress.value.done >= progress.value.total);
</script>

<template>
  <section class="rounded-lg bg-neutral-800/70 px-3 py-2 ring-1 ring-white/5" data-testid="summary">
    <div class="mb-1 flex items-center justify-between">
      <span class="flex items-center gap-2">
        <span class="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Accuracy</span>
        <LabelLegend />
      </span>
      <span v-if="!complete && progress.total" class="text-[11px] text-neutral-500" data-testid="summary-progress">partial · {{ progress.done }}/{{ progress.total }}</span>
    </div>
    <div v-for="r in rows" :key="r.who" class="flex items-center gap-2 py-0.5">
      <span class="w-8 text-[10px] font-semibold uppercase tracking-wide" :class="r.who === 'You' ? 'text-amber-300' : 'text-neutral-400'">{{ r.who }}</span>
      <span class="w-11 text-right text-base font-bold tabular-nums text-neutral-50" :data-testid="r.who === 'You' ? 'acc-you' : 'acc-opp'">{{ r.acc }}</span>
      <span class="ml-auto flex items-center gap-1.5">
        <span
          v-for="c in r.counts"
          :key="c.l"
          class="inline-flex items-center gap-0.5 text-[12px] tabular-nums"
          :class="c.n ? 'text-neutral-100' : 'text-neutral-600 opacity-50'"
          :title="`${LABELS[c.l].name}: ${c.n}`"
          :data-count="`${r.who === 'You' ? 'you' : 'opp'}-${c.l}`"
        >
          <LabelGlyph :label="c.l" size="xs" />{{ c.n }}
        </span>
      </span>
    </div>
    <div v-if="!complete && progress.total" class="mt-1 h-1 overflow-hidden rounded bg-neutral-700">
      <div class="h-full bg-amber-500 transition-[width] duration-200" :style="{ width: `${(progress.done / progress.total) * 100}%` }"></div>
    </div>
  </section>
</template>
