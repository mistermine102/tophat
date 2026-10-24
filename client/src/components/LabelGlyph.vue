<script setup lang="ts">
// Round coloured label glyph (★ ! ✓ ?! ? ?? ✕ □ and a small book icon).
import type { Label } from '@chess-coach/shared';
import { computed } from 'vue';
import { LABELS } from '../lib/labels';

const props = withDefaults(defineProps<{ label: Label; size?: 'xs' | 'sm' | 'md' | 'lg' }>(), { size: 'sm' });
const meta = computed(() => LABELS[props.label]);
const dims = computed(
  () => ({ xs: 'h-3.5 w-3.5 text-[8px]', sm: 'h-4 w-4 text-[9px]', md: 'h-5 w-5 text-[11px]', lg: 'h-8 w-8 text-base' })[props.size],
);
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center rounded-full font-black leading-none text-neutral-950"
    :class="dims"
    :style="{ background: meta.color }"
    :title="meta.name"
    :data-label="label"
  >
    <svg v-if="label === 'book'" viewBox="0 0 16 16" class="h-[70%] w-[70%]" fill="currentColor" aria-hidden="true">
      <!-- open book: two pages around a spine -->
      <path d="M1 4.2 7.2 2.6v10.6L1 14.6zM15 4.2 8.8 2.6v10.6l6.2 1.4z" />
    </svg>
    <span v-else>{{ meta.glyph }}</span>
  </span>
</template>
