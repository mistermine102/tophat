<script setup lang="ts">
// "Moves here": the engine's top moves in the position on the board, next to the "Show best move" arrows (same
// numbers, same colours), with their scores. No sentences. Hovering a move highlights its squares.
// (Brilliant lines) A sound sacrifice gets the Brilliant colour and "!!"; one from outside the engine's list comes
// after it, below a thin rule.
import { computed } from 'vue';
import { sideToMove } from '../lib/chess';
import { formatScore } from '../lib/format';
import { LABELS } from '../lib/labels';
import { topLabelFill } from '../lib/topArrows';
import { useSession } from '../stores/session';

const session = useSession();
const ideas = computed(() => session.ideasHere.value);
const toMove = computed(() => {
  const fen = session.state.tree?.current.fen;
  return fen ? (sideToMove(fen) === 'white' ? 'White' : 'Black') : null;
});

interface Row {
  n: number;
  uci: string;
  san: string;
  score: string | null;
  fill: string;
  brilliant: boolean;
  extra: boolean;
  title?: string;
}

const BRILLIANT = LABELS.brilliant;

const rows = computed<Row[]>(() =>
  session.topHere.value.map((m, i) => ({
    n: i + 1,
    uci: m.uci,
    san: m.san,
    score: 'score' in m && m.score ? formatScore(m.score) : null,
    fill: topLabelFill(m, i),
    brilliant: 'brilliant' in m && !!m.brilliant,
    extra: 'extra' in m && !!m.extra,
    ...('brilliant' in m && m.brilliant ? { title: `Brilliant: a sound sacrifice of the ${m.brilliant.piece.role}` } : {}),
  })),
);

function highlight(uci: string | null) {
  session.setHighlight(uci ? [uci.slice(0, 2), uci.slice(2, 4)] : []);
}
</script>

<template>
  <section v-if="ideas !== null && rows.length" class="th-panel p-4" data-testid="top-ideas">
    <div class="mb-2.5 flex items-center gap-2">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-neutral-400">Moves here</h3>
      <span v-if="toMove" class="text-[12px] text-neutral-500">{{ toMove }} to move</span>
    </div>
    <ol class="space-y-1.5">
      <li
        v-for="(r, i) in rows"
        :key="r.uci"
        class="rounded-md"
        :class="{ 'extra-row': r.extra && (i === 0 || !rows[i - 1]!.extra) }"
        data-testid="top-idea"
        :data-uci="r.uci"
        :data-brilliant="r.brilliant || undefined"
        :title="r.title"
        @mouseenter="highlight(r.uci)"
        @mouseleave="highlight(null)"
      >
        <div class="flex items-center gap-2">
          <span class="rank" :style="{ background: r.fill }" aria-hidden="true">{{ r.n }}</span>
          <b class="text-[14px]" :class="r.brilliant ? '' : 'text-neutral-100'" :style="r.brilliant ? { color: BRILLIANT.color } : undefined">{{ r.san }}<span v-if="r.brilliant" class="ml-0.5">{{ BRILLIANT.glyph }}</span></b>
          <span v-if="r.score" class="text-[12px] tabular-nums text-neutral-500">{{ r.score }}</span>
        </div>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.extra-row {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid rgb(255 255 255 / 0.08);
}
.rank {
  display: inline-flex;
  height: 18px;
  width: 18px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
}
</style>
