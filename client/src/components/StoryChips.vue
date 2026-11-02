<script setup lang="ts">
// The Short-term story as a row of chips joined by arrows, each coloured by its tone for the mover
// (✓ green = good for the mover, ✗ red = bad, grey = neutral). Optional: an active chip (replay) and clicks.
import type { StoryPart } from '@chess-coach/shared';
import { TONE_META } from '../lib/tones';

withDefaults(defineProps<{ parts: readonly StoryPart[]; active?: number | null; clickable?: boolean }>(), { active: null, clickable: false });
const emit = defineEmits<{ select: [index: number] }>();
const CHIP_BG = { good: 'rgba(63, 125, 78, 0.14)', bad: 'rgba(181, 64, 42, 0.13)', neutral: 'rgba(149, 122, 102, 0.12)' } as const;
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-1 gap-y-1.5" data-testid="story-chips">
    <!-- each chip keeps the arrow before it, so a wrapped row never starts or ends with a bare arrow -->
    <span v-for="(p, i) in parts" :key="i" class="inline-flex max-w-full items-center gap-1">
      <span v-if="i > 0" class="text-xs text-neutral-600" aria-hidden="true">→</span>
      <span v-if="p.text === '…'" class="px-0.5 text-neutral-500" title="Quieter moves in between">…</span>
      <component
        :is="clickable && p.plies ? 'button' : 'span'"
        v-else
        class="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md px-1.5 py-[3px] text-left text-[13px] leading-tight ring-1 transition"
        :class="[active === i ? 'ring-2 ring-white/80' : 'ring-white/5', clickable && p.plies ? 'cursor-pointer hover:brightness-125' : '', !p.plies ? 'font-semibold' : '']"
        :style="{ background: CHIP_BG[p.tone], color: p.tone === 'neutral' ? '#573826' : TONE_META[p.tone].color }"
        :data-tone="p.tone"
        @click="clickable && p.plies ? emit('select', i) : undefined"
      >
        <span v-if="p.tone !== 'neutral'" class="text-[11px] font-bold" aria-hidden="true">{{ TONE_META[p.tone].icon }}</span>
        <span class="min-w-0" :class="p.tone === 'neutral' ? '' : 'text-neutral-100'">{{ p.text }}</span>
      </component>
    </span>
  </div>
</template>
