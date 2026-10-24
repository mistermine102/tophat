<script setup lang="ts">
// Explanation for the move that led to the current position: label + reason, eval change, three levels,
// "Try this" / "Engine's top".
import { computed } from 'vue';
import { isCheckmate, moveNumberLabel, sideToMove } from '../lib/chess';
import { formatPercent, formatPositionEval } from '../lib/format';
import { CONFIRMED, LABELS } from '../lib/labels';
import { isMaterialLabel, labelReasonText } from '../lib/reason';
import { useSession } from '../stores/session';
import CandidateCard from './CandidateCard.vue';
import LabelGlyph from './LabelGlyph.vue';
import LevelList from './LevelList.vue';

const session = useSession();
const node = computed(() => session.current.value);
const a = computed(() => session.currentAnalysis.value);
const pending = computed(() => session.isPending(node.value));
const error = computed(() => session.errorFor(node.value));
const game = computed(() => session.state.game);

const moverIsYou = computed(() => !!a.value && a.value.color === session.state.you);
const prevMove = computed(() => {
  const p = node.value?.parent;
  return p && p.ply > 0 && p.fenBefore ? `${moveNumberLabel(p.fenBefore)} ${p.san}` : null;
});
const reason = computed(() => (a.value ? labelReasonText(a.value, { moverIsYou: moverIsYou.value, prevMove: prevMove.value }) : ''));
const meta = computed(() => (a.value ? LABELS[a.value.label] : null));
const mated = computed(() => (a.value && isCheckmate(a.value.fenAfter) ? sideToMove(a.value.fenAfter) : null));
const confirmed = computed(() => !!a.value && CONFIRMED.has(a.value.label));
const ex = computed(() => a.value?.played.explanation);

/** What to show under "Try this" / "Engine's top". */
const suggestions = computed(() => {
  const x = a.value;
  if (!x) return { pick: null, best: null, deepOnly: false };
  const playedIsBest = x.best.uci === x.uci;
  if (confirmed.value) return { pick: null, best: playedIsBest ? null : x.best, deepOnly: false };
  if (x.deepOnly || !x.pick) return { pick: null, best: playedIsBest ? null : x.best, deepOnly: !playedIsBest };
  // Never suggest the move that was actually played.
  const pick = x.pick.uci === x.uci ? null : x.pick;
  return { pick, best: (pick && x.pickIsBest) || playedIsBest ? null : x.best, deepOnly: false };
});

