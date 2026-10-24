<script setup lang="ts">
// A side line rendered inline (flowing move chips); nested sub-variations are indented below it.
import { computed } from 'vue';
import { moveNumberLabel, sideToMove } from '../lib/chess';
import type { TreeNode } from '../lib/moveTree';
import { useSession } from '../stores/session';
import MoveChip from './MoveChip.vue';

defineOptions({ name: 'VariationLine' });
const props = defineProps<{ start: TreeNode; depth: number }>();
const session = useSession();
const nodes = computed(() => session.state.tree?.lineFrom(props.start) ?? []);
const nested = computed(() => nodes.value.flatMap((n) => n.children.slice(1)));
const numberFor = (n: TreeNode, i: number) =>
  n.fenBefore && (i === 0 || sideToMove(n.fenBefore) === 'white') ? moveNumberLabel(n.fenBefore) : null;
</script>

<template>
  <div class="border-l-2 pl-2" :class="depth > 1 ? 'border-sky-700/40' : 'border-sky-500/50'" data-testid="variation">
    <div class="flex flex-wrap gap-x-0.5 gap-y-0.5">
      <MoveChip v-for="(n, i) in nodes" :key="n.id" :node="n" :number="numberFor(n, i)" />
    </div>
    <div v-if="nested.length" class="mt-0.5 space-y-0.5 pl-2">
      <VariationLine v-for="s in nested" :key="s.id" :start="s" :depth="depth + 1" />
    </div>
  </div>
</template>
