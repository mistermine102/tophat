<script setup lang="ts">
// Main line in rows (number | White | Black) with side lines indented under the move they are an alternative to.
import { computed, nextTick, ref, watch } from 'vue';
import { buildMoveRows } from '../lib/moveRows';
import { useSession } from '../stores/session';
import MoveChip from './MoveChip.vue';
import VariationLine from './VariationLine.vue';

const session = useSession();
const items = computed(() => (session.state.tree ? buildMoveRows(session.state.tree) : []));
const scroller = ref<HTMLElement | null>(null);

watch(
  () => session.current.value?.id,
  async (id) => {
    await nextTick();
    const el = scroller.value?.querySelector<HTMLElement>(`[data-node="${id}"]`);
    if (!el || !scroller.value) return;
    const box = scroller.value.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top < box.top + 4 || r.bottom > box.bottom - 4) el.scrollIntoView({ block: 'center' });
  },
);
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col rounded-lg bg-neutral-800/70 ring-1 ring-white/5" data-testid="move-list">
    <div class="flex items-center justify-between px-3 pt-2.5 pb-1.5">
      <span class="text-xs font-semibold uppercase tracking-wide text-neutral-400">Moves</span>
      <button
        v-if="session.state.tree && session.current.value?.ply !== 0"
        class="text-[11px] text-neutral-500 hover:text-neutral-300"
        @click="session.first()"
      >
        Start position
      </button>
    </div>
    <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
      <template v-for="it in items" :key="it.key">
        <div v-if="it.kind === 'row'" class="grid grid-cols-[2.25rem_1fr_1fr] items-center gap-0.5">
          <span class="pr-1 text-right text-xs tabular-nums text-neutral-500">{{ it.number }}.</span>
          <MoveChip v-if="it.white" :node="it.white" block />
          <span v-else class="px-1.5 text-[13px] text-neutral-600">…</span>
          <MoveChip v-if="it.black" :node="it.black" block />
          <span v-else></span>
        </div>
        <div v-else class="my-1 ml-[2.4rem] space-y-1">
          <VariationLine v-for="s in it.starts" :key="s.id" :start="s" :depth="1" />
        </div>
      </template>
    </div>
  </section>
</template>
