<script setup lang="ts">
// Prototype A "Board-first" (`?ui=a`): a big board with the label badge on the moved piece; the verdict bubble sits
// right at the board's edge, level with the moved piece's row (its tail points at that rank), with 2–3 ✓ / ✗ key
// points, the better move and a "Details" expander; summary + move list compact on the right; eval bar and graph kept.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import BoardView from '../components/BoardView.vue';
import EvalBar from '../components/EvalBar.vue';
import EvalGraph from '../components/EvalGraph.vue';
import GameOverview from '../components/GameOverview.vue';
import LabelGlyph from '../components/LabelGlyph.vue';
import MoveList from '../components/MoveList.vue';
import NavControls from '../components/NavControls.vue';
import SummaryCompact from '../components/SummaryCompact.vue';
import ToneLevels from '../components/ToneLevels.vue';
import ToneList from '../components/ToneList.vue';
import { isCheckmate, sideToMove } from '../lib/chess';
import { useMove } from '../lib/useMove';
import { candidatePoints } from '../lib/verdict';
import { useSession } from '../stores/session';

const session = useSession();
const m = useMove(session);
const node = m.node;
const tree = computed(() => session.state.tree);
const showDetails = ref(false);

// --- eval bar / graph (as in the classic board column) ---
const evalScore = computed(() => {
  const n = node.value;
  if (!n) return null;
  if (n.ply === 0) return session.state.analyses[1]?.evalBefore ?? null;
  if (m.a.value) return m.a.value.evalAfter;
  return n.mainPly !== null ? (session.state.analyses[n.mainPly + 1]?.evalBefore ?? null) : null;
});
const mated = computed(() => (node.value && isCheckmate(node.value.fen) ? sideToMove(node.value.fen) : null));
const graphPly = computed(() => (node.value && tree.value ? (tree.value.branchPoint(node.value).mainPly ?? 0) : 0));

// --- the bubble follows the moved piece's row ---
const boardEl = ref<HTMLElement | null>(null);
const colEl = ref<HTMLElement | null>(null);
const bubbleEl = ref<HTMLElement | null>(null);
/** The bubble's content at its natural height (the card around it may be capped and scroll). */
const contentEl = ref<HTMLElement | null>(null);
const boardPx = ref(0);
const colPx = ref(0);
const bubblePx = ref(0);
let ro: ResizeObserver | null = null;
function measure() {
  boardPx.value = boardEl.value?.clientHeight ?? 0;
  colPx.value = colEl.value?.clientHeight ?? 0;
  // natural height (+ the card's 1px ring), so a capped card doesn't feed back into its own position
  bubblePx.value = Math.min(colPx.value, (contentEl.value?.offsetHeight ?? 0) + 2);
}
onMounted(() => {
  ro = new ResizeObserver(measure);
  for (const el of [boardEl.value, colEl.value]) if (el) ro.observe(el);
  measure();
});
watch(contentEl, (el, old) => {
  if (old) ro?.unobserve(old);
  if (el) ro?.observe(el);
  measure();
});
onBeforeUnmount(() => ro?.disconnect());

const anchorY = computed(() => {
  const n = node.value;
  const sq = boardPx.value / 8;
  if (!n?.uci || !sq) return sq * 4;
  const rank = Number(n.uci[3]) - 1;
  const row = session.state.orientation === 'white' ? 7 - rank : rank;
  return (row + 0.5) * sq;
});
const bubbleTop = computed(() => Math.max(0, Math.min(anchorY.value - 30, colPx.value - bubblePx.value)));
const tailY = computed(() => Math.max(16, Math.min(anchorY.value - bubbleTop.value, bubblePx.value - 16)));

const better = m.better;
const betterPoints = computed(() => (better.value ? candidatePoints(better.value.candidate, 2) : []));
const accent = computed(() => m.meta.value?.color ?? '#737373');
</script>

