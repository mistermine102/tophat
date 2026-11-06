<script setup lang="ts">
// Start position: the game (players, event, opening), how to use the screen, and the key moments (great moves and
// errors, click to jump). Used by every layout.
import { computed } from 'vue';
import { moveNumberLabel } from '../lib/chess';
import { ENDING_TEXT, gameEnding } from '../lib/ending';
import { LABELS } from '../lib/labels';
import { useSession } from '../stores/session';
import LabelGlyph from './LabelGlyph.vue';

const session = useSession();
const game = computed(() => session.state.game);
const header = computed(() => {
  const g = game.value;
  if (!g) return null;
  const h = g.headers;
  return {
    white: h.White ?? 'White',
    black: h.Black ?? 'Black',
    result: h.Result ?? '*',
    ending: (() => {
      const e = gameEnding(g);
      return e ? ENDING_TEXT[e] : null;
    })(),
    date: h.Date?.replace(/\./g, '-') ?? '',
    event: [h.Event, h.TimeControl ? `${Math.round(Number(h.TimeControl) / 60) || h.TimeControl} min` : null].filter(Boolean).join(' · '),
  };
});
const keyMoments = computed(() =>
  (game.value?.moves ?? [])
    .map((m) => ({ m, a: session.state.analyses[m.ply] }))
    .filter((e) => e.a && (LABELS[e.a.label].severity >= 3 || e.a.label === 'great' || e.a.label === 'brilliant'))
    .map((e) => ({
      ply: e.m.ply,
      label: e.a!.label,
      move: `${moveNumberLabel(e.m.fenBefore)} ${e.m.san}`,
      color: e.m.color,
    })),
);
const opening = computed(() => {
  let name: string | null = null;
  for (let p = 1; p <= (game.value?.moves.length ?? 0); p++) {
    const b = session.state.analyses[p]?.labelReason.book;
    if (!b) break;
    name = `${b.name} (${b.eco})`;
  }
  return name;
});
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="game-overview">
      <section class="th-panel p-4">
        <div class="th-display text-[15px] font-semibold italic text-neutral-400">Game</div>
        <div v-if="header" class="th-display mt-1 text-xl font-bold text-neutral-50">
          {{ header.white }} <span class="text-neutral-500">vs</span> {{ header.black }}
          <span class="ml-1 text-base font-medium text-neutral-400">{{ header.result }}<template v-if="header.ending"> · {{ header.ending }}</template></span>
        </div>
        <div v-if="header" class="mt-0.5 text-sm text-neutral-400">{{ [header.event, header.date].filter(Boolean).join(' · ') }}</div>
        <div v-if="opening" class="mt-2 text-sm text-neutral-300">Opening: {{ opening }}</div>
        <p class="mt-3 text-sm text-neutral-400">
          Step through the game with <kbd class="kbd">→</kbd> or the buttons below the board, or press
          <b class="font-semibold text-neutral-300">Next mistake</b> (<kbd class="kbd">N</kbd>) to jump from error to error. Drag a piece to try
          your own move — it’s analysed too.
        </p>
      </section>
      <section class="th-panel p-4" data-testid="key-moments">
        <div class="mb-2 flex items-baseline justify-between">
          <span class="th-display text-[15px] font-semibold italic text-neutral-400">Key moments</span>
          <span class="text-[11px] text-neutral-500">Great moves and errors · click to jump</span>
        </div>
        <p v-if="!keyMoments.length" class="text-sm italic text-neutral-500">
          {{ session.progress.value.done < session.progress.value.total ? 'Appear as the analysis comes in…' : 'No errors in this game.' }}
        </p>
        <div class="grid grid-cols-1 gap-x-3 gap-y-0.5 min-[1700px]:grid-cols-2">
          <button
            v-for="k in keyMoments"
            :key="k.ply"
            class="flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-white/5"
            @click="session.goToMainPly(k.ply)"
          >
            <LabelGlyph :label="k.label" size="sm" />
            <span class="w-20 shrink-0 font-medium text-neutral-100">{{ k.move }}</span>
            <span class="min-w-0 flex-1 truncate" :style="{ color: LABELS[k.label].color }">{{ LABELS[k.label].name }}</span>
            <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="k.color === 'white' ? 'th-side-white' : 'th-side-black'" :title="k.color === 'white' ? 'White' : 'Black'"></span>
          </button>
        </div>
      </section>
  </div>
</template>

<style scoped>
@reference "../style.css";
.kbd {
  @apply rounded-md border border-neutral-600 bg-neutral-700 px-1 text-xs text-neutral-200;
}
</style>
