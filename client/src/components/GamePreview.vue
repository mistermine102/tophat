<script setup lang="ts">
// A small read-only board that plays a game through on its own (hover preview in the Open dialog's chess.com list):
// one move every `stepMs`, a pause on the final position, then again from the start.
import type { Color, GameInfo } from '@chess-coach/shared';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { pgnToGame } from '../fixtures/pgnGame';
import { moveNumberLabel, uciSquares } from '../lib/chess';
import ChessBoard from './ChessBoard.vue';

const props = withDefaults(defineProps<{ pgn: string; orientation: Color; stepMs?: number; holdMs?: number }>(), { stepMs: 800, holdMs: 3000 });

const game = computed<GameInfo | null>(() => {
  try {
    return pgnToGame(props.pgn, null, 'preview-');
  } catch {
    return null;
  }
});
const ply = ref(0);
let timer: ReturnType<typeof setTimeout> | null = null;

function tick() {
  const g = game.value;
  if (!g) return;
  const atEnd = ply.value >= g.moves.length;
  timer = setTimeout(
    () => {
      ply.value = atEnd ? 0 : ply.value + 1;
      tick();
    },
    atEnd ? props.holdMs : ply.value === 0 ? 1000 : props.stepMs,
  );
}
function restart() {
  if (timer) clearTimeout(timer);
  ply.value = 0;
  tick();
}
watch(() => props.pgn, restart, { immediate: true });
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
});

const move = computed(() => (ply.value > 0 ? (game.value?.moves[ply.value - 1] ?? null) : null));
const fen = computed(() => move.value?.fenAfter ?? game.value?.startFen ?? '8/8/8/8/8/8/8/8 w - - 0 1');
const total = computed(() => game.value?.moves.length ?? 0);
const NO_DESTS = new Map<string, string[]>();
</script>

<template>
  <div class="w-full" data-testid="game-preview">
    <div class="aspect-square w-full overflow-hidden rounded-md">
      <ChessBoard
        :fen="fen"
        :orientation="orientation"
        :turn-color="move?.color === 'white' ? 'black' : 'white'"
        :dests="NO_DESTS"
        :last-move="move ? uciSquares(move.uci) : null"
        :check="false"
        :shapes="[]"
        :movable="false"
      />
    </div>
    <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-neutral-700">
      <div class="h-full bg-amber-500 transition-[width] duration-200" :style="{ width: `${total ? (ply / total) * 100 : 0}%` }"></div>
    </div>
    <p v-if="!game" class="mt-1 text-xs text-rose-300">This game can't be shown.</p>
    <p v-else class="mt-1 flex justify-between text-[11px] tabular-nums text-neutral-400">
      <span>{{ move ? `${moveNumberLabel(move.fenBefore)} ${move.san}` : 'Start' }}</span>
      <span>{{ Math.ceil(ply / 2) }} / {{ Math.ceil(total / 2) }}</span>
    </p>
  </div>
</template>