<template>
  <main class="pa flex min-h-0 flex-1 justify-center gap-4 p-4" data-layout="a">
    <!-- board column -->
    <div class="flex shrink-0 flex-col gap-2">
      <div class="flex gap-2">
        <div class="pa-board-h">
          <EvalBar :score="evalScore" :mated="mated" :orientation="session.state.orientation" :pending="session.isPending(node)" />
        </div>
        <div ref="boardEl" class="pa-board">
          <BoardView />
        </div>
      </div>
      <NavControls
        class="pa-row"
        :can-prev="!!node?.parent"
        :can-next="!!node?.children.length"
        :in-side-line="!!tree?.inSideLine"
        :can-mistake="session.nextMistakePly.value !== null"
        @first="session.first()"
        @prev="session.prev()"
        @next="session.next()"
        @last="session.last()"
        @flip="session.flip()"
        @back="session.backToGame()"
        @mistake="session.nextMistake()"
      />
      <div class="pa-row h-[52px]">
        <EvalGraph
          v-if="session.state.game"
          :moves="session.state.game.moves"
          :analyses="session.state.analyses"
          :current-ply="graphPly"
          @select="(p) => session.goToMainPly(p)"
        />
      </div>
    </div>

    <!-- verdict bubble, level with the moved piece -->
    <div ref="colEl" class="relative min-h-0 min-w-[330px] max-w-[620px] flex-1" data-testid="explanation">
      <div v-if="!node || node.ply === 0" class="h-full overflow-y-auto pr-1">
        <GameOverview />
      </div>
      <div
        v-else
        ref="bubbleEl"
        class="pa-bubble absolute inset-x-0"
        :style="{ top: `${bubbleTop}px`, '--accent': accent }"
        data-testid="verdict-bubble"
      >
        <span class="pa-tail" :style="{ top: `${tailY}px` }" aria-hidden="true"></span>
        <div class="pa-card overflow-y-auto rounded-xl border-l-[3px] bg-neutral-800" :style="{ borderColor: accent, maxHeight: `${Math.max(160, colPx - bubbleTop)}px` }">
          <div ref="contentEl" class="p-3.5 pl-3">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-neutral-400">
            <span class="text-[13px] font-semibold text-neutral-200">{{ m.moveName.value }}</span>
            <span
              class="rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide"
              :class="m.moverIsYou.value ? 'bg-amber-500/15 text-amber-300' : 'bg-neutral-700 text-neutral-300'"
              >{{ m.moverIsYou.value ? 'You' : 'Opponent' }}</span
            >
            <span v-if="node.mainPly === null" class="rounded bg-sky-500/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-sky-300">Side line</span>
            <span v-if="m.evalChange.value" class="ml-auto tabular-nums" title="Engine evaluation from White's side (+ = White better)" data-testid="eval-change">
              eval {{ m.evalChange.value.before }} → <b class="text-neutral-200">{{ m.evalChange.value.after }}</b>
            </span>
          </div>

          <!-- verdict -->
          <div v-if="m.a.value && m.verdict.value" class="mt-2 flex items-start gap-2.5" data-testid="verdict">
            <LabelGlyph :label="m.a.value.label" size="lg" />
            <p class="min-w-0 pt-0.5 text-[16px] leading-snug text-neutral-50">
              <b :style="{ color: accent }" data-testid="label-name">{{ m.verdict.value.name }}</b>
              <span class="text-neutral-500"> — </span>{{ m.verdict.value.sentence }}
            </p>
          </div>
          <div v-else-if="m.error.value" class="mt-2 text-sm text-rose-300" data-testid="ply-error">
            <p>The analysis of this move failed: {{ m.error.value }}</p>
            <button class="mt-1.5 rounded-md bg-neutral-700 px-2.5 py-1 text-xs font-medium text-neutral-100 hover:bg-neutral-600" data-testid="retry" @click="m.retry()">Try again</button>
          </div>
          <p v-else class="mt-2 flex items-center gap-2 text-[15px] text-neutral-300">
            <span class="h-4 w-4 animate-spin rounded-full border-2 border-neutral-500 border-t-transparent"></span>
            Analysing {{ m.moveName.value }}…
          </p>

          <template v-if="m.a.value">
            <ToneList v-if="m.points.value.length" class="mt-2.5" :lines="m.points.value" data-testid="key-points" />
            <p v-if="m.ruleNote.value" class="mt-2 text-xs text-neutral-500">{{ m.ruleNote.value }}</p>

            <!-- the better move -->
            <div v-if="better" class="mt-3 rounded-lg bg-emerald-500/[0.08] p-2.5 ring-1 ring-emerald-500/30" data-testid="better">
              <div class="flex items-center gap-2">
                <span class="text-[11px] font-semibold uppercase tracking-wide text-emerald-400">Better</span>
                <button
                  class="rounded px-1 text-[15px] font-bold text-neutral-50 hover:bg-white/10"
                  :title="`Show ${better.candidate.san} on the board`"
                  @mouseenter="m.previewCandidate(better.candidate)"
                  @mouseleave="session.setPreview(null)"
                  @click="m.playCandidate(better.candidate)"
                >
                  {{ better.candidate.san }}
                </button>
                <button
                  class="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-white/10"
                  data-testid="play-better"
                  :title="`Play ${better.candidate.san} on the board as a side line`"
                  @click="m.playCandidate(better.candidate)"
                >
                  <svg viewBox="0 0 16 16" class="h-3 w-3" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" /></svg>
                  Play it
                </button>
              </div>
              <p v-if="better.deepOnly" class="mt-1 text-[12px] text-amber-300">Deep engine move — hard to explain: its point lies further ahead.</p>
              <ToneList v-if="betterPoints.length" class="mt-1.5" :lines="betterPoints" />
            </div>
            <p v-else-if="m.a.value.verdictText && m.a.value.label !== 'book' && m.a.value.label !== 'forced'" class="mt-2.5 text-sm font-medium text-emerald-400">✓ {{ m.a.value.verdictText }}</p>

            <button
              class="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-neutral-400 hover:text-neutral-200"
              :aria-expanded="showDetails"
              data-testid="details-toggle"
              @click="showDetails = !showDetails"
            >
              <svg viewBox="0 0 12 12" class="h-3 w-3 transition" :class="showDetails ? 'rotate-90' : ''" fill="currentColor"><path d="M4 2l5 4-5 4z" /></svg>
              {{ showDetails ? 'Hide details' : 'Details: right now · next moves · long term' }}
            </button>
            <div v-if="showDetails" class="mt-2 border-t border-white/5 pt-2.5" data-testid="details">
              <p class="mb-2.5 text-xs text-neutral-400" data-testid="label-reason">{{ m.reason.value }}</p>
              <ToneLevels :explanation="m.a.value.played.explanation" :skip-immediate="m.verdict.value?.usedIndex != null ? [m.verdict.value.usedIndex] : []" />
            </div>
          </template>
          </div>
        </div>
      </div>
    </div>

    <!-- summary + moves -->
    <div class="flex min-h-0 w-[272px] shrink-0 flex-col gap-3 min-[1800px]:w-[300px]">
      <SummaryCompact />
      <MoveList />
    </div>
  </main>
</template>

<style scoped>
.pa {
  --pa-board: clamp(300px, min(100vh - 200px, 100vw - 770px), 900px);
}
@media (min-width: 1800px) and (min-height: 1000px) {
  .pa {
    --pa-board: clamp(300px, min(100vh - 214px, 100vw - 860px), 900px);
  }
}
.pa-board {
  width: var(--pa-board);
  height: var(--pa-board);
}
.pa-board-h {
  height: var(--pa-board);
}
.pa-row {
  width: calc(var(--pa-board) + 2.25rem);
}
.pa-bubble {
  transition: top 220ms ease-out;
}
.pa-card {
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent),
    0 12px 30px rgba(0, 0, 0, 0.45);
}
.pa-tail {
  position: absolute;
  left: -7px;
  width: 14px;
  height: 14px;
  margin-top: -7px;
  transform: rotate(45deg);
  background: var(--accent);
  border-radius: 2px;
  transition: top 220ms ease-out;
}
</style>
