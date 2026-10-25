<script setup lang="ts">
defineProps<{ canPrev: boolean; canNext: boolean; inSideLine: boolean; canMistake: boolean }>();
const emit = defineEmits<{ first: []; prev: []; next: []; last: []; flip: []; back: []; mistake: [] }>();
</script>

<template>
  <div class="flex items-center gap-1.5" data-testid="nav">
    <button class="nav-btn" title="Start (Home)" aria-label="First move" :disabled="!canPrev" @click="emit('first')">
      <svg viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor"><path d="M4 4h2v12H4zM16 4v12L7 10z" /></svg>
    </button>
    <button class="nav-btn" title="Previous (←)" aria-label="Previous move" :disabled="!canPrev" @click="emit('prev')">
      <svg viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor"><path d="M14 4v12L5 10z" /></svg>
    </button>
    <button class="nav-btn" title="Next (→)" aria-label="Next move" :disabled="!canNext" @click="emit('next')">
      <svg viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor"><path d="M6 4v12l9-6z" /></svg>
    </button>
    <button class="nav-btn" title="End (End)" aria-label="Last move" :disabled="!canNext" @click="emit('last')">
      <svg viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor"><path d="M14 4h2v12h-2zM4 4v12l9-6z" /></svg>
    </button>
    <button class="nav-btn ml-1" title="Flip board (F)" aria-label="Flip board" data-testid="flip" @click="emit('flip')">
      <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 3v13M6 16l-3-3M6 16l3-3M14 17V4M14 4l-3 3M14 4l3 3" />
      </svg>
    </button>
    <button
      v-if="!inSideLine"
      class="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md bg-neutral-800 px-3 text-sm text-neutral-200 ring-1 ring-white/5 transition hover:bg-neutral-700 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-neutral-800"
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
      class="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md bg-amber-500 px-3 text-sm font-semibold text-neutral-950 hover:bg-amber-400"
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
@reference "../style.css";
.nav-btn {
  @apply inline-flex h-9 w-11 items-center justify-center rounded-md bg-neutral-800 text-neutral-200 ring-1 ring-white/5 transition hover:bg-neutral-700 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-neutral-800;
}
</style>
