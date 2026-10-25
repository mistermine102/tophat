<script setup lang="ts">
// Prototype B "Coach + replay" (`?ui=b`): a coach card next to the board with the verdict and two buttons —
// "Show me why" replays the move's engine line ON THE BOARD step by step (arrow + ✓ / ✗ marker per move, the step's
// caption right under the board), "Show better move" does the same for the suggested move; then the real position
// comes back. The consequences are a timeline of coloured chips (click one to see that moment).
import { computed, onBeforeUnmount, onMounted } from 'vue';
import BoardView from '../components/BoardView.vue';
import EvalBar from '../components/EvalBar.vue';
import EvalGraph from '../components/EvalGraph.vue';
import GameOverview from '../components/GameOverview.vue';
import LabelGlyph from '../components/LabelGlyph.vue';
import MoveList from '../components/MoveList.vue';
import NavControls from '../components/NavControls.vue';
import StoryChips from '../components/StoryChips.vue';
import SummaryCompact from '../components/SummaryCompact.vue';
import ToneList from '../components/ToneList.vue';
import { isCheckmate, sideToMove } from '../lib/chess';
import { useReplay } from '../lib/replay';
import { levelLines, storyParts, TONE_META } from '../lib/tones';
import { useMove } from '../lib/useMove';
import { BAD, candidatePoints } from '../lib/verdict';
import { useSession } from '../stores/session';

const session = useSession();
const m = useMove(session);
const node = m.node;
const tree = computed(() => session.state.tree);
const replay = useReplay(session);

const evalScore = computed(() => {
  const n = node.value;
  if (!n) return null;
  if (n.ply === 0) return session.state.analyses[1]?.evalBefore ?? null;
  if (m.a.value) return m.a.value.evalAfter;
  return n.mainPly !== null ? (session.state.analyses[n.mainPly + 1]?.evalBefore ?? null) : null;
});
const mated = computed(() => (node.value && isCheckmate(node.value.fen) ? sideToMove(node.value.fen) : null));
const graphPly = computed(() => (node.value && tree.value ? (tree.value.branchPoint(node.value).mainPly ?? 0) : 0));

const story = computed(() => storyParts(m.a.value?.played.explanation?.short));
const rightNow = computed(() => levelLines(m.a.value?.played.explanation?.immediate).filter((_, i) => i !== m.verdict.value?.usedIndex));
const longTerm = computed(() => levelLines(m.a.value?.played.explanation?.long));
const better = m.better;
const betterStory = computed(() => storyParts(better.value?.candidate.explanation?.short));
const betterPoints = computed(() => (better.value ? candidatePoints(better.value.candidate, 3) : []));
const accent = computed(() => m.meta.value?.color ?? '#737373');
const canWhy = computed(() => !!m.a.value && (m.a.value.played.pvUci.length > 1 || story.value.length > 0));

function showWhy() {
  const a = m.a.value;
  if (!a) return;
  const name = m.verdict.value?.name.toLowerCase() ?? '';
  replay.start('why', a, a.played, BAD.has(a.label) ? `Why ${a.san} is ${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}` : `The idea behind ${a.san}`);
}
function showBetter() {
  const a = m.a.value;
  const b = better.value;
  if (a && b) replay.start('better', a, b.candidate, `Better: ${b.candidate.san}`);
}
const activeWhyPart = computed(() => (replay.st.kind === 'why' ? (replay.frame.value?.part ?? null) : null));
const activeBetterPart = computed(() => (replay.st.kind === 'better' ? (replay.frame.value?.part ?? null) : null));

// while a replay runs, the arrow keys step through it and Escape ends it (instead of moving through the game)
function onKey(e: KeyboardEvent) {
  if (!replay.st.kind) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  const act: Record<string, () => void> = { ArrowRight: replay.next, ArrowLeft: replay.prev, Escape: replay.stop, ' ': replay.toggle };
  const f = act[e.key];
  if (f) {
    e.preventDefault();
    e.stopImmediatePropagation();
    f();
  }
}
onMounted(() => window.addEventListener('keydown', onKey, true));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true));
</script>

