<script setup lang="ts">
// Thin chessground wrapper. All chess logic (legal moves, SAN, FEN) stays in chessops on our side.
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { DrawShape } from 'chessground/draw';
import type { Dests, Key } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import type { Color } from '@chess-coach/shared';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { topBrushes } from '../lib/topArrows';

const props = defineProps<{
  fen: string;
  orientation: Color;
  turnColor: Color;
  dests: Map<string, string[]>;
  lastMove: [string, string] | null;
  check: boolean;
  shapes: DrawShape[];
  movable: boolean;
  /** Squares to highlight (e.g. hovered square names in an explanation). */
  highlight?: string[];
  /** Tinted squares (layout A's consequence marks): green / red / blue = good / bad / neutral for you. */
  marks?: readonly { square: string; tone: 'good' | 'bad' | 'neutral' }[];
}>();

const emit = defineEmits<{ move: [orig: string, dest: string] }>();

const el = ref<HTMLElement | null>(null);
let cg: Api | null = null;
let ro: ResizeObserver | null = null;

const BRUSHES = {
  pick: { key: 'cc-pick', color: '#16a34a', opacity: 0.9, lineWidth: 11 },
  best: { key: 'cc-best', color: '#2563eb', opacity: 0.85, lineWidth: 11 },
  // "Show best move": the engine's best move in the position on the board
  bestHere: { key: 'cc-best-here', color: '#e0a400', opacity: 0.9, lineWidth: 12 },
  // "Show best move": the engine's top moves here, top0 (faintest) … top9 (the best), lib/topArrows.ts
  ...topBrushes(),
  threat: { key: 'cc-threat', color: '#dc2626', opacity: 0.85, lineWidth: 10 },
  played: { key: 'cc-played', color: '#6b7280', opacity: 0.55, lineWidth: 9 },
  // (UI prototypes) replayed steps, by tone for the mover
  good: { key: 'cc-good', color: '#22c55e', opacity: 0.85, lineWidth: 11 },
  bad: { key: 'cc-bad', color: '#ef4444', opacity: 0.85, lineWidth: 11 },
  neutral: { key: 'cc-neutral', color: '#a1a1aa', opacity: 0.7, lineWidth: 10 },
  // consequence arrows (who attacks what), thinner than the move suggestions; green / red / blue for you
  goodThin: { key: 'cc-good-thin', color: '#22c55e', opacity: 0.75, lineWidth: 6 },
  badThin: { key: 'cc-bad-thin', color: '#ef4444', opacity: 0.8, lineWidth: 6 },
  neutralThin: { key: 'cc-neutral-thin', color: '#3d7fb0', opacity: 0.75, lineWidth: 6 },
};

/** The move's mark tints, then hovered square names on top. */
function customHighlights(): Map<Key, string> {
  const m = new Map<Key, string>();
  for (const x of props.marks ?? []) m.set(x.square as Key, `cc-mark-${x.tone}`);
  for (const sq of props.highlight ?? []) m.set(sq as Key, 'cc-hl');
  return m;
}

function config(): Config {
  return {
    fen: props.fen,
    orientation: props.orientation,
    turnColor: props.turnColor,
    lastMove: (props.lastMove ?? undefined) as Key[] | undefined,
    check: props.check ? props.turnColor : false,
    movable: {
      free: false,
      color: props.movable ? props.turnColor : undefined,
      dests: props.dests as Dests,
      showDests: true,
    },
    drawable: { autoShapes: props.shapes },
    highlight: { lastMove: true, check: true, custom: customHighlights() },
  };
}

onMounted(() => {
  if (!el.value) return;
  cg = Chessground(el.value, {
    ...config(),
    coordinates: true,
    animation: { enabled: true, duration: 160 },
    premovable: { enabled: false },
    draggable: { enabled: true, showGhost: true },
    drawable: {
      enabled: true,
      brushes: { ...BRUSHES } as never,
      autoShapes: props.shapes,
    },
    movable: {
      ...config().movable,
      events: { after: (orig, dest) => emit('move', orig, dest) },
    },
  });
  let raf = 0;
  ro = new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => cg?.redrawAll());
  });
  ro.observe(el.value);
});

watch(
  () => [props.fen, props.orientation, props.turnColor, props.dests, props.lastMove, props.check, props.movable, props.shapes, props.highlight, props.marks],
  () => {
    if (!cg) return;
    const c = config();
    cg.set({ ...c, movable: { ...c.movable } });
    cg.setAutoShapes(props.shapes);
  },
);

onBeforeUnmount(() => {
  ro?.disconnect();
  cg?.destroy();
  cg = null;
});

/** Reset the board to the props (e.g. after a cancelled promotion). */
function sync() {
  if (cg) cg.set(config());
}
defineExpose({ sync });
</script>

<template>
  <div ref="el" class="cc-board h-full w-full" data-testid="board"></div>
</template>

<style>
.cc-board square.cc-hl {
  background: rgba(245, 158, 11, 0.45);
  box-shadow: inset 0 0 0 3px rgba(245, 158, 11, 0.95);
}
.cc-board square.cc-mark-good {
  background: rgba(34, 197, 94, 0.32);
  box-shadow: inset 0 0 0 3px rgba(34, 197, 94, 0.9);
}
.cc-board square.cc-mark-bad {
  background: rgba(239, 68, 68, 0.35);
  box-shadow: inset 0 0 0 3px rgba(239, 68, 68, 0.95);
}
.cc-board square.cc-mark-neutral {
  background: rgba(61, 127, 176, 0.3);
  box-shadow: inset 0 0 0 3px rgba(61, 127, 176, 0.9);
}
/* "Show best move" rank numbers (chessground labels): smaller than chessground's 0.4-square disc */
.cc-board svg.cg-custom-svgs circle {
  r: 0.13px;
}
.cc-board svg.cg-custom-svgs text {
  font-size: 0.19px;
  font-weight: 700;
  transform: translateY(-0.03px);
}
.cc-board coords {
  font-size: 11px;
  font-weight: 600;
}
</style>
