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
    <svg v-if="label === 'book'" viewBox="0 0 16 16" class="h-[62%] w-[62%]" fill="currentColor" aria-hidden="true">
      <path d="M2 3.2C3.6 2.5 5.6 2.4 7.4 3.3v10.2C5.6 12.7 3.6 12.8 2 13.4zM14 3.2c-1.6-.7-3.6-.8-5.4.1v10.2c1.8-.8 3.8-.7 5.4-.1z" />
    </svg>
    <span v-else>{{ meta.glyph }}</span>
  </span>
</template>
