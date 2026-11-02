<script setup lang="ts">
// One player's strip above / below the board (layout A): colour, name, rating, the pieces they have taken in
// the viewed position (+N when ahead in material) and the game result for them with how it ended (EndingBadge).
import type { Color } from '@chess-coach/shared';
import { computed } from 'vue';
import { capturedBy, materialBalance } from '../lib/chess';
import type { Ending } from '../lib/ending';
import EndingBadge from './EndingBadge.vue';

const props = defineProps<{
  color: Color;
  headers: Record<string, string>;
  /** FEN of the viewed position (captured pieces / material), or null. */
  fen: string | null;
  /** How the game ended (lib/ending.ts), or null when unknown. */
  ending?: Ending | null;
}>();

const name = computed(() => (props.color === 'white' ? props.headers.White : props.headers.Black) || (props.color === 'white' ? 'White' : 'Black'));
const elo = computed(() => (props.color === 'white' ? props.headers.WhiteElo : props.headers.BlackElo) || null);
const result = computed(() => {
  const r = props.headers.Result;
  if (r === '1/2-1/2') return { text: 'Draw', cls: '' };
  if (r !== '1-0' && r !== '0-1') return null;
  const won = (r === '1-0') === (props.color === 'white');
  return won ? { text: 'Won', cls: 'th-badge-good' } : { text: 'Lost', cls: 'th-badge-bad' };
});
/** The opponent's pieces this player has taken, as chessground piece classes ("pawn black"), same kinds together. */
const taken = computed(() => {
  if (!props.fen) return [];
  const theirs = props.color === 'white' ? 'black' : 'white';
  const roles = capturedBy(props.fen, props.color);
  return roles.map((role, i) => ({ cls: `${role} ${theirs}`, newKind: i > 0 && roles[i - 1] !== role }));
});
const ahead = computed(() => {
  if (!props.fen) return 0;
  const b = materialBalance(props.fen);
  return props.color === 'white' ? b : -b;
});
</script>

<template>
  <div class="flex h-9 items-center gap-2.5 px-0.5" :data-testid="`player-${color}`">
    <span class="h-3.5 w-3.5 shrink-0 rounded-full" :class="color === 'white' ? 'th-side-white' : 'th-side-black'" aria-hidden="true"></span>
    <span class="min-w-0 truncate text-[15px] font-semibold text-neutral-100" data-testid="player-name">{{ name }}</span>
    <span v-if="elo" class="text-[13px] tabular-nums text-neutral-400">({{ elo }})</span>
    <span v-if="taken.length || ahead > 0" class="ml-1.5 flex min-w-0 items-center gap-2.5" title="Pieces taken so far" data-testid="player-taken">
      <!-- chessground's piece art: <piece> elements inside a .cg-wrap (style.css .th-taken) -->
      <span class="cg-wrap th-taken">
        <component :is="'piece'" v-for="(p, i) in taken" :key="i" :class="[p.cls, { 'th-new-kind': p.newKind }]" />
      </span>
      <span v-if="ahead > 0" class="text-sm font-bold tabular-nums text-neutral-400">+{{ ahead }}</span>
    </span>
    <span v-if="result" class="ml-auto flex shrink-0 items-center gap-2">
      <span class="th-badge" :class="result.cls" data-testid="player-result">{{ result.text }}</span>
      <EndingBadge v-if="ending" :ending="ending" data-testid="player-ending" />
    </span>
  </div>
</template>
