<script setup lang="ts">
import type { Color } from '@chess-coach/shared';

defineProps<{ color: Color }>();
const emit = defineEmits<{ pick: [role: 'q' | 'r' | 'b' | 'n']; cancel: [] }>();
const PIECES: { role: 'q' | 'r' | 'b' | 'n'; name: string; white: string; black: string }[] = [
  { role: 'q', name: 'Queen', white: '♕', black: '♛' },
  { role: 'r', name: 'Rook', white: '♖', black: '♜' },
  { role: 'b', name: 'Bishop', white: '♗', black: '♝' },
  { role: 'n', name: 'Knight', white: '♘', black: '♞' },
];
</script>

<template>
  <div class="absolute inset-0 z-20 flex items-center justify-center bg-black/55" data-testid="promotion" @mousedown.self="emit('cancel')">
    <div class="rounded-xl bg-neutral-800 p-3 shadow-2xl ring-1 ring-white/10">
      <div class="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-neutral-400">Promote to</div>
      <div class="flex gap-2">
        <button
          v-for="p in PIECES"
          :key="p.role"
          class="flex h-16 w-16 items-center justify-center rounded-lg bg-neutral-200 text-5xl leading-none text-neutral-900 hover:bg-amber-300"
          :title="p.name"
          :data-role="p.role"
          @click="emit('pick', p.role)"
        >
          {{ color === 'white' ? p.white : p.black }}
        </button>
      </div>
      <button class="mt-2 w-full rounded py-1 text-xs text-neutral-400 hover:bg-white/5" @click="emit('cancel')">Cancel</button>
    </div>
  </div>
</template>
