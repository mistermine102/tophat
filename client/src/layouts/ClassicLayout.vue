<script setup lang="ts">
// Classic v1 screen (`?ui=classic`, default): board column (eval bar, board, navigation, eval graph),
// summary + move list, explanation.
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import BoardArea from '../components/BoardArea.vue';
import ExplanationPanel from '../components/ExplanationPanel.vue';
import MoveList from '../components/MoveList.vue';
import SummaryPanel from '../components/SummaryPanel.vue';
import { useSession } from '../stores/session';

const session = useSession();

// Explanation column: back to the top for every new move, and a "More below" hint while text is cut off.
const exCol = ref<HTMLElement | null>(null);
const moreBelow = ref(false);
function updateMore() {
  const el = exCol.value;
  moreBelow.value = !!el && el.scrollHeight - el.scrollTop - el.clientHeight > 12;
}
function scrollMore() {
  exCol.value?.scrollBy({ top: Math.max(120, (exCol.value.clientHeight * 2) / 3), behavior: 'smooth' });
}
let exObserver: ResizeObserver | null = null;
watch(exCol, (el) => {
  exObserver?.disconnect();
  if (!el) return;
  exObserver = new ResizeObserver(updateMore);
  exObserver.observe(el);
  if (el.firstElementChild) exObserver.observe(el.firstElementChild);
});
watch(
  () => session.current.value?.id,
  async () => {
    await nextTick();
    if (exCol.value) exCol.value.scrollTop = 0;
    updateMore();
  },
);
onBeforeUnmount(() => exObserver?.disconnect());
</script>

<template>
  <main class="flex min-h-0 flex-1 gap-4 p-4">
    <BoardArea class="shrink-0" />
    <div class="flex min-h-0 w-[292px] shrink-0 flex-col gap-3">
      <SummaryPanel />
      <MoveList />
    </div>
    <div class="relative min-h-0 min-w-[300px] flex-1">
      <div ref="exCol" class="h-full overflow-y-auto pr-1" @scroll="updateMore">
        <ExplanationPanel />
      </div>
      <template v-if="moreBelow">
        <div class="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#141416] to-transparent"></div>
        <button
          class="absolute bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-neutral-700 px-3 py-1 text-xs font-medium text-neutral-100 shadow-lg ring-1 ring-white/10 hover:bg-neutral-600"
          data-testid="more-below"
          @click="scrollMore"
        >
          More below ↓
        </button>
      </template>
    </div>
  </main>
</template>
