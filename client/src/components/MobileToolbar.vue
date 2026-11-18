<script setup lang="ts">
// Phones: all the move controls in one row (or, `vertical`, one column beside the board): start, back, forward, end,
// flip, "Show best move" and next mistake (an icon here), or "Back to game" in a side line.
import { computed } from 'vue';
import { useSession } from '../stores/session';

defineProps<{ vertical?: boolean }>();
const session = useSession();
const node = computed(() => session.current.value);
const inSide = computed(() => !!session.state.tree?.inSideLine);
</script>

<template>
  <div class="flex gap-1.5" :class="vertical ? 'tb-col flex-col' : 'flex-row'" data-testid="nav">
    <button class="th-btn tb-btn" aria-label="First move" :disabled="!node?.parent" @click="session.first()">
      <svg viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor"><path d="M4 4h2v12H4zM16 4v12L7 10z" /></svg>
    </button>
    <button class="th-btn tb-btn" aria-label="Previous move" :disabled="!node?.parent" @click="session.prev()">
      <svg viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor"><path d="M14 4v12L5 10z" /></svg>
    </button>
    <button class="th-btn tb-btn" aria-label="Next move" :disabled="!node?.children.length" @click="session.next()">
      <svg viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor"><path d="M6 4v12l9-6z" /></svg>
    </button>
    <button class="th-btn tb-btn" aria-label="Last move" :disabled="!node?.children.length" @click="session.last()">
      <svg viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor"><path d="M14 4h2v12h-2zM4 4v12l9-6z" /></svg>
    </button>
    <button class="th-btn tb-btn" aria-label="Flip board" data-testid="flip" @click="session.flip()">
      <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 3v13M6 16l-3-3M6 16l3-3M14 17V4M14 4l-3 3M14 4l3 3" />
      </svg>
    </button>
    <button
      class="th-btn tb-btn"
      :class="{ 'is-on': session.state.showBest }"
      aria-label="Show best move"
      :aria-pressed="session.state.showBest"
      data-testid="show-best"
      @click="session.toggleShowBest()"
    >
      <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16L15 4M15 4H8.5M15 4v6.5" /></svg>
    </button>
    <button class="th-btn tb-btn" aria-label="Move sounds" :aria-pressed="session.state.sound" data-testid="sound" @click="session.toggleSound()">
      <template v-if="session.state.sound"><svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8v4h3l4 3.5v-11L6 8z" fill="currentColor" /><path d="M13 7.5a3.5 3.5 0 0 1 0 5M15.2 5.3a6.6 6.6 0 0 1 0 9.4" /></svg></template>
      <template v-else><svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8v4h3l4 3.5v-11L6 8z" fill="currentColor" /><path d="M13.5 8l4 4M17.5 8l-4 4" /></svg></template>
    </button>
    <button v-if="inSide" class="th-btn th-btn-primary tb-btn" aria-label="Back to game" data-testid="back-to-game" @click="session.backToGame()">
      <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5L3 10l5 5M3 10h9a5 5 0 0 1 5 5" /></svg>
    </button>
    <button v-else class="th-btn tb-btn" aria-label="Next mistake" data-testid="next-mistake" :disabled="session.nextMistakePly.value === null" @click="session.nextMistake()">
      <svg viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor"><path d="M4 4v12l7-6zM11 4v12l7-6z" /></svg>
    </button>
  </div>
</template>

<style scoped>
.tb-btn {
  flex: 1 1 0;
  min-width: 0;
  height: auto;
  padding: 0;
  justify-content: center;
}
.tb-col .tb-btn {
  min-height: 0;
  width: 100%;
}
.tb-btn.is-on {
  background: var(--th-ink);
  border-color: var(--th-ink);
  color: #f0c24b;
}
</style>
