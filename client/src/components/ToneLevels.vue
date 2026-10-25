<script setup lang="ts">
// The three explanation levels with ✓ / ✗ / • marks: Immediate (sentences), Short term (the story as coloured
// chips), Long term. A level with nothing to say is one muted line.
import type { Explanation } from '@chess-coach/shared';
import { computed } from 'vue';
import { levelLines, storyParts } from '../lib/tones';
import StoryChips from './StoryChips.vue';
import ToneList from './ToneList.vue';

const props = withDefaults(defineProps<{ explanation: Explanation | null | undefined; skipImmediate?: number[] }>(), { skipImmediate: () => [] });
const imm = computed(() => levelLines(props.explanation?.immediate).filter((_, i) => !props.skipImmediate.includes(i)));
const story = computed(() => storyParts(props.explanation?.short));
const shortLines = computed(() => (story.value.length ? [] : levelLines(props.explanation?.short)));
const long = computed(() => levelLines(props.explanation?.long));
</script>

<template>
  <div class="space-y-2.5" data-testid="tone-levels">
    <div data-testid="level-immediate">
      <div class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Right now</div>
      <ToneList v-if="imm.length" :lines="imm" />
      <p v-else class="text-sm italic text-neutral-500">Nothing else right away.</p>
    </div>
    <div data-testid="level-short-term">
      <div class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Next few moves</div>
      <StoryChips v-if="story.length" :parts="story" />
      <ToneList v-else-if="shortLines.length" :lines="shortLines" />
      <p v-else class="text-sm italic text-neutral-500">No forcing follow-up.</p>
    </div>
    <div data-testid="level-long-term">
      <div class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Long term</div>
      <ToneList v-if="long.length" :lines="long" />
      <p v-else class="text-sm italic text-neutral-500">Nothing notable.</p>
    </div>
  </div>
</template>
