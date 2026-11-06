<script setup lang="ts">
// "?" button with a popover explaining the label symbols and the eval sign convention; with `board` (layout A) also
// the board's colours and tag icons (lib/consequences.ts): green / red / blue = good / bad / neutral for you.
import type { Color } from '@chess-coach/shared';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { MarkKind, MarkTone } from '../lib/consequences';
import { EVAL_POV_HINT } from '../lib/format';
import { LABEL_ORDER, LABELS } from '../lib/labels';
import { useSession } from '../stores/session';
import LabelGlyph from './LabelGlyph.vue';
import TagIcon from './TagIcon.vue';

const props = withDefaults(defineProps<{ board?: boolean }>(), { board: false });
const session = useSession();
const open = ref(false);
const root = ref<HTMLElement | null>(null);

/** Who "you" are, by name ("coach_tester (Black)"). */
const you = computed(() => {
  const c: Color = session.state.you;
  const side = c === 'white' ? 'White' : 'Black';
  const name = session.state.game?.headers[side];
  return name ? `${name} (${side})` : side;
});
const TONES: { tone: MarkTone; text: string }[] = [
  { tone: 'good', text: 'good for you' },
  { tone: 'bad', text: 'bad for you' },
  { tone: 'neutral', text: 'neutral (a defence, no threat)' },
];
const TAGS: { kind: MarkKind; text: string }[] = [
  { kind: 'hanging', text: 'hanging' },
  { kind: 'danger', text: 'in danger' },
  { kind: 'attacked', text: 'attacked' },
  { kind: 'undefended', text: 'undefended' },
  { kind: 'forked', text: 'forked' },
  { kind: 'pinned', text: 'pinned' },
  { kind: 'skewered', text: 'skewered' },
  { kind: 'trapped', text: 'trapped' },
  { kind: 'defended', text: 'defended' },
  { kind: 'safe', text: 'safe now' },
  { kind: 'mate', text: 'mate in N' },
  { kind: 'missed-mate', text: 'missed mate' },
];
const TONE_BG: Record<MarkTone, string> = { good: 'var(--th-good)', bad: 'var(--th-bad)', neutral: 'var(--th-neutral)' };

function onDoc(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false;
}
watch(open, (v) => {
  if (v) {
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
  } else {
    document.removeEventListener('mousedown', onDoc);
    document.removeEventListener('keydown', onKey);
  }
});
onBeforeUnmount(() => (open.value = false));
</script>

<template>
  <div ref="root" class="relative">
    <button
      class="flex h-5 items-center gap-1 rounded-full border-[1.5px] border-[var(--th-ink)] bg-neutral-800 pl-1.5 pr-2 text-[11px] font-semibold text-neutral-200 hover:bg-neutral-700"
      title="What do the symbols mean?"
      aria-label="Label legend"
      data-testid="legend-button"
      @click="open = !open"
    >
      <span class="font-bold">?</span> Label guide
    </button>
    <div
      v-if="open"
      class="th-panel absolute left-0 top-7 z-30 max-h-[calc(100vh-8rem)] w-[340px] overflow-y-auto p-3 text-left"
      data-testid="legend"
    >
      <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Move labels</div>
      <ul class="space-y-1.5">
        <li v-for="l in LABEL_ORDER" :key="l" class="flex items-start gap-2 text-[12px] leading-snug">
          <LabelGlyph :label="l" size="sm" class="mt-px" />
          <span class="min-w-0">
            <span class="font-semibold" :style="{ color: LABELS[l].color }">{{ LABELS[l].name }}</span>
            <span class="text-neutral-300"> — {{ LABELS[l].rule }}</span>
          </span>
        </li>
      </ul>
      <p class="mt-2.5 border-t border-white/10 pt-2 text-[11px] leading-snug text-neutral-400">
        Win chance is from the point of view of the side that moved. {{ EVAL_POV_HINT }}
      </p>

      <template v-if="props.board">
        <div class="mb-1.5 mt-3 border-t border-white/10 pt-2.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">On the board</div>
        <p class="text-[12px] leading-snug text-neutral-300" data-testid="legend-board">
          Coloured squares, tags and thin arrows show what the move does — from <b class="text-neutral-100">your</b> side,
          whoever made the move. You are <b class="text-neutral-100" data-testid="legend-you">{{ you }}</b>: the side at the
          bottom of the board (flip it to review the game as the other player).
        </p>
        <ul class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          <li v-for="t in TONES" :key="t.tone" class="flex items-center gap-1.5 text-[12px] leading-snug text-neutral-300" :data-legend-tone="t.tone">
            <span class="h-3.5 w-3.5 shrink-0 rounded-[4px]" :style="{ background: TONE_BG[t.tone] }"></span>{{ t.text }}
          </li>
        </ul>
        <ul class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
          <li v-for="t in TAGS" :key="t.kind" class="flex items-center gap-1.5 text-[12px] text-neutral-300">
            <span class="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] bg-[var(--th-ink-soft)] text-[#fff]">
              <TagIcon :kind="t.kind" class="h-[11px] w-[11px]" />
            </span>
            {{ t.text }}
          </li>
        </ul>
        <p class="mt-2 text-[11px] leading-snug text-neutral-400">
          The ✓ / ✗ points next to the board grade the move for the player who made it, like its label.
        </p>
      </template>
    </div>
  </div>
</template>
