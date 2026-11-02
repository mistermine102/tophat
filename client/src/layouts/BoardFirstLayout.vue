<script setup lang="ts">
// Prototype A "Board-first" (`?ui=a`): a big board with the label badge on the moved piece and the move's consequences
// drawn on it (tinted, tagged squares + thin arrows, lib/consequences.ts), the players above / below it (PlayerBar:
// taken pieces and +N material) and the eval graph under it. Next to it one column: the summary, the verdict card
// (up to 2 ✓ / ✗ points; the better move is the arrow on the board) and right below it the main-line move list.
import { computed } from 'vue';
import BoardView from '../components/BoardView.vue';
import EvalBar from '../components/EvalBar.vue';
import EvalGraph from '../components/EvalGraph.vue';
import GameOverview from '../components/GameOverview.vue';
import LabelGlyph from '../components/LabelGlyph.vue';
import MoveList from '../components/MoveList.vue';
import NavControls from '../components/NavControls.vue';
import PlayerBar from '../components/PlayerBar.vue';
import SummaryCompact from '../components/SummaryCompact.vue';
import ToneList from '../components/ToneList.vue';
import { isCheckmate, sideToMove } from '../lib/chess';
import { useMove } from '../lib/useMove';
import { gameEnding } from '../lib/ending';
import { keyPoints } from '../lib/verdict';
import { useSession } from '../stores/session';

const session = useSession();
const m = useMove(session);
const node = m.node;
const tree = computed(() => session.state.tree);
const game = computed(() => session.state.game);
// players around the board, as on chess.com: the side at the bottom ("You") below, the other one above
const bottomColor = computed(() => session.state.orientation);
const ending = computed(() => (game.value ? gameEnding(game.value) : null));
/** The player who made the viewed move, by name (falls back to White / Black). */
const mover = computed(() => {
  const c = node.value?.color;
  if (!c) return null;
  return { color: c, name: game.value?.headers[c === 'white' ? 'White' : 'Black'] || (c === 'white' ? 'White' : 'Black') };
});
const topColor = computed(() => (session.state.orientation === 'white' ? 'black' : 'white'));

// --- eval bar / graph (as in the classic board column) ---
const evalScore = computed(() => {
  const n = node.value;
  if (!n) return null;
  if (n.ply === 0) return session.state.analyses[1]?.evalBefore ?? null;
  if (m.a.value) return m.a.value.evalAfter;
  return n.mainPly !== null ? (session.state.analyses[n.mainPly + 1]?.evalBefore ?? null) : null;
});
const mated = computed(() => (node.value && isCheckmate(node.value.fen) ? sideToMove(node.value.fen) : null));
const graphPly = computed(() => (node.value && tree.value ? (tree.value.branchPoint(node.value).mainPly ?? 0) : 0));

// plain sentences only: no engine-line story (the immediate / short / long levels are gone from this screen)
const points = computed(() => (m.a.value && m.verdict.value ? keyPoints(m.a.value, m.verdict.value, 2, { line: false }) : []));
const accent = computed(() => m.meta.value?.color ?? '#737373');
</script>

<template>
  <main class="pa flex min-h-0 flex-1 justify-center gap-5 p-4" data-layout="a">
    <!-- board column -->
    <div class="flex shrink-0 flex-col gap-2">
      <PlayerBar v-if="game" class="pa-player" :color="topColor" :headers="game.headers" :fen="node?.fen ?? null" :ending="ending" />
      <div class="-mt-1 flex gap-2">
        <div class="pa-board-h">
          <EvalBar :score="evalScore" :mated="mated" :orientation="session.state.orientation" :pending="session.isPending(node)" />
        </div>
        <div class="pa-board th-board-frame">
          <BoardView consequences />
        </div>
      </div>
      <PlayerBar v-if="game" class="pa-player -mt-1" :color="bottomColor" :headers="game.headers" :fen="node?.fen ?? null" :ending="ending" />
      <NavControls
        class="pa-row"
        :can-prev="!!node?.parent"
        :can-next="!!node?.children.length"
        :in-side-line="!!tree?.inSideLine"
        :can-mistake="session.nextMistakePly.value !== null"
        @first="session.first()"
        @prev="session.prev()"
        @next="session.next()"
        @last="session.last()"
        @flip="session.flip()"
        @back="session.backToGame()"
        @mistake="session.nextMistake()"
      />
      <div class="pa-row h-[52px]">
        <EvalGraph
          v-if="session.state.game"
          :moves="session.state.game.moves"
          :analyses="session.state.analyses"
          :current-ply="graphPly"
          @select="(p) => session.goToMainPly(p)"
        />
      </div>
    </div>

    <!-- summary, the verdict card, and the moves right below it -->
    <div class="flex min-h-0 w-[380px] shrink-0 flex-col gap-3">
      <SummaryCompact />
      <div class="pa-explain shrink-0 overflow-y-auto" data-testid="explanation">
        <GameOverview v-if="!node || node.ply === 0" />
        <div
          v-else
          class="th-panel p-4"
          :style="{ '--accent': accent }"
          data-testid="verdict-bubble"
        >
          <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-neutral-400">
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
          <div v-if="m.a.value && m.verdict.value" class="mt-2 flex items-start gap-2.5" data-testid="verdict" :data-tone="m.verdict.value.tone">
            <LabelGlyph :label="m.a.value.label" size="lg" />
            <p class="min-w-0 pt-0.5 text-[16px] leading-snug text-neutral-50">
              <b class="th-display text-[21px] font-bold" :style="{ color: accent }" data-testid="label-name">{{ m.verdict.value.name }}</b>
              <span class="text-neutral-500"> — </span>{{ m.verdict.value.sentence }}
            </p>
          </div>
          <div v-else-if="m.error.value" class="mt-2 text-sm text-rose-300" data-testid="ply-error">
            <p>The analysis of this move failed: {{ m.error.value }}</p>
            <button class="th-btn th-btn-sm mt-1.5" data-testid="retry" @click="m.retry()">Try again</button>
          </div>
          <p v-else class="mt-2 flex items-center gap-2 text-[15px] text-neutral-300">
            <span class="h-4 w-4 animate-spin rounded-full border-2 border-neutral-500 border-t-transparent"></span>
            Analysing {{ m.moveName.value }}…
          </p>

          <template v-if="m.a.value">
            <ToneList v-if="points.length" class="mt-2.5" :lines="points" data-testid="key-points" />
          </template>
        </div>
      </div>
      <MoveList class="min-h-[150px]" :side-lines="false" />
    </div>
  </main>
</template>

<style scoped>
/* a calm, centred screen: the board doesn't grow past 720px, the column next to it is a fixed 380px */
.pa {
  --pa-board: clamp(300px, min(100vh - 272px, 100vw - 480px), 720px);
}
.pa-player {
  width: var(--pa-board);
  margin-left: 2.25rem; /* lined up with the board, past the eval bar */
}
.pa-board {
  width: var(--pa-board);
  height: var(--pa-board);
}
.pa-board-h {
  height: var(--pa-board);
}
.pa-row {
  width: calc(var(--pa-board) + 2.25rem);
}
.pa-explain {
  max-height: 62%;
}
</style>
