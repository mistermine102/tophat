<script setup lang="ts">
// Prototype C "Good vs bad" (`?ui=c`): one coloured chip with the label, move and eval change; the verdict; then the
// explanation sorted into "What goes wrong ✗" and "What it does ✓" (bad moves: what goes wrong first); a "Better: …"
// card with its one ✓ sentence and a Play button; a move list with labelled badges.
import { computed } from 'vue';
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
import { pvSteps } from '../lib/pv';
import { levelLines, lowerFirst, storyParts, storyResult, TONE_META, type ToneLine } from '../lib/tones';
import { useMove } from '../lib/useMove';
import { BAD, candidateSentence } from '../lib/verdict';
import { useSession } from '../stores/session';

const session = useSession();
const m = useMove(session);
const node = m.node;
const tree = computed(() => session.state.tree);

const evalScore = computed(() => {
  const n = node.value;
  if (!n) return null;
  if (n.ply === 0) return session.state.analyses[1]?.evalBefore ?? null;
  if (m.a.value) return m.a.value.evalAfter;
  return n.mainPly !== null ? (session.state.analyses[n.mainPly + 1]?.evalBefore ?? null) : null;
});
const mated = computed(() => (node.value && isCheckmate(node.value.fen) ? sideToMove(node.value.fen) : null));
const graphPly = computed(() => (node.value && tree.value ? (tree.value.branchPoint(node.value).mainPly ?? 0) : 0));

const ex = computed(() => m.a.value?.played.explanation);
const story = computed(() => storyParts(ex.value?.short));
/** Every sentence of the three levels, the short line as its result only (the chips below show the whole story). */
const all = computed(() => {
  // the verdict's own sentence is already shown above the blocks
  const imm = levelLines(ex.value?.immediate).filter((_, i) => i !== m.verdict.value?.usedIndex);
  const res = storyResult(story.value);
  // (a short level without a story only says "No forcing follow-up" or similar: left out unless it helps or hurts)
  const short: ToneLine[] = res ? [{ text: `In the engine line: ${lowerFirst(res.text)}.`, tone: res.tone }] : story.value.length ? [] : levelLines(ex.value?.short).filter((l) => l.tone !== 'neutral');
  const long = levelLines(ex.value?.long);
  return [...imm, ...short, ...long];
});
const badLines = computed(() => all.value.filter((l) => l.tone === 'bad'));
const goodLines = computed(() => all.value.filter((l) => l.tone === 'good'));
// neutral sentences of the Immediate level only (a neutral long-term line is filler: "There is a forced mate, so …")
const neutralLines = computed(() => levelLines(ex.value?.immediate).filter((l, i) => l.tone === 'neutral' && i !== m.verdict.value?.usedIndex));
/** The story's moves (its result is already in a block above). */
const storySteps = computed(() => (storyResult(story.value) ? story.value.slice(0, -1) : story.value).filter((p, i, arr) => !(p.text === '…' && i === arr.length - 1)));
const badFirst = computed(() => !!m.a.value && BAD.has(m.a.value.label));
const mover = computed(() => (m.moverIsYou.value ? 'you' : m.moverName.value));

const better = m.better;
// (round 10) one sentence for the better move
const betterPoints = computed(() => {
  const s = better.value ? candidateSentence(better.value.candidate) : null;
  return s ? [s] : [];
});
const betterSteps = computed(() => (better.value && m.a.value ? pvSteps(m.a.value.fenBefore, better.value.candidate.pvUci, 8) : []));
const accent = computed(() => m.meta.value?.color ?? '#737373');
</script>

