<script setup lang="ts">
// Phones: both players in one row above the board, the top player on the left and the bottom one on the right, each
// with rating, +N when ahead in material, and Won / Lost / ½.
import type { Color } from '@chess-coach/shared';
import { computed } from 'vue';
import { materialBalance } from '../lib/chess';
import { useSession } from '../stores/session';

const session = useSession();
const game = computed(() => session.state.game);
const fen = computed(() => session.current.value?.fen ?? null);
function side(color: Color) {
  const h = game.value?.headers ?? {};
  const name = (color === 'white' ? h.White : h.Black) || (color === 'white' ? 'White' : 'Black');
  const elo = (color === 'white' ? h.WhiteElo : h.BlackElo) || null;
  const r = h.Result;
  const result = r === '1/2-1/2' ? '½' : r === '1-0' || r === '0-1' ? ((r === '1-0') === (color === 'white') ? 'Won' : 'Lost') : null;
  const b = fen.value ? materialBalance(fen.value) : 0;
  const ahead = color === 'white' ? b : -b;
  return { color, name, elo, result, ahead };
}
const players = computed(() => {
  const bottom = session.state.orientation;
  return [side(bottom === 'white' ? 'black' : 'white'), side(bottom)];
});
</script>

<template>
  <div class="flex items-center gap-2 px-3 text-[13px]" data-testid="players-compact">
    <template v-for="(p, i) in players" :key="p.color">
      <span v-if="i === 1" class="text-neutral-500">vs</span>
      <span class="flex min-w-0 flex-1 items-center gap-1.5" :class="i === 1 ? 'justify-end' : ''">
        <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="p.color === 'white' ? 'th-side-white' : 'th-side-black'"></span>
        <span class="truncate font-semibold text-neutral-100">{{ p.name }}</span>
        <span v-if="p.elo" class="text-neutral-500">{{ p.elo }}</span>
        <span v-if="p.ahead > 0" class="text-neutral-400">+{{ p.ahead }}</span>
        <span v-if="p.result" class="th-badge" :class="p.result === 'Won' ? 'th-badge-good' : p.result === 'Lost' ? 'th-badge-bad' : ''">{{ p.result }}</span>
      </span>
    </template>
  </div>
</template>
