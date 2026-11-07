<script setup lang="ts">
import { useSession } from '../stores/session';

defineProps<{ canPrev: boolean; canNext: boolean; inSideLine: boolean; canMistake: boolean }>();
const emit = defineEmits<{ first: []; prev: []; next: []; last: []; flip: []; back: []; mistake: [] }>();
// "Show best move" lives in the session (remembered), so every layout's controls share it
const session = useSession();
</script>

<template>
  <div class="flex items-center gap-2" data-testid="nav">
    <button class="th-btn nav-btn" title="Start (Home)" aria-label="First move" :disabled="!canPrev" @click="emit('first')">
      <svg viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor"><path d="M4 4h2v12H4zM16 4v12L7 10z" /></svg>
    </button>
    <button class="th-btn nav-btn" title="Previous (←)" aria-label="Previous move" :disabled="!canPrev" @click="emit('prev')">
      <svg viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor"><path d="M14 4v12L5 10z" /></svg>
    </button>
    <button class="th-btn nav-btn" title="Next (→)" aria-label="Next move" :disabled="!canNext" @click="emit('next')">
      <svg viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor"><path d="M6 4v12l9-6z" /></svg>
    </button>
    <button class="th-btn nav-btn" title="End (End)" aria-label="Last move" :disabled="!canNext" @click="emit('last')">
      <svg viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor"><path d="M14 4h2v12h-2zM4 4v12l9-6z" /></svg>
    </button>
    <button class="th-btn nav-btn ml-1" title="Flip board (F) — the side at the bottom is “You”" aria-label="Flip board" data-testid="flip" @click="emit('flip')">
      <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 3v13M6 16l-3-3M6 16l3-3M14 17V4M14 4l-3 3M14 4l3 3" />
      </svg>
    </button>
    <button
      class="th-btn nav-btn best-btn"
      :class="{ 'is-on': session.state.showBest }"
      :title="session.state.showBest ? 'Hide the best move (B)' : 'Show the best move in this position (B)'"
      aria-label="Show best move"
      :aria-pressed="session.state.showBest"
      data-testid="show-best"
      @click="session.toggleShowBest()"
    >
      <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 16L15 4M15 4H8.5M15 4v6.5" />
      </svg>
    </button>
    <button
      v-if="!inSideLine"
      class="th-btn ml-auto"
      data-testid="next-mistake"
      title="Jump to the next inaccuracy, mistake, miss or blunder (N)"
      :disabled="!canMistake"
      @click="emit('mistake')"
    >
      Next mistake
      <svg viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor"><path d="M4 4v12l7-6zM11 4v12l7-6z" /></svg>
    </button>
    <button
      v-if="inSideLine"
      class="th-btn th-btn-primary ml-auto"
      data-testid="back-to-game"
      title="Return to the game position this line branched from"
      @click="emit('back')"
    >
      <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5L3 10l5 5M3 10h9a5 5 0 0 1 5 5" /></svg>
      Back to game
    </button>
  </div>
</template>

<style scoped>
.nav-btn {
  width: 2.75rem;
  padding: 0;
}
.best-btn.is-on {
  background: #e0a400;
  border-color: #b98700;
  color: #1c1917;
}
</style>