<template>
  <main class="pc flex min-h-0 flex-1 justify-center gap-4 p-4" data-layout="c">
    <!-- board column -->
    <div class="flex shrink-0 flex-col gap-2">
      <div class="flex gap-2">
        <div class="pc-board-h">
          <EvalBar :score="evalScore" :mated="mated" :orientation="session.state.orientation" :pending="session.isPending(node)" />
        </div>
        <div class="pc-board">
          <BoardView />
        </div>
      </div>
      <NavControls
        class="pc-row"
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
      <div class="pc-row h-[48px]">
        <EvalGraph
          v-if="session.state.game"
          :moves="session.state.game.moves"
          :analyses="session.state.analyses"
          :current-ply="graphPly"
          @select="(p) => session.goToMainPly(p)"
        />
      </div>
    </div>

    <!-- good vs bad -->
    <div class="min-h-0 min-w-[340px] max-w-[580px] flex-1 overflow-y-auto pr-1" data-testid="explanation">
      <GameOverview v-if="!node || node.ply === 0" />
      <div v-else class="space-y-3">
        <!-- one chip: label · move · eval change -->
        <div class="flex items-center gap-2">
          <div
            class="inline-flex min-w-0 items-center gap-2 rounded-full py-1 pl-1 pr-3.5 ring-1"
            :style="{ background: `${accent}26`, '--tw-ring-color': `${accent}80` }"
            data-testid="label-chip"
          >
            <LabelGlyph v-if="m.a.value" :label="m.a.value.label" size="md" />
            <span v-else class="ml-1 h-4 w-4 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent"></span>
            <b class="text-[15px]" :style="{ color: m.a.value ? accent : '#d4d4d4' }" data-testid="label-name">{{ m.verdict.value?.name ?? (m.error.value ? 'Failed' : 'Analysing…') }}</b>
            <span class="text-[15px] font-semibold text-neutral-100">{{ m.moveName.value }}</span>
            <span v-if="m.evalChange.value" class="text-[13px] tabular-nums text-neutral-300" title="Engine evaluation from White's side (+ = White better)" data-testid="eval-change">
              {{ m.evalChange.value.before }} → <b class="text-neutral-50">{{ m.evalChange.value.after }}</b>
            </span>
          </div>
          <span
            class="rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide"
            :class="m.moverIsYou.value ? 'bg-amber-500/15 text-amber-300' : 'bg-neutral-700 text-neutral-300'"
            >{{ m.moverIsYou.value ? 'You' : 'Opponent' }}</span
          >
          <span v-if="node.mainPly === null" class="rounded bg-sky-500/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-sky-300">Side line</span>
        </div>

        <p v-if="m.verdict.value" class="flex items-start gap-2 text-[16px] leading-snug text-neutral-50" data-testid="verdict" :data-tone="m.verdict.value.tone">
          <span
            v-if="m.verdict.value.tone !== 'neutral'"
            class="mt-px inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-bold"
            :style="{ color: TONE_META[m.verdict.value.tone].color, background: TONE_META[m.verdict.value.tone].soft }"
            aria-hidden="true"
            >{{ TONE_META[m.verdict.value.tone].icon }}</span
          >
          <span>{{ m.verdict.value.sentence ? m.verdict.value.sentence.charAt(0).toUpperCase() + m.verdict.value.sentence.slice(1) : `${m.verdict.value.name}.` }}</span>
        </p>
        <div v-else-if="m.error.value" class="text-sm text-rose-300" data-testid="ply-error">
          <p>The analysis of this move failed: {{ m.error.value }}</p>
          <button class="mt-1.5 rounded-md bg-neutral-700 px-2.5 py-1 text-xs font-medium text-neutral-100 hover:bg-neutral-600" data-testid="retry" @click="m.retry()">Try again</button>
        </div>
        <p v-else class="text-sm text-neutral-400">Analysing this move — usually a few seconds.</p>
        <!-- (D1) a quick label whose full analysis failed / is still coming -->
        <div v-if="m.a.value?.provisional && m.error.value" class="text-sm text-rose-300" data-testid="ply-error">
          <p>The analysis of this move failed: {{ m.error.value }}</p>
          <button class="mt-1.5 rounded-md bg-neutral-700 px-2.5 py-1 text-xs font-medium text-neutral-100 hover:bg-neutral-600" data-testid="retry" @click="m.retry()">Try again</button>
        </div>
        <p v-else-if="m.a.value?.provisional" class="flex items-center gap-2 text-xs text-neutral-400" data-testid="provisional">
          <span class="h-3 w-3 animate-spin rounded-full border-2 border-neutral-500 border-t-transparent"></span>
          Working out why…
        </p>
        <p v-if="m.ruleNote.value" class="text-xs text-neutral-500">{{ m.ruleNote.value }}</p>

        <template v-if="m.a.value">
          <div class="flex flex-col gap-3" :class="badFirst ? '' : 'flex-col-reverse'">
            <section v-if="badLines.length" class="rounded-lg bg-rose-500/[0.07] p-3 ring-1 ring-rose-500/25" data-testid="block-bad">
              <div class="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-rose-300">
                ✗ {{ badFirst ? 'What goes wrong' : 'Drawbacks' }} <span class="font-normal normal-case tracking-normal text-rose-300/60">· for {{ mover }}</span>
              </div>
              <ToneList :lines="badLines" />
            </section>
            <section v-if="goodLines.length" class="rounded-lg bg-emerald-500/[0.06] p-3 ring-1 ring-emerald-500/20" data-testid="block-good">
              <div class="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-emerald-300">
                ✓ What it does well <span class="font-normal normal-case tracking-normal text-emerald-300/60">· for {{ mover }}</span>
              </div>
              <ToneList :lines="goodLines" />
            </section>
          </div>
          <div v-if="neutralLines.length" class="px-1" data-testid="block-neutral">
            <ToneList :lines="neutralLines" muted />
          </div>
          <div v-if="storySteps.length" class="px-1" data-testid="timeline">
            <div class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">How it plays out</div>
            <StoryChips :parts="storySteps" />
          </div>

          <section v-if="better" class="rounded-lg bg-neutral-800/80 p-3 ring-1 ring-emerald-500/40" data-testid="better">
            <div class="flex items-center gap-2">
              <span class="text-[12px] font-bold uppercase tracking-wide text-emerald-400">Better</span>
              <button
                class="rounded px-1 text-[17px] font-bold text-neutral-50 hover:bg-white/10"
                :title="`Show ${better.candidate.san} on the board`"
                @mouseenter="m.previewCandidate(better.candidate)"
                @mouseleave="session.setPreview(null)"
                @click="m.playCandidate(better.candidate)"
              >
                {{ better.candidate.san }}
              </button>
              <button
                class="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-500"
                data-testid="play-better"
                :title="`Play ${better.candidate.san} on the board as a side line (it gets analysed too)`"
                @click="m.playCandidate(better.candidate)"
              >
                <svg viewBox="0 0 16 16" class="h-3 w-3" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" /></svg>
                Play {{ better.candidate.san }}
              </button>
            </div>
            <p v-if="better.deepOnly" class="mt-1 text-[12px] text-amber-300">Deep engine move — hard to explain: its point lies further ahead.</p>
            <ToneList v-if="betterPoints.length" class="mt-2" :lines="betterPoints" />
            <div v-if="betterSteps.length > 1" class="mt-2 flex flex-wrap items-center gap-x-0.5 gap-y-1 text-[12px]" data-testid="pv">
              <span class="mr-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Line</span>
              <button
                v-for="(s, i) in betterSteps"
                :key="i"
                class="rounded px-1 py-px text-neutral-300 hover:bg-white/10 hover:text-white"
                title="Hover to see it on the board, click to play the line up to here"
                @mouseenter="m.previewCandidate(better.candidate, i)"
                @mouseleave="session.setPreview(null)"
                @click="m.playCandidate(better.candidate, i + 1)"
              >
                <span v-if="s.number" class="text-neutral-500">{{ s.number }}</span>{{ s.san }}
              </button>
            </div>
          </section>
          <p v-else-if="m.a.value.verdictText && m.a.value.label !== 'book' && m.a.value.label !== 'forced'" class="text-sm font-medium text-emerald-400">✓ {{ m.a.value.verdictText }}</p>
        </template>
      </div>
    </div>

    <!-- summary + moves with labelled badges -->
    <div class="flex min-h-0 w-[264px] shrink-0 flex-col gap-3">
      <SummaryCompact />
      <MoveList badges />
    </div>
  </main>
</template>

<style scoped>
.pc {
  --pc-board: clamp(300px, min(100vh - 196px, 100vw - 760px), 900px);
}
@media (min-width: 1800px) and (min-height: 1000px) {
  .pc {
    --pc-board: clamp(300px, min(100vh - 210px, 100vw - 880px), 900px);
  }
}
.pc-board {
  width: var(--pc-board);
  height: var(--pc-board);
}
.pc-board-h {
  height: var(--pc-board);
}
.pc-row {
  width: calc(var(--pc-board) + 2.25rem);
}
</style>
