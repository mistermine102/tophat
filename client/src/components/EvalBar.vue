<script setup lang="ts">
// Vertical eval bar, White POV. White's share grows from White's side of the board. `slim`: a thin one without the
// number (phones).
import type { Color, Score } from '@chess-coach/shared';
import { computed } from 'vue';
import { formatBarScore, scoreLeader, whiteWinPercent } from '../lib/format';

const props = defineProps<{ score: Score | null; mated: Color | null; orientation: Color; pending: boolean; slim?: boolean }>();

const white = computed(() => whiteWinPercent(props.score, props.mated));
const leader = computed(() => scoreLeader(props.score, props.mated) ?? 'white');
const text = computed(() => formatBarScore(props.score, props.mated));
// The label sits at the leading side's end of the bar.
const labelAtBottom = computed(() => (leader.value === props.orientation));
</script>

<template>
  <div
    class="relative h-full overflow-hidden border-[var(--th-ink)] bg-[var(--th-ink)]"
    :class="slim ? 'w-2.5 rounded-[4px] border' : 'w-7 rounded-[9px] border-2'"
    data-testid="eval-bar"
    :title="score || mated ? `Evaluation (White's view): ${text}` : 'Not analysed yet'"
  >
    <div
      class="absolute inset-x-0 bg-[var(--th-paper)] transition-[height] duration-300 ease-out"
      :class="orientation === 'white' ? 'bottom-0' : 'top-0'"
      :style="{ height: `${score || mated ? white : 50}%` }"
    ></div>
    <div class="absolute inset-x-0 top-1/2 h-px bg-amber-500/50"></div>
    <div
      v-if="text && !slim"
      class="absolute inset-x-0 text-center text-[10px] font-bold leading-none tabular-nums"
      :class="[
        labelAtBottom ? 'bottom-1.5' : 'top-1.5',
        leader === 'white' ? 'text-[var(--th-ink)]' : 'text-[var(--th-paper)]',
      ]"
    >
      {{ text }}
    </div>
    <div v-if="pending && !score && !mated && !slim" class="absolute inset-0 flex items-center justify-center">
      <span class="h-3 w-3 animate-spin rounded-full border-2 border-[var(--th-paper-2)] border-t-transparent"></span>
    </div>
  </div>
</template>
