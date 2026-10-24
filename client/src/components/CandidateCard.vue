<script setup lang="ts">
// "Try this:" / "Engine's top:" card: the move, its rank/score, explanation, and its engine line. Hovering a line
// move previews it on the board; clicking enters it as a side line.
import type { Candidate, MoveAnalysis } from '@chess-coach/shared';
import { computed } from 'vue';
import { moveNumberLabel } from '../lib/chess';
import { formatScore } from '../lib/format';
import type { TreeNode } from '../lib/moveTree';
import { pvSteps } from '../lib/pv';
import { useSession } from '../stores/session';
import LevelList from './LevelList.vue';

const props = defineProps<{
  kind: 'pick' | 'best';
  title: string;
  candidate: Candidate;
  analysis: MoveAnalysis;
  /** Node whose position the candidate is played from (parent of the analysed move). */
  from: TreeNode | null;
  notice?: string | null;
}>();

const session = useSession();
const steps = computed(() => pvSteps(props.analysis.fenBefore, props.candidate.pvUci));
const accent = computed(() =>
  props.kind === 'pick'
    ? { ring: 'ring-emerald-500/40', bg: 'bg-emerald-500/[0.07]', text: 'text-emerald-400', dot: 'bg-emerald-500' }
    : { ring: 'ring-blue-500/40', bg: 'bg-blue-500/[0.07]', text: 'text-blue-400', dot: 'bg-blue-500' },
);
const ex = computed(() => props.candidate.explanation);

function preview(i: number) {
  const s = steps.value[i];
  if (!s) return;
  const line = steps.value
    .slice(0, i + 1)
    .map((x) => (x.number ? `${x.number} ${x.san}` : x.san))
    .join(' ');
  session.setPreview({ fen: s.fenAfter, uci: s.uci, caption: `Preview: ${line}` });
}

function enter(i: number) {
  if (!props.from) return;
  session.setPreview(null);
  session.playLine(props.from, props.candidate.pvUci, i + 1);
}
</script>

<template>
  <section class="rounded-lg p-3 ring-1" :class="[accent.ring, accent.bg]" :data-testid="`candidate-${kind}`">
    <header class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span class="text-xs font-semibold uppercase tracking-wide" :class="accent.text">{{ title }}</span>
      <button
        class="rounded px-1 text-base font-bold text-neutral-50 hover:bg-white/10"
        :title="`Play ${candidate.san} on the board`"
        @mouseenter="preview(0)"
        @mouseleave="session.setPreview(null)"
        @click="enter(0)"
      >
        {{ moveNumberLabel(analysis.fenBefore) }} {{ candidate.san }}
      </button>
      <span class="text-xs text-neutral-400">
        engine #{{ candidate.rank }} · {{ formatScore(candidate.score) }}<template v-if="candidate.winLoss > 0.05">
          · −{{ candidate.winLoss.toFixed(1) }}% vs best</template>
      </span>
    </header>
    <p v-if="notice" class="mt-1.5 rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-300" data-testid="deep-only">
      {{ notice }}
    </p>
    <div v-if="ex" class="mt-2 space-y-1.5">
      <LevelList title="Immediate" :level="ex.immediate" compact />
      <LevelList title="Short term" :level="ex.short" compact />
      <LevelList v-if="ex.long.text.length" title="Long term" :level="ex.long" compact />
    </div>
    <div v-if="steps.length > 1" class="mt-2 flex flex-wrap items-center gap-x-0.5 gap-y-1 text-[13px]" data-testid="pv">
      <span class="mr-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Line</span>
      <button
        v-for="(s, i) in steps"
        :key="i"
        class="rounded px-1 py-px text-neutral-300 hover:bg-white/10 hover:text-white"
        :title="'Click to play this line on the board'"
        @mouseenter="preview(i)"
        @mouseleave="session.setPreview(null)"
        @click="enter(i)"
      >
        <span v-if="s.number" class="text-neutral-500">{{ s.number }}</span>{{ s.san }}
      </button>
    </div>
  </section>
</template>
