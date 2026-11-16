<script setup lang="ts">
// The phone layout (< 768px wide, instead of layout A): one screen, no page scrolling. Both players in one row, the
// board as wide as the screen allows with a slim eval bar beside it (sized so the explanation keeps at least 130px of
// height), then the explanation filling the rest and scrolling by itself (the verdict, "Moves here" when "Show best
// move" is on, and the move list below them; swipe it left / right for the next / previous move), and the move
// controls in one row at the bottom.
import { computed, ref, watch } from 'vue';
import BoardView from '../components/BoardView.vue';
import EvalBar from '../components/EvalBar.vue';
import GameOverview from '../components/GameOverview.vue';
import MobileToolbar from '../components/MobileToolbar.vue';
import MoveList from '../components/MoveList.vue';
import PlayersCompact from '../components/PlayersCompact.vue';
import TopIdeas from '../components/TopIdeas.vue';
import VerdictCard from '../components/VerdictCard.vue';
import { isCheckmate, sideToMove } from '../lib/chess';
import { useSession } from '../stores/session';

const session = useSession();
const node = computed(() => session.current.value);

const evalScore = computed(() => {
  const n = node.value;
  if (!n) return null;
  if (n.ply === 0) return session.state.analyses[1]?.evalBefore ?? null;
  const a = session.currentAnalysis.value;
  if (a) return a.evalAfter;
  return n.mainPly !== null ? (session.state.analyses[n.mainPly + 1]?.evalBefore ?? null) : null;
});
const mated = computed(() => (node.value && isCheckmate(node.value.fen) ? sideToMove(node.value.fen) : null));
const atStart = computed(() => !node.value || node.value.ply === 0);

// a new move: its explanation from the top
const explain = ref<HTMLElement | null>(null);
watch(
  () => node.value?.id,
  () => explain.value?.scrollTo({ top: 0 }),
);

// swipe the explanation: left = next move, right = previous (a mostly horizontal swipe of >= 60px)
let touch: { x: number; y: number } | null = null;
function onTouchStart(e: TouchEvent) {
  const t = e.touches[0];
  touch = t ? { x: t.clientX, y: t.clientY } : null;
}
function onTouchEnd(e: TouchEvent) {
  const t = e.changedTouches[0];
  if (!touch || !t) return;
  const dx = t.clientX - touch.x;
  const dy = t.clientY - touch.y;
  touch = null;
  if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
  if (dx < 0) session.next();
  else session.prev();
}
</script>

<template>
  <main class="ml flex min-h-0 flex-1 flex-col" data-layout="m">
    <PlayersCompact class="h-6 shrink-0" />

    <div class="flex shrink-0 justify-center gap-1 pl-1">
      <div class="ml-board-h">
        <EvalBar slim :score="evalScore" :mated="mated" :orientation="session.state.orientation" :pending="session.isPending(node)" />
      </div>
      <div class="ml-board">
        <BoardView consequences />
      </div>
    </div>

    <div
      ref="explain"
      class="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-1.5"
      data-testid="explanation"
      @touchstart.passive="onTouchStart"
      @touchend="onTouchEnd"
    >
      <GameOverview v-if="atStart" />
      <VerdictCard v-else compact />
      <TopIdeas />
      <MoveList class="max-h-[320px]" :side-lines="false" />
    </div>

    <MobileToolbar class="h-10 shrink-0 px-2 pb-1.5" />
  </main>
</template>

<style scoped>
/* The board: the screen's width minus the eval bar (14px), unless that leaves the explanation less than 130px
   (the visible height minus the header 40, the players 24 and the toolbar 40). */
.ml {
  --ml-board: min(calc(100vw - 14px), calc(100dvh - 40px - 24px - 40px - 130px));
}
.ml-board {
  width: var(--ml-board);
  height: var(--ml-board);
}
.ml-board-h {
  height: var(--ml-board);
}
</style>
