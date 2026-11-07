<script setup lang="ts">
// Round coloured label glyph (!! ★ ! ✓ ?! ? ?? ✕ □ and a small book icon), drawn as centred SVG (GlyphIcon).
import type { Label } from '@chess-coach/shared';
import { computed } from 'vue';
import { LABELS } from '../lib/labels';
import GlyphIcon from './GlyphIcon.vue';

const props = withDefaults(defineProps<{ label: Label; size?: 'xs' | 'sm' | 'md' | 'lg' }>(), { size: 'sm' });
const meta = computed(() => LABELS[props.label]);
const dims = computed(() => ({ xs: 'h-3.5 w-3.5', sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-8 w-8' })[props.size]);
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center rounded-full text-neutral-950"
    :class="dims"
    :style="{ background: meta.color }"
    :title="`${meta.name} — ${meta.rule}`"
    :data-label="label"
  >
    <GlyphIcon :name="label" class="block h-[70%] w-[70%]" />
  </span>
</template>
