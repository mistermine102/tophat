<script setup lang="ts">
// One move in the move list: SAN + label glyph (or spinner while a side-line move is being analysed).
import { computed } from 'vue';
import { LABELS } from '../lib/labels';
import type { TreeNode } from '../lib/moveTree';
import { useSession } from '../stores/session';
import LabelGlyph from './LabelGlyph.vue';

const props = withDefaults(defineProps<{ node: TreeNode; number?: string | null; block?: boolean; badges?: boolean }>(), {
  number: null,
  block: false,
  badges: false,
});
const session = useSession();
const a = computed(() => session.analysisFor(props.node));
const active = computed(() => session.current.value === props.node);
const pending = computed(() => props.node.mainPly === null && session.isPending(props.node));
const failed = computed(() => !!session.errorFor(props.node));
const severe = computed(() => !!a.value && LABELS[a.value.label].severity >= 3);
// (prototype C) labelled badges: a bigger glyph, errors and great moves tinted with their label colour
const tint = computed(() => (props.badges && a.value && (severe.value || a.value.label === 'great') && !active.value ? { background: `${LABELS[a.value.label].color}22` } : undefined));
</script>

<template>
  <button
    class="group inline-flex items-center gap-1 rounded px-1.5 py-[3px] text-left text-[13px] leading-tight transition"
    :class="[
      block ? 'w-full' : '',
      active ? 'bg-amber-500/25 text-white ring-1 ring-amber-400/60' : 'text-neutral-200 hover:bg-white/10',
    ]"
    :data-node="node.id"
    :data-active="active || undefined"
    :title="a ? LABELS[a.label].name : undefined"
    :style="tint"
    @click="session.goTo(node)"
  >
    <span v-if="number" class="text-neutral-500">{{ number }}</span>
    <span class="font-medium" :style="severe ? { color: LABELS[a!.label].color } : undefined">{{ node.san }}</span>
    <LabelGlyph v-if="a" :label="a.label" :size="badges ? 'md' : 'xs'" class="ml-auto opacity-90 group-hover:opacity-100" />
    <span
      v-else-if="pending"
      class="ml-auto h-3 w-3 animate-spin rounded-full border-2 border-sky-400 border-t-transparent"
      data-testid="move-spinner"
    ></span>
    <span v-else-if="failed" class="ml-auto text-xs text-rose-400" title="Analysis failed">!</span>
  </button>
</template>
