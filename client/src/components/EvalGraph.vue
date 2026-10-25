<script setup lang="ts">
// Eval graph (White's win %), main line only. Fills in progressively; click to jump to a ply.
import type { GameMove, MoveAnalysis } from '@chess-coach/shared';
import { computed, ref } from 'vue';
import { isCheckmate, moveNumberLabel, sideToMove } from '../lib/chess';
import { formatPositionEval, whiteWinPercent } from '../lib/format';
import { GRAPH_MARKED, LABELS } from '../lib/labels';

const props = defineProps<{
  moves: GameMove[];
  analyses: Record<number, MoveAnalysis>;
  /** Main-line ply shown on the board (or the branch point when in a side line). */
  currentPly: number;
}>();
const emit = defineEmits<{ select: [ply: number] }>();

const W = 1000;
const H = 100;
const n = computed(() => Math.max(1, props.moves.length));
const x = (ply: number) => (ply / n.value) * W;

interface Pt {
  ply: number;
  win: number;
}

const points = computed<(Pt | null)[]>(() => {
  const out: (Pt | null)[] = [];
  const first = props.analyses[1];
  out.push(first ? { ply: 0, win: whiteWinPercent(first.evalBefore) } : null);
  for (const m of props.moves) {
    const a = props.analyses[m.ply];
    if (!a) {
      // the position after ply p is also the next ply's "before" position (same deep search)
      const next = props.analyses[m.ply + 1];
      out.push(next ? { ply: m.ply, win: whiteWinPercent(next.evalBefore) } : null);
      continue;
    }
    const mated = isCheckmate(a.fenAfter) ? sideToMove(a.fenAfter) : null;
    out.push({ ply: m.ply, win: whiteWinPercent(a.evalAfter, mated) });
  }
  return out;
});

/** Contiguous runs of known points. */
const runs = computed(() => {
  const res: Pt[][] = [];
  let cur: Pt[] = [];
  for (const p of points.value) {
    if (p) cur.push(p);
    else if (cur.length) {
      res.push(cur);
      cur = [];
    }
  }
  if (cur.length) res.push(cur);
  return res;
});

const y = (win: number) => H - (win / 100) * H;

const areas = computed(() =>
  runs.value.map((run) => {
    const line = run.map((p) => `${x(p.ply).toFixed(1)},${y(p.win).toFixed(1)}`).join(' L');
    const a = run[0]!;
    const b = run[run.length - 1]!;
    return {
      fill: `M${x(a.ply).toFixed(1)},${H} L${line} L${x(b.ply).toFixed(1)},${H} Z`,
      stroke: `M${line}`,
    };
  }),
);

const marks = computed(() =>
  props.moves
    .map((m) => ({ m, a: props.analyses[m.ply], p: points.value[m.ply] }))
    .filter((e) => e.a && e.p && GRAPH_MARKED.has(e.a.label))
    .map((e) => ({
      ply: e.m.ply,
      left: (e.m.ply / n.value) * 100,
      top: 100 - e.p!.win,
      color: LABELS[e.a!.label].color,
      label: e.a!.label,
      title: `${moveNumberLabel(e.m.fenBefore)} ${e.m.san} — ${LABELS[e.a!.label].name}`,
    })),
);

const hover = ref<number | null>(null);
const root = ref<HTMLElement | null>(null);

function plyAt(ev: MouseEvent): number {
  const r = root.value!.getBoundingClientRect();
  const f = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
  return Math.round(f * n.value);
}

const hoverInfo = computed(() => {
  const p = hover.value;
  if (p === null) return null;
  const m = props.moves[p - 1];
  const a = props.analyses[p];
  const name = p === 0 ? 'Start' : m ? `${moveNumberLabel(m.fenBefore)} ${m.san}` : '';
  const next = props.analyses[p + 1];
  const ev = p === 0 ? (props.analyses[1] ? formatPositionEval(props.analyses[1].evalBefore, null) : '…') : a
    ? formatPositionEval(a.evalAfter, isCheckmate(a.fenAfter) ? sideToMove(a.fenAfter) : null)
    : next
      ? formatPositionEval(next.evalBefore, null)
      : '…';
  return { left: (p / n.value) * 100, text: `${name}  ${ev}` };
});
</script>

<template>
  <div
    ref="root"
    class="relative h-full w-full cursor-pointer select-none overflow-hidden rounded-md bg-neutral-800 ring-1 ring-white/5"
    data-testid="eval-graph"
    title="Who was winning during the game: the higher the light area, the better for White. Dots mark mistakes and great moves. Click to jump to that move."
    @mousemove="hover = plyAt($event)"
    @mouseleave="hover = null"
    @click="emit('select', plyAt($event))"
  >
    <svg class="absolute inset-0 h-full w-full" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none">
      <line x1="0" :y1="H / 2" :x2="W" :y2="H / 2" stroke="#525252" stroke-width="1" vector-effect="non-scaling-stroke" stroke-dasharray="4 4" />
      <path v-for="(a, i) in areas" :key="'f' + i" :d="a.fill" fill="#e5e5e5" fill-opacity="0.85" />
      <path v-for="(a, i) in areas" :key="'s' + i" :d="a.stroke" fill="none" stroke="#fafafa" stroke-width="1.5" vector-effect="non-scaling-stroke" />
      <line
        :x1="x(currentPly)" y1="0" :x2="x(currentPly)" :y2="H"
        stroke="#f59e0b" stroke-width="2" vector-effect="non-scaling-stroke"
      />
    </svg>
    <span class="pointer-events-none absolute left-1 top-0.5 rounded bg-neutral-900/70 px-1 text-[9px] leading-tight text-neutral-400">White ahead</span>
    <span class="pointer-events-none absolute bottom-0.5 left-1 rounded bg-neutral-900/70 px-1 text-[9px] leading-tight text-neutral-400">Black ahead</span>
    <span
      v-for="mk in marks"
      :key="mk.ply"
      class="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
      :class="n > 80 ? 'h-1.5 w-1.5 ring-1 ring-neutral-900' : 'h-2.5 w-2.5 ring-2 ring-neutral-900'"
      :style="{ left: `${mk.left}%`, top: `clamp(6px, ${mk.top}%, calc(100% - 6px))`, background: mk.color }"
      :title="mk.title"
      :data-label="mk.label"
    ></span>
    <div
      v-if="hoverInfo"
      class="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-pre rounded bg-black/80 px-1.5 py-0.5 text-[11px] text-neutral-100"
      :style="{ left: `${Math.min(90, Math.max(10, hoverInfo.left))}%` }"
    >
      {{ hoverInfo.text }}
    </div>
  </div>
</template>
