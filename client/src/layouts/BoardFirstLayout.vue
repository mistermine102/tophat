<script setup lang="ts">
// Prototype A "Board-first" (`?ui=a`): a big board with the label badge on the moved piece and the move's consequences
// drawn on it (tinted, tagged squares + thin arrows, lib/consequences.ts), the players above / below it (PlayerBar:
// taken pieces and +N material) and the eval graph under it. Next to it one column: the summary, the verdict card
// (one sentence, round 10; the better move is the arrow on the board), "Moves here" while "Show best move" is on (what
// the arrows' moves do, TopIdeas) and right below it the main-line move list.
import { computed } from 'vue';
import BoardView from '../components/BoardView.vue';
import EvalBar from '../components/EvalBar.vue';
import EvalGraph from '../components/EvalGraph.vue';
import GameOverview from '../components/GameOverview.vue';
import MoveList from '../components/MoveList.vue';
import NavControls from '../components/NavControls.vue';
import PlayerBar from '../components/PlayerBar.vue';
import SummaryCompact from '../components/SummaryCompact.vue';
import TopIdeas from '../components/TopIdeas.vue';
import VerdictCard from '../components/VerdictCard.vue';

import { isCheckmate, sideToMove } from '../lib/chess';
import { useMove } from '../lib/useMove';
import { gameEnding } from '../lib/ending';

import { useSession } from '../stores/session';

const session = useSession();
const m = useMove(session);
const node = m.node;
const tree = computed(() => session.state.tree);
const game = computed(() => session.state.game);
// players around the board, as on chess.com: the side at the bottom ("You") below, the other one above
const bottomColor = computed(() => session.state.orientation);
const ending = computed(() => (game.value ? gameEnding(game.value) : null));
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

// "Moves here" is showing: the verdict / game card gives it room
const ideasOn = computed(() => session.ideasHere.value !== null);
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
      <div class="pa-explain shrink-0 overflow-y-auto" :class="{ 'pa-explain-short': ideasOn }" data-testid="explanation">
        <GameOverview v-if="!node || node.ply === 0" />
        <VerdictCard v-else />
      </div>
      <TopIdeas class="pa-ideas min-h-0 overflow-y-auto" />
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
.pa-explain-short {
  max-height: 34%;
}
/* the "Moves here" list shrinks before the move list does, but never below a few rows */
.pa-ideas {
  flex: 0 1 auto;
  min-height: 132px;
}
</style>
