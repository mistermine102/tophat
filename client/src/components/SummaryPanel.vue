<script setup lang="ts">
// Per-side accuracy and label counts ("You" vs "Opponent"), plus analysis progress.
import type { Color, Label } from '@chess-coach/shared';
import { computed } from 'vue';
import { LABEL_ORDER, LABELS } from '../lib/labels';
import { useSession } from '../stores/session';
import LabelGlyph from './LabelGlyph.vue';

const session = useSession();
const summary = computed(() => session.summary.value);
const progress = computed(() => session.progress.value);
const you = computed<Color>(() => session.state.you);
const opp = computed<Color>(() => (you.value === 'white' ? 'black' : 'white'));
const name = (c: Color) => session.state.game?.headers[c === 'white' ? 'White' : 'Black'] ?? (c === 'white' ? 'White' : 'Black');
const side = (c: Color) => (c === 'white' ? summary.value?.white : summary.value?.black);
const count = (c: Color, l: Label) => side(c)?.counts[l] ?? 0;
// Two columns of five labels: good moves left, problems right.
const groups: Label[][] = [LABEL_ORDER.slice(0, 5), LABEL_ORDER.slice(5)];
const acc = (c: Color) => {
  const v = side(c)?.accuracy;
  return v === null || v === undefined ? '—' : v.toFixed(1);
};
const complete = computed(() => progress.value.total > 0 && progress.value.done >= progress.value.total);
</script>

<template>
  <section class="rounded-lg bg-neutral-800/70 p-3 ring-1 ring-white/5" data-testid="summary">
    <div class="flex items-center justify-between">
      <span class="text-xs font-semibold uppercase tracking-wide text-neutral-400">Summary</span>
      <span v-if="!complete && progress.total" class="text-[11px] text-neutral-500" data-testid="summary-progress">
        partial · {{ progress.done }}/{{ progress.total }}
      </span>
    </div>
    <div class="mt-2 grid grid-cols-2 gap-2">
      <div class="min-w-0 rounded-md bg-amber-500/[0.08] px-2 py-1.5 ring-1 ring-amber-500/20">
        <div class="flex items-baseline justify-between gap-1">
          <span class="text-[10px] font-semibold uppercase tracking-wide text-amber-300">You</span>
          <span class="text-lg font-bold leading-tight tabular-nums text-neutral-50" data-testid="acc-you">{{ acc(you) }}</span>
        </div>
        <div class="truncate text-[11px] text-neutral-400" :title="name(you)">{{ name(you) }}</div>
      </div>
      <div class="min-w-0 rounded-md bg-white/[0.04] px-2 py-1.5 ring-1 ring-white/10">
        <div class="flex items-baseline justify-between gap-1">
          <span class="text-[10px] font-semibold uppercase tracking-wide text-neutral-300">Opponent</span>
          <span class="text-lg font-bold leading-tight tabular-nums text-neutral-50" data-testid="acc-opp">{{ acc(opp) }}</span>
        </div>
        <div class="truncate text-[11px] text-neutral-400" :title="name(opp)">{{ name(opp) }}</div>
      </div>
    </div>
    <div class="mt-1 text-[10px] text-neutral-500">Accuracy %</div>
    <div class="mt-1.5 grid grid-cols-2 gap-x-3">
      <div v-for="(g, gi) in groups" :key="gi" class="grid grid-cols-[1fr_1.25rem_1.25rem] items-center gap-x-1 gap-y-[3px]">
        <span class="text-[10px] text-neutral-500"></span>
        <span class="text-center text-[10px] font-semibold text-amber-300/80" title="You">Y</span>
        <span class="text-center text-[10px] font-semibold text-neutral-400" title="Opponent">O</span>
        <template v-for="l in g" :key="l">
          <span class="flex min-w-0 items-center gap-1 text-[12px] text-neutral-300">
            <LabelGlyph :label="l" size="xs" />
            <span class="truncate">{{ LABELS[l].name }}</span>
          </span>
          <span class="text-center text-[12px] tabular-nums" :class="count(you, l) ? 'font-semibold text-neutral-100' : 'text-neutral-600'" :data-count="`you-${l}`">
            {{ count(you, l) }}
          </span>
          <span class="text-center text-[12px] tabular-nums" :class="count(opp, l) ? 'font-semibold text-neutral-100' : 'text-neutral-600'" :data-count="`opp-${l}`">
            {{ count(opp, l) }}
          </span>
        </template>
      </div>
    </div>
    <div v-if="!complete && progress.total" class="mt-2 h-1 overflow-hidden rounded bg-neutral-700">
      <div class="h-full bg-amber-500 transition-[width] duration-200" :style="{ width: `${(progress.done / progress.total) * 100}%` }"></div>
    </div>
  </section>
</template>
