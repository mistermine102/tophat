<script setup lang="ts">
// How a game ended, as an icon-only badge: a king (checkmate), a flag (resign), an hourglass (time) …; the
// words are in the tooltip and the accessible label. Colour by family (lib/ending.ts ENDING_BADGE): chocolate = the board decided, rust = a player did,
// caramel = the clock.
import { computed } from 'vue';
import { ENDING_BADGE, ENDING_TEXT, type Ending } from '../lib/ending';

const props = defineProps<{ ending: Ending }>();
const meta = computed(() => ENDING_BADGE[props.ending]);
const FAMILY = { board: 'th-badge-ink', player: 'th-badge-accent', clock: 'th-badge-caramel' } as const;
/** "Checkmate — ended by checkmate", "Time — ended on time" … */
const title = computed(() => `${meta.value.short} — ended ${ENDING_TEXT[props.ending]}`);
</script>

<template>
  <span
    class="th-badge w-[1.375rem] justify-center px-0"
    :class="FAMILY[meta.family]"
    :title="title"
    role="img"
    :aria-label="title"
    data-testid="ending-badge"
    :data-ending="ending"
  >
    <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 shrink-0" fill="currentColor" aria-hidden="true">
      <!-- checkmate: a king piece (cross, flared crown, collar, body, base) -->
      <g v-if="ending === 'checkmate'">
        <rect x="7.25" y=".4" width="1.5" height="3.6" rx=".4" />
        <rect x="5.85" y="1.35" width="4.3" height="1.4" rx=".4" />
        <path d="M3.9 4.9Q8 3.1 12.1 4.9L10.7 7.6H5.3Z" />
        <rect x="4.9" y="7.95" width="6.2" height="1.25" rx=".5" />
        <path d="M5.75 9.55h4.5l1.1 3.1H4.65Z" />
        <rect x="3.2" y="12.95" width="9.6" height="2.45" rx="1" />
      </g>
      <!-- resign: a flag on a pole -->
      <g v-else-if="ending === 'resignation'">
        <rect x="3" y="1.5" width="1.6" height="13" rx=".8" />
        <path d="M4.6 2.3h8.2l-2.2 3.2 2.2 3.2H4.6Z" />
      </g>
      <!-- abandon: out through the door -->
      <g v-else-if="ending === 'abandonment'">
        <path d="M2.5 2h6.5v2.2H4.7v7.6H9V14H2.5Z" />
        <path d="M9.5 4.6 13.8 8l-4.3 3.4V9.2H6.2V6.8h3.3Z" />
      </g>
      <!-- time: an hourglass -->
      <g v-else-if="ending === 'time' || ending === 'timeout-insufficient'">
        <rect x="3" y="1" width="10" height="1.8" rx=".6" />
        <rect x="3" y="13.2" width="10" height="1.8" rx=".6" />
        <path d="M4.2 2.8h7.6c0 2.4-1.6 3.6-2.7 5.2 1.1 1.6 2.7 2.8 2.7 5.2H4.2c0-2.4 1.6-3.6 2.7-5.2C5.8 6.4 4.2 5.2 4.2 2.8Zm1.9 1.2c.3 1.2 1.2 2 1.9 2.8.7-.8 1.6-1.6 1.9-2.8Z" fill-rule="evenodd" />
      </g>
      <!-- repetition: going round in circles -->
      <g v-else-if="ending === 'repetition'" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12.6 6.2A5 5 0 0 0 3.4 6.8M3.4 9.8a5 5 0 0 0 9.2.6" />
        <path d="M12.9 2.8v3.6H9.3M3.1 13.2V9.6h3.6" />
      </g>
      <!-- the other draws (stalemate, agreed, no material, 50 moves): an equals sign -->
      <g v-else>
        <rect x="2.5" y="4.6" width="11" height="2.2" rx="1" />
        <rect x="2.5" y="9.2" width="11" height="2.2" rx="1" />
      </g>
    </svg>
  </span>
</template>
