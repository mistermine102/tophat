<script setup lang="ts">
// Eval bar + board (+ promotion picker, preview caption) + navigation + eval graph.
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { computed, ref } from 'vue';
import { isCheck, isCheckmate, legalDests, needsPromotion, sideToMove, uciSquares } from '../lib/chess';
import { TOP_GOLD, topArrowShapes } from '../lib/topArrows';
import { useSession } from '../stores/session';
import ChessBoard from './ChessBoard.vue';
import EvalBar from './EvalBar.vue';
import EvalGraph from './EvalGraph.vue';
import NavControls from './NavControls.vue';
import PromotionPicker from './PromotionPicker.vue';

const session = useSession();
const board = ref<InstanceType<typeof ChessBoard> | null>(null);
const node = computed(() => session.current.value);
const preview = computed(() => session.state.preview);
const analysis = computed(() => session.currentAnalysis.value);
const promotion = ref<{ orig: string; dest: string } | null>(null);

const fen = computed(() => preview.value?.fen ?? node.value?.fen ?? '8/8/8/8/8/8/8/8 w - - 0 1');
const turn = computed(() => sideToMove(fen.value));
const dests = computed(() => (preview.value ? new Map<string, string[]>() : legalDests(fen.value)));
const lastMove = computed(() => {
  const u = preview.value?.uci ?? node.value?.uci;
  return u ? uciSquares(u) : null;
});
const check = computed(() => isCheck(fen.value));

// (feedback round 3) no big arrows for the best / suggested move: the threat arrow, and with "Show best move" on the
// engine's top moves here, as bright as they are good (lib/topArrows.ts)
const shapes = computed<DrawShape[]>(() => {
  if (preview.value) return [];
  const top: DrawShape[] = session.state.showBest
    ? topArrowShapes(session.topHere.value)
    : [];
  const threat: DrawShape[] = (analysis.value?.arrows ?? []).filter((a) => a.kind === 'threat').map((a) => ({ orig: a.from as Key, dest: a.to as Key, brush: 'threat' }));
  return [...threat, ...top];
});

const evalScore = computed(() => {
  const n = node.value;
  if (!n) return null;
  if (n.ply === 0) return session.state.analyses[1]?.evalBefore ?? null;
  if (analysis.value) return analysis.value.evalAfter;
  // main line: the position after ply p is the next ply's "before" position
  return n.mainPly !== null ? (session.state.analyses[n.mainPly + 1]?.evalBefore ?? null) : null;
});
const mated = computed(() => (node.value && isCheckmate(node.value.fen) ? sideToMove(node.value.fen) : null));

function onMove(orig: string, dest: string) {
  if (needsPromotion(fen.value, orig, dest)) {
    promotion.value = { orig, dest };
    return;
  }
  if (!session.playMove(orig + dest)) board.value?.sync();
}

function onPromote(role: string) {
  const p = promotion.value;
  promotion.value = null;
  if (p && !session.playMove(p.orig + p.dest + role)) board.value?.sync();
}

function cancelPromotion() {
  promotion.value = null;
  board.value?.sync();
}

const tree = computed(() => session.state.tree);
const graphPly = computed(() => (node.value && tree.value ? (tree.value.branchPoint(node.value).mainPly ?? 0) : 0));
const legend = [
  { kind: 'threat', label: 'Threat', color: '#dc2626' },
  { kind: 'top', label: 'Engine’s top moves', color: TOP_GOLD },
] as const;
const shownKinds = computed(() => new Set(shapes.value.map((s) => (s.brush?.startsWith('top') ? 'top' : s.brush))));
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <div class="flex gap-2">
      <div class="board-size">
        <EvalBar :score="evalScore" :mated="mated" :orientation="session.state.orientation" :pending="session.isPending(node)" />
      </div>
      <div class="board-size relative aspect-square">
        <ChessBoard
          ref="board"
          :fen="fen"
          :orientation="session.state.orientation"
          :turn-color="turn"
          :dests="dests"
          :last-move="lastMove"
          :check="check"
          :shapes="shapes"
          :movable="!preview && !promotion"
          :highlight="session.state.highlight"
          @move="onMove"
        />
        <PromotionPicker v-if="promotion" :color="turn" @pick="onPromote" @cancel="cancelPromotion" />
        <div v-if="preview" class="pointer-events-none absolute -inset-[3px] z-10 rounded-[3px] ring-[3px] ring-sky-400/80"></div>
      </div>
    </div>
    <div class="board-row flex items-center gap-3">
      <NavControls
        class="flex-1"
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
    </div>
    <div class="board-row flex h-4 items-center gap-3 text-[11px] text-neutral-500">
      <span v-if="preview" class="truncate font-medium text-sky-300" data-testid="preview-caption">{{ preview.caption }}</span>
      <template v-else>
        <template v-for="l in legend" :key="l.kind">
          <span v-if="shownKinds.has(l.kind)" class="inline-flex items-center gap-1">
            <span class="h-1 w-3.5 rounded" :style="{ background: l.color }"></span>{{ l.label }}
          </span>
        </template>
        <span v-if="session.state.tree?.inSideLine" class="ml-auto text-sky-300/80">Exploring a side line</span>
        <span v-else-if="!preview" class="ml-auto">Drag a piece to try another move</span>
      </template>
    </div>
    <div class="board-row h-[72px]">
      <EvalGraph
        v-if="session.state.game"
        :moves="session.state.game.moves"
        :analyses="session.state.analyses"
        :current-ply="graphPly"
        @select="(p) => session.goToMainPly(p)"
      />
    </div>
  </div>
</template>

<style scoped>
.board-size {
  height: var(--board-size);
}
.aspect-square {
  width: var(--board-size);
}
.board-row {
  width: calc(var(--board-size) + 2.25rem);
}
</style>
