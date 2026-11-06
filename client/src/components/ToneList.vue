<script setup lang="ts">
// Sentences with a ✓ (helps the mover) / ✗ (hurts the mover) / • (neutral) mark. Square names highlight their
// square on the board while hovered.
import { computed } from 'vue';
import { squareSegments } from '../lib/squares';
import { TONE_META, type ToneLine } from '../lib/tones';
import { useSession } from '../stores/session';
import GlyphIcon from './GlyphIcon.vue';

const props = withDefaults(defineProps<{ lines: readonly ToneLine[]; size?: 'sm' | 'md'; muted?: boolean }>(), { size: 'sm', muted: false });
const session = useSession();
const items = computed(() => props.lines.map((l) => ({ ...l, segs: squareSegments(l.text) })));
</script>

<template>
  <ul class="min-w-0 space-y-1" :class="size === 'md' ? 'text-[15px] leading-snug' : 'text-sm leading-snug'">
    <li v-for="(l, i) in items" :key="i" class="flex gap-2" :data-tone="l.tone" data-testid="tone-line">
      <span
        class="mt-[1px] inline-flex shrink-0 items-center justify-center rounded-full"
        :class="size === 'md' ? 'h-5 w-5' : 'h-[18px] w-[18px]'"
        :style="{ color: TONE_META[l.tone].color, background: TONE_META[l.tone].soft }"
        :title="l.tone === 'neutral' ? undefined : l.tone === 'good' ? 'Good for the side that moved' : 'Bad for the side that moved'"
        aria-hidden="true"
        ><GlyphIcon :name="l.tone" class="block h-[62%] w-[62%]"
      /></span>
      <span class="min-w-0 break-words" :class="muted || l.tone === 'neutral' ? 'text-neutral-300' : 'text-neutral-100'"
        ><template v-for="(s, j) in l.segs" :key="j"
          ><span
            v-if="s.square"
            class="sq-ref"
            :data-square="s.square"
            @mouseenter="session.setHighlight([s.square])"
            @mouseleave="session.setHighlight([])"
            >{{ s.text }}</span
          ><template v-else>{{ s.text }}</template></template
        ></span
      >
    </li>
  </ul>
</template>

<style scoped>
.sq-ref {
  cursor: default;
  border-bottom: 1px dotted rgb(74 46 31 / 0.45);
}
.sq-ref:hover {
  color: #a34a28;
  border-bottom-color: #a34a28;
}
</style>
