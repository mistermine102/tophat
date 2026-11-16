<script setup lang="ts">
// The board for the prototype layouts: chessground + the move's label badge on its destination square (spinner
// while it is analysed), the threat arrow and the "Show best move" arrows (the engine's top moves, as bright as they are good), promotion picker, and previews / replays (session.state.preview: a
// position with its own arrows and a ✓ / ✗ marker). Fills its parent (give the parent a square size).
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { computed, ref } from 'vue';
import { isCheck, legalDests, needsPromotion, sideToMove, uciSquares } from '../lib/chess';
import { type Consequences, moveConsequences } from '../lib/consequences';
import { topArrowShapes } from '../lib/topArrows';
import { useSession } from '../stores/session';
import BoardBadge from './BoardBadge.vue';
import BoardTags from './BoardTags.vue';
import ChessBoard from './ChessBoard.vue';
import PromotionPicker from './PromotionPicker.vue';

// consequences (layout A): what the move does as tinted, tagged squares and thin arrows (lib/consequences.ts)
const props = withDefaults(defineProps<{ arrows?: boolean; consequences?: boolean }>(), { arrows: true, consequences: false });
const session = useSession();
const board = ref<InstanceType<typeof ChessBoard> | null>(null);
const node = computed(() => session.current.value);
const preview = computed(() => session.state.preview);
const analysis = computed(() => session.currentAnalysis.value);
const promotion = ref<{ orig: string; dest: string } | null>(null);

const fen = computed(() => preview.value?.fen ?? node.value?.fen ?? '8/8/8/8/8/8/8/8 w - - 0 1');
const turn = computed(() => sideToMove(fen.value));
const dests = computed(() => (preview.value ? new Map<string, string[]>() : legalDests(fen.value)));
const lastMove = computed(() => {
  const u = preview.value ? preview.value.uci : node.value?.uci;
  return u ? uciSquares(u) : null;
});
const check = computed(() => isCheck(fen.value));

// toned for you (the reviewed player), whoever moved: green = good for you, red = bad, blue = neutral
const cons = computed<Consequences | null>(() =>
  props.consequences && !preview.value && analysis.value ? moveConsequences(analysis.value, session.state.you) : null,
);
const THIN = { good: 'goodThin', bad: 'badThin', neutral: 'neutralThin' } as const;

const threatBrush = computed(() => (analysis.value?.color === session.state.you ? THIN.good : THIN.bad));

// "Show best move" (session.state.showBest): the engine's top moves here, as bright as they are good (lib/topArrows.ts)
const topHereShapes = computed<DrawShape[]>(() => (session.state.showBest && !preview.value ? topArrowShapes(session.topHere.value) : []));
const shapes = computed<DrawShape[]>(() => {
  if (preview.value) return (preview.value.arrows ?? []).map((a) => ({ orig: a.from as Key, dest: a.to as Key, brush: a.brush }));
  const here = topHereShapes.value;
  if (!analysis.value || !props.arrows) return here;
  // (feedback round 3) no big arrows for the best / suggested move (the "Show best move" arrows show the engine's
  // choices when wanted), so no grey "played" arrow to contrast them with either: the threat arrow only
  const suggestions: DrawShape[] = analysis.value.arrows
    .filter((a) => a.kind === 'threat')
    // with consequence marks red means "bad for you": the mover's threat is a thin arrow, green when you made the move
    .map((a) => ({ orig: a.from as Key, dest: a.to as Key, brush: cons.value && a.kind === 'threat' ? threatBrush.value : a.kind }));
  if (!cons.value) return [...suggestions, ...here];
  const thin: DrawShape[] = cons.value.arrows.map((x) => ({ orig: x.from as Key, dest: x.to as Key, brush: THIN[x.tone] }));
  return [...thin, ...suggestions, ...here];
});

/** The badge: the current move's label on its destination square (or the preview's marker). */
const badge = computed(() => {
  const p = preview.value;
  if (p) return p.marker ? { square: p.marker.square, tone: p.marker.tone } : null;
  const n = node.value;
  if (!n || n.ply === 0 || !n.uci) return null;
  const square = n.uci.slice(2, 4);
  const a = analysis.value;
  if (a) return { square, label: a.label };
  if (session.errorFor(n)) return { square, error: true };
  if (session.isPending(n)) return { square, pending: true };
  return null;
});

function onMove(orig: string, dest: string) {
  if (needsPromotion(fen.value, orig, dest)) {
    promotion.value = { orig, dest };
    return;
  }
  if (!session.playMove(orig + dest)) board.value?.sync();
}
function onPromote(role: string) {
  const p = promotion.value;
  promotion.value = null;
  if (p && !session.playMove(p.orig + p.dest + role)) board.value?.sync();
}
function cancelPromotion() {
  promotion.value = null;
  board.value?.sync();
}
</script>

<template>
  <div class="relative h-full w-full">
    <ChessBoard
      ref="board"
      :fen="fen"
      :orientation="session.state.orientation"
      :turn-color="turn"
      :dests="dests"
      :last-move="lastMove"
      :check="check"
      :shapes="shapes"
      :movable="!preview && !promotion"
      :highlight="session.state.highlight"
      :marks="cons?.marks ?? []"
      @move="onMove"
    />
    <BoardBadge
      :square="badge?.square ?? ''"
      :orientation="session.state.orientation"
      :label="badge && 'label' in badge ? badge.label : null"
      :pending="!!badge && 'pending' in badge"
      :error="!!badge && 'error' in badge"
      :tone="badge && 'tone' in badge ? badge.tone : null"
    />
    <BoardTags v-if="cons" :marks="cons.marks" :orientation="session.state.orientation" />
    <PromotionPicker v-if="promotion" :color="turn" @pick="onPromote" @cancel="cancelPromotion" />
    <div v-if="preview" class="pointer-events-none absolute -inset-[3px] z-10 rounded-[3px] ring-[3px] ring-sky-400/80"></div>
  </div>
</template>
