<script setup lang="ts">
// Explanation for the move that led to the current position: label + reason, eval change, three levels,
// "Try this" / "Engine's top".
import { computed } from 'vue';
import { isCheckmate, isStalemate, moveNumberLabel, sideToMove } from '../lib/chess';
import { EVAL_POV_HINT, formatPercent, formatPositionEval, positionVerdict } from '../lib/format';
import { CONFIRMED, LABELS } from '../lib/labels';
import { isMateLabel, isMaterialLabel, labelReasonText, sideName } from '../lib/reason';
import { useSession } from '../stores/session';
import CandidateCard from './CandidateCard.vue';
import LabelGlyph from './LabelGlyph.vue';
import GameOverview from './GameOverview.vue';
import LevelList from './LevelList.vue';

const session = useSession();
const node = computed(() => session.current.value);
const a = computed(() => session.currentAnalysis.value);
const pending = computed(() => session.isPending(node.value));
const error = computed(() => session.errorFor(node.value));

const moverIsYou = computed(() => !!a.value && a.value.color === session.state.you);
const prevMove = computed(() => {
  const p = node.value?.parent;
  return p && p.ply > 0 && p.fenBefore ? `${moveNumberLabel(p.fenBefore)} ${p.san}` : null;
});
const reason = computed(() => (a.value ? labelReasonText(a.value, { moverIsYou: moverIsYou.value, prevMove: prevMove.value }) : ''));
const meta = computed(() => (a.value ? LABELS[a.value.label] : null));
const mated = computed(() => (a.value && isCheckmate(a.value.fenAfter) ? sideToMove(a.value.fenAfter) : null));
const stalemate = computed(() => !!a.value && !mated.value && isStalemate(a.value.fenAfter));
const confirmed = computed(() => !!a.value && CONFIRMED.has(a.value.label));
const ex = computed(() => a.value?.played.explanation);

/** What to show under "Try this" / "Engine's top". */
const suggestions = computed(() => {
  const x = a.value;
  if (!x) return { pick: null, best: null, deepOnly: false };
  const playedIsBest = x.best.uci === x.uci;
  // SPEC: no suggestions for Book / Forced moves; Best / Great are confirmed (engine's top shown if it differs)
  if (x.label === 'book' || x.label === 'forced') return { pick: null, best: null, deepOnly: false };
  if (confirmed.value) return { pick: null, best: playedIsBest ? null : x.best, deepOnly: false };
  if (x.deepOnly || !x.pick) return { pick: null, best: playedIsBest ? null : x.best, deepOnly: !playedIsBest };
  // Never suggest the move that was actually played.
  const pick = x.pick.uci === x.uci ? null : x.pick;
  return { pick, best: (pick && x.pickIsBest) || playedIsBest ? null : x.best, deepOnly: false };
});

</script>

