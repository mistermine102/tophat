<script setup lang="ts">
import type { Level } from '@chess-coach/shared';
import { computed } from 'vue';

const props = withDefaults(defineProps<{ title: string; level: Level | null | undefined; compact?: boolean }>(), {
  compact: false,
});
const lines = computed(() => props.level?.text.filter((t) => t.trim().length > 0) ?? []);
// A level consisting only of "nothing notable" is shown muted, like an empty one.
const empty = computed(
  () => lines.value.length === 0 || (props.level?.facts.length === 1 && props.level.facts[0]!.type === 'nothing-notable'),
);
</script>

<template>
  <div :class="compact ? 'flex gap-2' : ''" :data-testid="`level-${title.toLowerCase().replace(/\s+/g, '-')}`">
    <div
      class="shrink-0 font-semibold uppercase tracking-wide text-neutral-400"
      :class="compact ? 'w-[5.5rem] pt-px text-[10px]' : 'mb-1 text-[11px]'"
    >
      {{ title }}
    </div>
    <p v-if="empty" class="text-sm italic text-neutral-500">Nothing notable.</p>
    <ul v-else class="min-w-0 space-y-1 text-sm leading-snug text-neutral-200">
      <li v-for="(t, i) in lines" :key="i" class="flex gap-2">
        <span class="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-neutral-500"></span>
        <span class="min-w-0 break-words">{{ t }}</span>
      </li>
    </ul>
  </div>
</template>
