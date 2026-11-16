<script setup lang="ts">
// The viewed move's verdict card (layout A and the phone layouts): the move, who played it and the eval change, the
// label with its one sentence, the move's pros and cons (✓ / ✗, lib/verdict.ts verdictPoints), and the pending /
// quick / failed states. Only the played move is explained; the engine's other moves are just listed (TopIdeas).
// `compact` (phones): smaller type and padding, and no separate header line: the move name and a side-line badge sit
// next to the label; the mover is in the players row and the eval in the eval bar.
import { computed } from 'vue';
import { useMove } from '../lib/useMove';
import { sentenceWithPoints, verdictPoints } from '../lib/verdict';
import { useSession } from '../stores/session';
import LabelGlyph from './LabelGlyph.vue';
import ToneList from './ToneList.vue';

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });
const session = useSession();
const m = useMove(session);
const node = m.node;
const game = computed(() => session.state.game);
/** The player who made the viewed move, by name (falls back to White / Black). */
const mover = computed(() => {
  const c = node.value?.color;
  if (!c) return null;
  return { color: c, name: game.value?.headers[c === 'white' ? 'White' : 'Black'] || (c === 'white' ? 'White' : 'Black') };
});
const accent = computed(() => m.meta.value?.color ?? '#737373');
// (Points) the move's pros and cons under the verdict; the sentence stays where the points don't already say it
const points = computed(() => verdictPoints(m.a.value));
const sentence = computed(() => (m.a.value && m.verdict.value ? sentenceWithPoints(m.a.value, m.verdict.value, points.value) : ''));
</script>

<template>
  <div v-if="node" class="th-panel" :class="compact ? 'px-3 py-2' : 'p-4'" :style="{ '--accent': accent }" data-testid="verdict-bubble">
    <div v-if="!compact" class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-neutral-400">
      <span class="text-[14px] font-bold text-neutral-100">{{ m.moveName.value }}</span>
      <span v-if="mover" class="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-neutral-300" data-testid="mover">
        <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="mover.color === 'white' ? 'th-side-white' : 'th-side-black'"></span>
        <span class="truncate">{{ mover.name }}</span>
      </span>
      <span v-if="node.mainPly === null" class="th-badge th-badge-info">Side line</span>
      <span v-if="m.evalChange.value" class="ml-auto tabular-nums" title="Engine evaluation from White's side (+ = White better)" data-testid="eval-change">
        eval {{ m.evalChange.value.before }} → <b class="text-neutral-200">{{ m.evalChange.value.after }}</b>
      </span>
    </div>

    <!-- verdict -->
    <div v-if="m.a.value && m.verdict.value" class="flex items-start" :class="compact ? 'gap-2' : 'mt-2 gap-2.5'" data-testid="verdict" :data-tone="m.verdict.value.tone">
      <LabelGlyph :label="m.a.value.label" :size="compact ? 'sm' : 'lg'" :class="compact ? 'mt-[3px]' : ''" />
      <p class="min-w-0 leading-snug text-neutral-50" :class="compact ? 'text-[14px]' : 'pt-0.5 text-[16px]'">
        <b class="th-display font-bold" :class="compact ? 'text-[16px]' : 'text-[21px]'" :style="{ color: accent }" data-testid="label-name">{{ m.verdict.value.name }}</b>
        <template v-if="compact">
          <span class="ml-1.5 text-[13px] font-semibold text-neutral-400" data-testid="move-name">{{ m.moveName.value }}</span>
          <span v-if="node.mainPly === null" class="ml-1.5 text-[12px] text-sky-700">· Side line</span>
        </template>
        <template v-if="sentence"><span class="text-neutral-500"> — </span>{{ sentence }}</template>
      </p>
    </div>
    <!-- (Points) pros and cons of the played move -->
    <ToneList
      v-if="m.a.value && points"
      :lines="points.lines"
      :class="compact ? 'mt-1 pl-6 text-[14px]' : 'mt-2 pl-[42px]'"
      data-testid="verdict-points"
    />
    <!-- no full analysis yet: its failure, the quick label's "working out why", or the spinner -->
    <div v-if="m.error.value && (!m.a.value || m.a.value.provisional)" class="mt-2 text-sm text-rose-300" data-testid="ply-error">
      <p>The analysis of this move failed: {{ m.error.value }}</p>
      <button class="th-btn th-btn-sm mt-1.5" data-testid="retry" @click="m.retry()">Try again</button>
    </div>
    <!-- (D1) a quick label: the full analysis (and the why) is on its way -->
    <p v-else-if="m.a.value?.provisional" class="mt-2 flex items-center gap-2 text-[13px] text-neutral-400" data-testid="provisional">
      <span class="h-3 w-3 animate-spin rounded-full border-2 border-neutral-500 border-t-transparent"></span>
      Working out why…
    </p>
    <p v-else-if="!m.a.value" class="flex items-center gap-2 text-neutral-300" :class="compact ? 'text-[14px]' : 'mt-2 text-[15px]'">
      <span class="h-4 w-4 animate-spin rounded-full border-2 border-neutral-500 border-t-transparent"></span>
      Analysing {{ m.moveName.value }}…
    </p>
  </div>
</template>
