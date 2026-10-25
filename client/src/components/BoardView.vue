<script setup lang="ts">
// The board for the prototype layouts: chessground + the move's label badge on its destination square (spinner
// while it is analysed), suggestion arrows, promotion picker, and previews / replays (session.state.preview: a
// position with its own arrows and a ✓ / ✗ marker). Fills its parent (give the parent a square size).
import type { Arrow } from '@chess-coach/shared';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { computed, ref } from 'vue';
import { isCheck, legalDests, needsPromotion, sideToMove, uciSquares } from '../lib/chess';
import { useSession } from '../stores/session';
import BoardBadge from './BoardBadge.vue';
import ChessBoard from './ChessBoard.vue';
import PromotionPicker from './PromotionPicker.vue';

const props = withDefaults(defineProps<{ arrows?: boolean }>(), { arrows: true });
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

const ORDER: Record<Arrow['kind'], number> = { played: 0, threat: 1, best: 2, pick: 3 };
const shapes = computed<DrawShape[]>(() => {
  if (preview.value) return (preview.value.arrows ?? []).map((a) => ({ orig: a.from as Key, dest: a.to as Key, brush: a.brush }));
  if (!analysis.value || !props.arrows) return [];
  const played = analysis.value.uci;
  const noSuggestion = analysis.value.label === 'book' || analysis.value.label === 'forced';
  const arrows = analysis.value.arrows.filter(
    (a) => !((a.kind === 'pick' || a.kind === 'best') && (noSuggestion || played.startsWith(a.from + a.to))),
  );
  const contrast = arrows.some((a) => a.kind === 'pick' || a.kind === 'best');
  return arrows
    .filter((a) => a.kind !== 'played' || contrast)
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind])
    .map((a) => ({ orig: a.from as Key, dest: a.to as Key, brush: a.kind }));
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
    <PromotionPicker v-if="promotion" :color="turn" @pick="onPromote" @cancel="cancelPromotion" />
    <div v-if="preview" class="pointer-events-none absolute -inset-[3px] z-10 rounded-[3px] ring-[3px] ring-sky-400/80"></div>
  </div>
</template>