<template>
  <div class="flex min-h-0 flex-col gap-3" data-testid="explanation">
    <!-- Start position: game overview -->
    <GameOverview v-if="node && node.ply === 0" />

    <template v-else-if="node">
      <section class="rounded-lg bg-neutral-800/70 p-3.5 ring-1 ring-white/5" data-testid="label-card">
        <div class="flex items-start gap-3">
          <LabelGlyph v-if="a" :label="a.label" size="lg" />
          <span v-else class="mt-0.5 inline-block h-8 w-8 shrink-0 rounded-full bg-neutral-700"></span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-baseline gap-x-2">
              <span class="text-lg font-bold" :style="{ color: meta?.color ?? '#d4d4d4' }" data-testid="label-name">
                {{ meta ? meta.name : pending ? 'Analysing…' : error ? 'Analysis failed' : 'Not analysed' }}
              </span>
              <span class="text-base font-semibold text-neutral-100">
                {{ node.fenBefore ? moveNumberLabel(node.fenBefore) : '' }} {{ node.san }}
              </span>
              <span
                class="rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide"
                :class="node.color === session.state.you ? 'bg-amber-500/15 text-amber-300' : 'bg-neutral-700 text-neutral-300'"
              >
                {{ node.color === session.state.you ? 'You' : 'Opponent' }}
              </span>
              <span v-if="node.mainPly === null" class="rounded bg-sky-500/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-sky-300">
                Side line
              </span>
            </div>
            <p v-if="a" class="mt-1 text-sm leading-snug text-neutral-300" data-testid="label-reason">
              {{ reason }}
              <span v-if="isMateLabel(a)" class="block pt-0.5 text-xs text-neutral-500" data-testid="mate-rule-note">
                Winning chances alone would say “{{ LABELS[a.labelReason.winChance].name }}”. It’s marked {{ meta?.name }} because it
                {{ a.labelReason.allowedMate && a.label === 'blunder' ? 'allows a quick forced mate' : 'misses a quick forced mate' }} — worth noticing even when the game is decided.
              </span>
              <span v-else-if="isMaterialLabel(a)" class="block pt-0.5 text-xs text-neutral-500">
                Winning chances alone would say “{{ LABELS[a.labelReason.winChance].name }}”. It’s marked {{ meta?.name }} because it
                gives away material for nothing — a habit worth fixing even when the game is decided.
              </span>
            </p>
            <div v-else-if="error" class="mt-1 text-sm text-rose-300" data-testid="ply-error">
              <p>The analysis of this move failed: {{ error }}</p>
              <p v-if="session.state.health && !session.state.health.ok" class="mt-0.5 text-xs text-rose-300/80">
                The engine is not running ({{ session.state.health.error ?? 'unknown reason' }}).
              </p>
              <button
                class="mt-1.5 rounded-md bg-neutral-700 px-2.5 py-1 text-xs font-medium text-neutral-100 hover:bg-neutral-600"
                data-testid="retry"
                @click="node.mainPly !== null ? session.retryPly(node.mainPly) : session.retrySide(node)"
              >
                Try again
              </button>
            </div>
            <p v-else-if="pending" class="mt-1 flex items-center gap-2 text-sm text-neutral-400">
              <span class="h-3 w-3 animate-spin rounded-full border-2 border-neutral-500 border-t-transparent"></span>
              {{ node.mainPly === null ? 'Analysing your move…' : 'Analysing this move now — usually a few seconds.' }}
            </p>
          </div>
        </div>
        <div v-if="a" class="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]" data-testid="eval-change">
          <span class="cursor-help text-neutral-400" :title="EVAL_POV_HINT" data-testid="eval-white">
            Eval <span class="text-neutral-500">(White)</span>{{ ' ' }}
            <span class="font-semibold tabular-nums text-neutral-100">{{ formatPositionEval(a.evalBefore, null) }}</span>
            →
            <span class="font-semibold tabular-nums text-neutral-100">{{ stalemate ? '½-½' : formatPositionEval(a.evalAfter, mated) }}</span>
            <span class="text-neutral-500"> · {{ stalemate ? 'draw by stalemate' : positionVerdict(a.evalAfter, mated) }}</span>
          </span>
          <span class="text-neutral-400" data-testid="win-chance" title="Winning chances of the side that moved (Lichess formula); the label is based on how much of it the move lost compared with the best move.">
            {{ sideName(a.color) }}’s win chance
            <span class="tabular-nums text-neutral-200">{{ formatPercent(a.winBefore, 0) }} → {{ formatPercent(mated ? 100 : a.winAfter, 0) }}</span>
          </span>
          <span class="text-neutral-400">Accuracy <span class="tabular-nums text-neutral-200">{{ Math.round(a.accuracy) }}%</span></span>
        </div>
        <div v-if="a && ex" class="mt-3 space-y-2.5 border-t border-white/5 pt-3" data-testid="levels">
          <div v-if="confirmed && a.verdictText" class="text-sm font-medium text-emerald-400" data-testid="verdict">
            ✓ {{ a.verdictText }}
          </div>
          <LevelList title="Immediate" :level="ex.immediate" />
          <LevelList title="Short term" :level="ex.short" />
          <LevelList title="Long term" :level="ex.long" />
        </div>
      </section>

      <div v-if="a" class="space-y-3">
        <CandidateCard
          v-if="suggestions.pick"
          kind="pick"
          title="Try this"
          :candidate="suggestions.pick"
          :analysis="a"
          :from="node.parent"
        />
        <CandidateCard
          v-if="suggestions.best"
          kind="best"
          title="Engine’s top"
          :candidate="suggestions.best"
          :analysis="a"
          :from="node.parent"
          :notice="suggestions.deepOnly ? 'Deep engine move — hard to explain: its real point lies further ahead than the lines below. No simpler good move with a clear short-term point was found.' : null"
        />
      </div>
    </template>
  </div>
</template>