const header = computed(() => {
  const g = game.value;
  if (!g) return null;
  const h = g.headers;
  return {
    white: h.White ?? 'White',
    black: h.Black ?? 'Black',
    result: h.Result ?? '*',
    date: h.Date?.replace(/\./g, '-') ?? '',
    event: [h.Event, h.TimeControl ? `${Math.round(Number(h.TimeControl) / 60) || h.TimeControl} min` : null].filter(Boolean).join(' · '),
  };
});
const keyMoments = computed(() =>
  (game.value?.moves ?? [])
    .map((m) => ({ m, a: session.state.analyses[m.ply] }))
    .filter((e) => e.a && (LABELS[e.a.label].severity >= 3 || e.a.label === 'great'))
    .map((e) => ({
      ply: e.m.ply,
      label: e.a!.label,
      move: `${moveNumberLabel(e.m.fenBefore)} ${e.m.san}`,
      you: e.m.color === session.state.you,
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
  <div class="flex min-h-0 flex-col gap-3" data-testid="explanation">
    <!-- Start position: game overview -->
    <template v-if="node && node.ply === 0">
      <section class="rounded-lg bg-neutral-800/70 p-4 ring-1 ring-white/5">
        <div class="text-xs font-semibold uppercase tracking-wide text-neutral-400">Game</div>
        <div v-if="header" class="mt-1 text-lg font-semibold text-neutral-50">
          {{ header.white }} <span class="text-neutral-500">vs</span> {{ header.black }}
          <span class="ml-1 text-base font-medium text-neutral-400">{{ header.result }}</span>
        </div>
        <div v-if="header" class="mt-0.5 text-sm text-neutral-400">{{ [header.event, header.date].filter(Boolean).join(' · ') }}</div>
        <div v-if="opening" class="mt-2 text-sm text-neutral-300">Opening: {{ opening }}</div>
        <p class="mt-3 text-sm text-neutral-400">
          Step through the game with <kbd class="kbd">→</kbd> or the buttons below the board. Drag a piece to try your own
          move — it’s analysed as a side line.
        </p>
      </section>
      <section class="rounded-lg bg-neutral-800/40 p-4 ring-1 ring-white/5" data-testid="key-moments">
        <div class="mb-2 flex items-baseline justify-between">
          <span class="text-xs font-semibold uppercase tracking-wide text-neutral-400">Key moments</span>
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
            <span class="text-[10px] font-semibold uppercase tracking-wide" :class="k.you ? 'text-amber-300' : 'text-neutral-500'">
              {{ k.you ? 'You' : 'Opp' }}
            </span>
          </button>
        </div>
      </section>
    </template>

    <template v-else-if="node">
      <section class="rounded-lg bg-neutral-800/70 p-3.5 ring-1 ring-white/5" data-testid="label-card">
        <div class="flex items-start gap-3">
          <LabelGlyph v-if="a" :label="a.label" size="lg" />
          <span v-else class="mt-0.5 inline-block h-8 w-8 shrink-0 rounded-full bg-neutral-700"></span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-baseline gap-x-2">
              <span class="text-lg font-bold" :style="{ color: meta?.color ?? '#d4d4d4' }" data-testid="label-name">
                {{ meta ? meta.name : pending ? 'Analysing…' : 'Not analysed' }}
              </span>
              <span class="text-base font-semibold text-neutral-100">
                {{ node.fenBefore ? moveNumberLabel(node.fenBefore) : '' }} {{ node.san }}
              </span>
              <span
                class="rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide"
                :class="node.color === session.state.you ? 'bg-amber-500/15 text-amber-300' : 'bg-neutral-700 text-neutral-300'"
              >
                {{ node.color === session.state.you ? 'You' : 'Opponent' }}
              </span>
              <span v-if="node.mainPly === null" class="rounded bg-sky-500/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-sky-300">
                Side line
              </span>
            </div>
            <p v-if="a" class="mt-1 text-sm leading-snug text-neutral-300" data-testid="label-reason">
              {{ reason }}
              <span v-if="isMaterialLabel(a)" class="block pt-0.5 text-xs text-neutral-500">
                By win chance alone this would be “{{ LABELS[a.labelReason.winChance].name }}”; the material rule makes it
                {{ meta?.name }}.
              </span>
            </p>
            <p v-else-if="error" class="mt-1 text-sm text-rose-300">Analysis failed: {{ error }}</p>
            <p v-else-if="pending" class="mt-1 flex items-center gap-2 text-sm text-neutral-400">
              <span class="h-3 w-3 animate-spin rounded-full border-2 border-neutral-500 border-t-transparent"></span>
              {{ node.mainPly === null ? 'Analysing your move…' : 'Waiting for the engine — this move was moved to the front of the queue.' }}
            </p>
          </div>
        </div>
        <div v-if="a" class="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]" data-testid="eval-change">
          <span class="text-neutral-400">
            Eval
            <span class="font-semibold tabular-nums text-neutral-100">{{ formatPositionEval(a.evalBefore, null) }}</span>
            →
            <span class="font-semibold tabular-nums text-neutral-100">{{ formatPositionEval(a.evalAfter, mated) }}</span>
          </span>
          <span class="text-neutral-400">
            Win chance ({{ a.color === 'white' ? 'White' : 'Black' }})
            <span class="tabular-nums text-neutral-200">{{ formatPercent(a.winBefore, 0) }} → {{ formatPercent(a.winAfter, 0) }}</span>
          </span>
          <span class="text-neutral-400">Accuracy <span class="tabular-nums text-neutral-200">{{ Math.round(a.accuracy) }}%</span></span>
        </div>
        <div v-if="a && ex" class="mt-3 space-y-2.5 border-t border-white/5 pt-3" data-testid="levels">
          <div v-if="confirmed && a.label !== 'book' && a.label !== 'forced'" class="text-sm font-medium text-emerald-400">
            ✓ Good — this was the move.
          </div>
          <LevelList title="Immediate" :level="ex.immediate" />
          <LevelList title="Short term" :level="ex.short" />
          <LevelList title="Long term" :level="ex.long" />
        </div>
      </section>

      <div v-if="a" class="space-y-3">
        <CandidateCard
          v-if="suggestions.pick"
          kind="pick"
          title="Try this"
          :candidate="suggestions.pick"
          :analysis="a"
          :from="node.parent"
        />
        <CandidateCard
          v-if="suggestions.best"
          kind="best"
          title="Engine’s top"
          :candidate="suggestions.best"
          :analysis="a"
          :from="node.parent"
          :notice="suggestions.deepOnly ? 'Deep engine move — hard to explain. No simpler good move with a concrete point was found.' : null"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
@reference "../style.css";
.kbd {
  @apply rounded border border-neutral-600 bg-neutral-700 px-1 text-xs text-neutral-200;
}
</style>
