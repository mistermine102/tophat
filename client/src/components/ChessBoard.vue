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
}>();

const emit = defineEmits<{ move: [orig: string, dest: string] }>();

const el = ref<HTMLElement | null>(null);
let cg: Api | null = null;
let ro: ResizeObserver | null = null;

const BRUSHES = {
  pick: { key: 'cc-pick', color: '#16a34a', opacity: 0.9, lineWidth: 11 },
  best: { key: 'cc-best', color: '#2563eb', opacity: 0.85, lineWidth: 11 },
  threat: { key: 'cc-threat', color: '#dc2626', opacity: 0.85, lineWidth: 10 },
  played: { key: 'cc-played', color: '#6b7280', opacity: 0.55, lineWidth: 9 },
};

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
    highlight: { lastMove: true, check: true, custom: new Map((props.highlight ?? []).map((sq) => [sq as Key, 'cc-hl'])) },
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
  () => [props.fen, props.orientation, props.turnColor, props.dests, props.lastMove, props.check, props.movable, props.shapes, props.highlight],
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
.cc-board coords {
  font-size: 11px;
  font-weight: 600;
}
</style>