<template>
  <main class="pb flex min-h-0 flex-1 justify-center gap-4 p-4" data-layout="b">
    <!-- board column -->
    <div class="flex shrink-0 flex-col gap-2">
      <div class="flex gap-2">
        <div class="pb-board-h">
          <EvalBar :score="evalScore" :mated="mated" :orientation="session.state.orientation" :pending="session.isPending(node)" />
        </div>
        <div class="pb-board">
          <BoardView />
        </div>
      </div>
      <!-- replay bar (in place of the navigation while a line is shown) -->
      <div
        v-if="replay.st.kind && replay.frame.value"
        class="pb-row flex h-11 items-center gap-1.5 rounded-lg px-1 ring-1"
        :style="{ background: TONE_META[replay.frame.value.tone].soft, '--tw-ring-color': `${TONE_META[replay.frame.value.tone].color}55` }"
        data-testid="replay-bar"
      >
        <button class="rb-btn" title="Previous step (←)" aria-label="Previous step" :disabled="replay.st.index === 0" @click="replay.prev()">
          <svg viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor"><path d="M14 4v12L5 10z" /></svg>
        </button>
        <button class="rb-btn" :title="replay.st.playing ? 'Pause (space)' : 'Play (space)'" :aria-label="replay.st.playing ? 'Pause' : 'Play'" data-testid="replay-toggle" @click="replay.toggle()">
          <svg v-if="replay.st.playing" viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor"><path d="M5 4h3.5v12H5zM11.5 4H15v12h-3.5z" /></svg>
          <svg v-else viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor"><path d="M6 4v12l9-6z" /></svg>
        </button>
        <button class="rb-btn" title="Next step (→)" aria-label="Next step" :disabled="replay.st.index >= replay.st.frames.length - 1" @click="replay.next()">
          <svg viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor"><path d="M6 4v12l9-6z" /></svg>
        </button>
        <div class="min-w-0 flex-1 px-1.5" data-testid="replay-caption">
          <div class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            <span>{{ replay.st.label }}</span><span class="tabular-nums text-neutral-500">{{ replay.st.index + 1 }}/{{ replay.st.frames.length }}</span>
          </div>
          <div class="flex items-center gap-1.5 truncate text-[14px] font-medium leading-tight" :data-tone="replay.frame.value.tone">
            <span v-if="replay.frame.value.tone !== 'neutral'" class="font-bold" :style="{ color: TONE_META[replay.frame.value.tone].color }">{{ TONE_META[replay.frame.value.tone].icon }}</span>
            <span class="truncate text-neutral-50" :title="replay.frame.value.caption">{{ replay.frame.value.caption }}</span>
          </div>
        </div>
        <button
          class="inline-flex h-9 shrink-0 items-center gap-1 rounded-md bg-neutral-100 px-2.5 text-sm font-semibold text-neutral-900 hover:bg-white"
          data-testid="replay-stop"
          title="Back to the position (Esc)"
          @click="replay.stop()"
        >
          <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 5L3 10l5 5M3 10h9a5 5 0 0 1 5 5" /></svg>
          Back
        </button>
      </div>
      <NavControls
        v-else
        class="pb-row h-11"
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
      <div class="pb-row h-[48px]">
        <EvalGraph
          v-if="session.state.game"
          :moves="session.state.game.moves"
          :analyses="session.state.analyses"
          :current-ply="graphPly"
          @select="(p) => session.goToMainPly(p)"
        />
      </div>
    </div>

    <!-- coach -->
    <div class="min-h-0 min-w-[340px] max-w-[560px] flex-1 overflow-y-auto pr-1" data-testid="explanation">
      <GameOverview v-if="!node || node.ply === 0" />
      <section v-else class="rounded-xl bg-neutral-800/80 ring-1 ring-white/5" data-testid="coach-card">
        <div class="rounded-t-xl border-t-[3px] p-4" :style="{ borderColor: accent }">
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
          <div v-if="m.a.value && m.verdict.value" class="mt-2 flex items-start gap-3" data-testid="verdict" :data-tone="m.verdict.value.tone">
            <LabelGlyph :label="m.a.value.label" size="lg" />
            <p class="min-w-0 pt-0.5 text-[17px] leading-snug text-neutral-50">
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
          <p v-if="m.ruleNote.value" class="mt-1.5 text-xs text-neutral-500">{{ m.ruleNote.value }}</p>

          <div v-if="m.a.value" class="mt-3.5 flex flex-wrap gap-2">
            <button
              v-if="canWhy"
              class="coach-btn"
              :class="replay.st.kind === 'why' ? 'bg-neutral-100 text-neutral-900' : 'bg-neutral-700 text-neutral-50 hover:bg-neutral-600'"
              data-testid="show-why"
              @click="replay.st.kind === 'why' ? replay.stop() : showWhy()"
            >
              <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" /></svg>
              {{ replay.st.kind === 'why' ? 'Stop' : 'Show me why' }}
            </button>
            <button
              v-if="better"
              class="coach-btn"
              :class="replay.st.kind === 'better' ? 'bg-emerald-300 text-neutral-900' : 'bg-emerald-600/90 text-white hover:bg-emerald-500'"
              data-testid="show-better"
              @click="replay.st.kind === 'better' ? replay.stop() : showBetter()"
            >
              <span aria-hidden="true">★</span>
              {{ replay.st.kind === 'better' ? 'Stop' : `Show better move: ${better.candidate.san}` }}
            </button>
          </div>
        </div>

        <div v-if="m.a.value" class="space-y-3.5 border-t border-white/5 p-4 pt-3.5">
          <div v-if="story.length" data-testid="timeline">
            <div class="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              What happens next
              <span class="font-normal normal-case tracking-normal text-neutral-500">engine line · click a step · <b class="text-green-400">✓</b> good / <b class="text-red-400">✗</b> bad for {{ m.moverIsYou.value ? 'you' : m.moverName.value }}</span>
            </div>
            <StoryChips :parts="story" :active="activeWhyPart" clickable @select="(i) => { if (replay.st.kind !== 'why') showWhy(); replay.goToPart(i); }" />
          </div>
          <div v-if="rightNow.length">
            <div class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Right now</div>
            <ToneList :lines="rightNow" />
          </div>
          <div v-if="longTerm.length">
            <div class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Long term</div>
            <ToneList :lines="longTerm" muted />
          </div>
          <div v-if="better" class="rounded-lg bg-emerald-500/[0.07] p-3 ring-1 ring-emerald-500/30" data-testid="better">
            <div class="flex items-center gap-2">
              <span class="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-emerald-400">{{ better.kind === 'pick' ? 'Try instead' : 'Engine’s choice' }}</span>
              <span class="text-[15px] font-bold text-neutral-50">{{ better.candidate.san }}</span>
              <button
                class="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-white/10"
                data-testid="play-better"
                @click="m.playCandidate(better.candidate)"
              >
                <svg viewBox="0 0 16 16" class="h-3 w-3" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" /></svg>
                Play it
              </button>
            </div>
            <p v-if="better.deepOnly" class="mt-1 text-[12px] text-amber-300">Deep engine move — hard to explain: its point lies further ahead.</p>
            <ToneList v-if="betterPoints.length" class="mt-1.5" :lines="betterPoints" />
            <StoryChips v-if="betterStory.length" class="mt-2" :parts="betterStory" :active="activeBetterPart" clickable @select="(i) => { if (replay.st.kind !== 'better') showBetter(); replay.goToPart(i); }" />
          </div>
        </div>
      </section>
    </div>

    <!-- summary + moves -->
    <div class="flex min-h-0 w-[256px] shrink-0 flex-col gap-3">
      <SummaryCompact />
      <MoveList />
    </div>
  </main>
</template>

<style scoped>
@reference "../style.css";
.pb {
  --pb-board: clamp(300px, min(100vh - 204px, 100vw - 760px), 900px);
}
@media (min-width: 1800px) and (min-height: 1000px) {
  .pb {
    --pb-board: clamp(300px, min(100vh - 218px, 100vw - 860px), 900px);
  }
}
.pb-board {
  width: var(--pb-board);
  height: var(--pb-board);
}
.pb-board-h {
  height: var(--pb-board);
}
.pb-row {
  width: calc(var(--pb-board) + 2.25rem);
}
.rb-btn {
  @apply inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-800 text-neutral-200 ring-1 ring-white/5 hover:bg-neutral-700 disabled:opacity-35;
}
.coach-btn {
  @apply inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold shadow transition;
}
</style>
