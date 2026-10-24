<script setup lang="ts">
// Vertical eval bar, White POV. White's share grows from White's side of the board.
import type { Color, Score } from '@chess-coach/shared';
import { computed } from 'vue';
import { formatBarScore, scoreLeader, whiteWinPercent } from '../lib/format';

const props = defineProps<{ score: Score | null; mated: Color | null; orientation: Color; pending: boolean }>();

const white = computed(() => whiteWinPercent(props.score, props.mated));
const leader = computed(() => scoreLeader(props.score, props.mated) ?? 'white');
const text = computed(() => formatBarScore(props.score, props.mated));
// The label sits at the leading side's end of the bar.
const labelAtBottom = computed(() => (leader.value === props.orientation));
</script>

<template>
  <div
    class="relative h-full w-7 overflow-hidden rounded-md bg-neutral-700 ring-1 ring-black/40"
    data-testid="eval-bar"
    :title="score || mated ? `Evaluation (White's view): ${text}` : 'Not analysed yet'"
  >
    <div
      class="absolute inset-x-0 bg-neutral-100 transition-[height] duration-300 ease-out"
      :class="orientation === 'white' ? 'bottom-0' : 'top-0'"
      :style="{ height: `${score || mated ? white : 50}%` }"
    ></div>
    <div class="absolute inset-x-0 top-1/2 h-px bg-amber-500/50"></div>
    <div
      v-if="text"
      class="absolute inset-x-0 text-center text-[10px] font-bold leading-none tabular-nums"
      :class="[
        labelAtBottom ? 'bottom-1.5' : 'top-1.5',
        leader === 'white' ? 'text-neutral-800' : 'text-neutral-100',
      ]"
    >
      {{ text }}
    </div>
    <div v-if="pending && !score && !mated" class="absolute inset-0 flex items-center justify-center">
      <span class="h-3 w-3 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent"></span>
    </div>
  </div>
</template>
