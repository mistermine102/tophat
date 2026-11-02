<script setup lang="ts">
// The board-first screen (layout A) as a static mock, dressed in one of the identity directions. The lab bar
// (top) switches direction / shadows / background / wordmark; the choice is kept in the URL so a look can be
// shared (?d=waistcoat&p=tophat&shadow=hard&bg=1). Keys: 1–4 direction, p palette (Waistcoat), s shadows, b background,
// w wordmark.
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ACCURACY, COUNTS, CURRENT_PLY, EVAL_CURVE, FEN, GLYPH, GRAPH_MARKS, LAST_MOVE, MOVES, PLAYERS, VERDICT } from './data';
import { DIRECTIONS, PALETTES, parseParams, type Bg, type DirId, type Mark, type PaletteId, type Shadow } from './directions';

const initial = parseParams(location.search);
const dirId = ref<DirId>(initial.dir);
const shadow = ref<Shadow>(initial.shadow);
const bg = ref<Bg>(initial.bg);
const mark = ref<Mark>(initial.mark);
const palette = ref<PaletteId>(initial.palette);
const labOpen = ref(true);
const dir = computed(() => DIRECTIONS.find((d) => d.id === dirId.value)!);
const pattern = computed(() => (bg.value === '0' ? 'none' : dir.value.patterns[Number(bg.value) - 1].css));

watch([dirId, shadow, bg, mark, palette], () => {
  const url = new URL(location.href);
  url.searchParams.set('d', dirId.value);
  url.searchParams.set('shadow', shadow.value);
  url.searchParams.set('bg', bg.value);
  url.searchParams.set('p', palette.value);
  if (mark.value === 'theme') url.searchParams.delete('mark');
  else url.searchParams.set('mark', mark.value);
  history.replaceState(null, '', url);
});

// --- board ---
const boardEl = ref<HTMLElement | null>(null);
const root = ref<HTMLElement | null>(null);
let cg: Api | null = null;
let ro: ResizeObserver | null = null;

function mountBoard() {
  if (!boardEl.value) return;
  cg?.destroy();
  // the palette may override the direction's arrow colours (--arrow-better / --arrow-threat)
  const css = root.value ? getComputedStyle(root.value) : null;
  const better = css?.getPropertyValue('--arrow-better').trim() || dir.value.arrows.better;
  const threat = css?.getPropertyValue('--arrow-threat').trim() || dir.value.arrows.threat;
  cg = Chessground(boardEl.value, {
    fen: FEN,
    orientation: 'white',
    viewOnly: true,
    coordinates: true,
    lastMove: LAST_MOVE as Key[],
    highlight: {
      lastMove: true,
      custom: new Map<Key, string>([
        ['a1', 'tl-forked'],
        ['c3', 'tl-forked'],
      ]),
    },
    drawable: {
      enabled: false,
      visible: true,
      brushes: {
        better: { key: 'tl-better', color: better, opacity: 0.85, lineWidth: 11 },
        threat: { key: 'tl-threat', color: threat, opacity: 0.85, lineWidth: 8 },
      } as never,
      // the better move, and the threat the played move allows
      autoShapes: [
        { orig: 'a2', dest: 'a3', brush: 'better' },
        { orig: 'b4', dest: 'b2', brush: 'threat' },
      ],
    },
  });
}

onMounted(() => {
  mountBoard();
  let raf = 0;
  ro = new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => cg?.redrawAll());
  });
  if (boardEl.value) ro.observe(boardEl.value);
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  ro?.disconnect();
  cg?.destroy();
  window.removeEventListener('keydown', onKey);
});
// the arrow colours are read when the board is created
watch([dirId, palette], () => nextTick(mountBoard));

function cycle<T>(list: readonly T[], v: T): T {
  return list[(list.indexOf(v) + 1) % list.length];
}
function onKey(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const n = Number(e.key);
  if (n >= 1 && n <= DIRECTIONS.length) dirId.value = DIRECTIONS[n - 1].id;
  else if (e.key === 's') shadow.value = cycle(['hard', 'soft', 'none'] as const, shadow.value);
  else if (e.key === 'b') bg.value = cycle(['0', '1', '2'] as const, bg.value);
  else if (e.key === 'p') palette.value = cycle(PALETTES.map((x) => x.id), palette.value);
  else if (e.key === 'w') mark.value = mark.value === 'theme' ? 'blackletter' : 'theme';
  else if (e.key === 'l') labOpen.value = !labOpen.value;
}

// --- eval bar + graph ---
const evalNow = EVAL_CURVE[CURRENT_PLY];
/** White's share of the eval bar, %. */
const whiteShare = computed(() => 50 + 50 * (2 / (1 + Math.exp(-0.45 * evalNow)) - 1));
const GW = 600;
const GH = 60;
const gx = (i: number) => (i / (EVAL_CURVE.length - 1)) * GW;
const gy = (v: number) => GH / 2 - (Math.max(-8, Math.min(8, v)) / 8) * (GH / 2 - 4);
const graphArea = computed(() => `M0 ${GH} ${EVAL_CURVE.map((v, i) => `L${gx(i).toFixed(1)} ${gy(v).toFixed(1)}`).join(' ')} L${GW} ${GH}Z`);
const graphLine = computed(() => EVAL_CURVE.map((v, i) => `${i ? 'L' : 'M'}${gx(i).toFixed(1)} ${gy(v).toFixed(1)}`).join(' '));

const players = computed(() => [
  { side: 'black' as const, ...PLAYERS.black },
  { side: 'white' as const, ...PLAYERS.white },
]);
</script>

<template>
  <div ref="root" class="tl" :data-dir="dirId" :data-shadow="shadow" :data-bg="bg" :data-mark="mark" :data-palette="palette" :data-moves="dir.moves">
    <div class="tl-bg" :style="{ background: pattern }" aria-hidden="true"></div>

    <!-- the lab bar: plain on purpose, not part of any direction -->
    <div v-if="labOpen" class="lab">
      <b class="lab-title" :title="`${dir.lead}\nType: ${dir.fonts}`">Identity lab</b>
      <div class="lab-seg">
        <button v-for="(d, i) in DIRECTIONS" :key="d.id" :class="{ on: d.id === dirId }" :title="`${d.lead} (key ${i + 1})`" @click="dirId = d.id">{{ i + 1 }} · {{ d.name }}</button>
      </div>
      <template v-if="dirId === 'waistcoat'">
        <span class="lab-k">Palette</span>
        <div class="lab-seg">
          <button v-for="pl in PALETTES" :key="pl.id" :class="{ on: pl.id === palette }" :title="pl.name" @click="palette = pl.id">
            <span class="lab-swatch"><i v-for="c in pl.swatch" :key="c" :style="{ background: c }"></i></span>{{ pl.name }}
          </button>
        </div>
      </template>
      <span class="lab-k">Shadows</span>
      <div class="lab-seg">
        <button v-for="s in (['hard', 'soft', 'none'] as const)" :key="s" :class="{ on: shadow === s }" @click="shadow = s">{{ s === 'hard' ? 'Hard' : s === 'soft' ? 'Soft' : 'None' }}</button>
      </div>
      <span class="lab-k">Background</span>
      <div class="lab-seg">
        <button :class="{ on: bg === '0' }" @click="bg = '0'">Plain</button>
        <button :class="{ on: bg === '1' }" @click="bg = '1'">{{ dir.patterns[0].name }}</button>
        <button :class="{ on: bg === '2' }" @click="bg = '2'">{{ dir.patterns[1].name }}</button>
      </div>
      <span class="lab-k">Wordmark</span>
      <div class="lab-seg">
        <button :class="{ on: mark === 'theme' }" @click="mark = 'theme'">Direction</button>
        <button :class="{ on: mark === 'blackletter' }" @click="mark = 'blackletter'">Blackletter</button>
      </div>
      <span class="lab-fonts">{{ dir.fonts }}</span>
      <button class="lab-close" title="Hide (key l)" @click="labOpen = false">×</button>
    </div>
    <button v-else class="lab-open" title="Show the identity lab (key l)" @click="labOpen = true">Lab</button>

    <header class="tl-head">
      <a class="tl-brand" href="#" @click.prevent>
        <svg class="tl-mark" viewBox="0 0 64 64" aria-hidden="true">
          <!-- a pawn in a top hat -->
          <g class="tl-mark-pawn">
            <circle cx="32" cy="31" r="9" />
            <rect x="22" y="39" width="20" height="4.5" rx="2.25" />
            <path d="M26.5 43.5h11c0 4 2.6 7.4 6 9.5H20.5c3.4-2.1 6-5.5 6-9.5z" />
            <rect x="15" y="52.5" width="34" height="7" rx="3.5" />
          </g>
          <g class="tl-mark-hat" transform="rotate(-9 32 18)">
            <path d="M24.6 21.5 23.4 4.6Q32 3.2 40.6 4.6L39.4 21.5Z" />
            <path class="tl-mark-band" d="M24.25 15.8h15.5l-.3 4.6H24.55Z" />
            <path d="M14.5 21.8Q32 17.6 49.5 21.8Q49 24.6 32 24.4Q15 24.6 14.5 21.8Z" />
          </g>
        </svg>
        <span class="tl-word">Tophat</span>
      </a>
      <span class="tl-tagline">{{ dir.tagline }}</span>
      <div class="tl-head-r">
        <span class="tl-status"><i>✓</i> Analysis complete</span>
        <button class="tl-btn tl-btn--primary">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10 4v12M4 10h12" /></svg>
          Open game
        </button>
      </div>
    </header>

    <main class="tl-main">
      <!-- board column -->
      <section class="tl-boardcol">
        <div v-for="(p, i) in players" :key="p.side" class="tl-player" :class="{ 'tl-player--bottom': i === 1 }" :style="{ order: i === 0 ? 0 : 2 }">
          <span class="tl-dot" :data-side="p.side"></span>
          <b class="tl-pname">{{ p.name }}</b>
          <span class="tl-elo">{{ p.elo }}</span>
          <span v-if="p.you" class="tl-chip tl-chip--you">You</span>
          <span class="tl-taken">{{ p.taken }}</span>
          <span v-if="p.plus" class="tl-plus">+{{ p.plus }}</span>
        </div>

        <div class="tl-boardrow" style="order: 1">
          <div class="tl-evalbar" title="−6.3">
            <div class="tl-evalbar-w" :style="{ height: `${whiteShare}%` }"></div>
            <span class="tl-evalbar-n">6.3</span>
          </div>
          <div class="tl-boardframe">
            <div class="tl-boardinner">
              <div ref="boardEl" class="tl-board"></div>
              <!-- the label badge on the moved piece (d2) -->
              <span class="tl-badge tl-glyph" data-l="blunder" style="left: calc(12.5% * 3.88); top: calc(12.5% * 6.12)">??</span>
            </div>
          </div>
        </div>

        <nav class="tl-nav" style="order: 3">
          <button class="tl-btn tl-btn--icon" title="Start"><svg viewBox="0 0 20 20"><path d="M5 4v12M15 4 7 10l8 6z" /></svg></button>
          <button class="tl-btn tl-btn--icon" title="Back"><svg viewBox="0 0 20 20"><path d="M13 4 5 10l8 6z" /></svg></button>
          <button class="tl-btn tl-btn--icon" title="Forward"><svg viewBox="0 0 20 20"><path d="m7 4 8 6-8 6z" /></svg></button>
          <button class="tl-btn tl-btn--icon" title="End"><svg viewBox="0 0 20 20"><path d="M15 4v12M5 4l8 6-8 6z" /></svg></button>
          <button class="tl-btn tl-btn--icon" title="Flip"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16V4M4 7l3-3 3 3M13 4v12M10 13l3 3 3-3" /></svg></button>
          <button class="tl-btn tl-btn--wide">Next mistake <span aria-hidden="true">»</span></button>
        </nav>

        <div class="tl-graph" style="order: 4">
          <svg :viewBox="`0 0 ${GW} ${GH}`" preserveAspectRatio="none">
            <rect class="tl-graph-black" x="0" y="0" :width="GW" :height="GH" />
            <path class="tl-graph-white" :d="graphArea" />
            <line class="tl-graph-mid" x1="0" :x2="GW" :y1="GH / 2" :y2="GH / 2" />
            <path class="tl-graph-line" :d="graphLine" fill="none" />
            <line class="tl-graph-now" :x1="gx(CURRENT_PLY)" :x2="gx(CURRENT_PLY)" y1="0" :y2="GH" />
          </svg>
          <span
            v-for="mk in GRAPH_MARKS"
            :key="mk.ply"
            class="tl-graph-dot"
            :data-l="mk.label"
            :class="{ 'tl-graph-dot--now': mk.ply === CURRENT_PLY }"
            :style="{ left: `${(gx(mk.ply) / GW) * 100}%`, top: `${(gy(EVAL_CURVE[mk.ply]) / GH) * 100}%` }"
          ></span>
        </div>
      </section>

      <!-- summary, verdict, moves -->
      <aside class="tl-side">
        <section class="tl-panel tl-summary">
          <div v-for="who in (['you', 'opp'] as const)" :key="who" class="tl-acc-row">
            <span class="tl-acc-who">{{ who === 'you' ? 'You' : 'Opponent' }}</span>
            <span class="tl-acc-num">{{ ACCURACY[who].toFixed(1) }}</span>
            <span class="tl-acc-counts">
              <span v-for="c in COUNTS" :key="c.label" class="tl-count" :class="{ 'tl-count--zero': !c[who] }">
                <span class="tl-glyph tl-glyph--xs" :data-l="c.label">{{ GLYPH[c.label] }}</span>{{ c[who] }}
              </span>
            </span>
          </div>
          <span class="tl-summary-k">accuracy</span>
        </section>

        <article class="tl-card tl-verdict" data-l="blunder">
          <header class="tl-verdict-head">
            <b class="tl-move">{{ VERDICT.move }}</b>
            <span class="tl-chip tl-chip--you">You</span>
            <span class="tl-evalchange">eval {{ VERDICT.evalBefore }} → <b>{{ VERDICT.evalAfter }}</b></span>
          </header>
          <div class="tl-verdict-main">
            <span class="tl-glyph tl-glyph--lg" data-l="blunder">{{ GLYPH.blunder }}</span>
            <p>
              <b class="tl-lname">{{ VERDICT.name }}</b><span class="tl-dash"> — </span>{{ VERDICT.sentence }}
            </p>
          </div>
          <ul class="tl-points">
            <li v-for="pt in VERDICT.points" :key="pt.text" :data-tone="pt.tone">
              <i>{{ pt.tone === 'good' ? '✓' : '✗' }}</i><span>{{ pt.text }}</span>
            </li>
          </ul>
          <div class="tl-better">
            <div class="tl-better-head">
              <span class="tl-better-k">Better</span>
              <b class="tl-better-san">{{ VERDICT.better.san }}</b>
              <button class="tl-btn tl-btn--sm tl-btn--good">▶ Play it</button>
            </div>
            <p>{{ VERDICT.better.text }}</p>
          </div>
        </article>

        <section class="tl-panel tl-moves">
          <div class="tl-tabs" role="tablist">
            <button class="tl-tab tl-tab--on">Moves</button>
            <button class="tl-tab">Key moments</button>
            <button class="tl-tab">Legend</button>
          </div>
          <div class="tl-moves-body">
            <!-- a score sheet: one row per move -->
            <ol class="tl-sheet">
              <li v-for="(row, i) in MOVES" :key="i">
                <span class="tl-num">{{ i + 1 }}.</span>
                <span v-for="(c, j) in row" :key="j" class="tl-mv" :class="{ 'tl-mv--now': c.current }" :data-l="c.label">
                  {{ c.san }}<span class="tl-glyph tl-glyph--xs" :data-l="c.label">{{ GLYPH[c.label] }}</span>
                </span>
              </li>
            </ol>
            <!-- a printed game: running text, glyphs as annotation marks -->
            <p class="tl-prose">
              <template v-for="(row, i) in MOVES" :key="i">
                <span class="tl-num">{{ i + 1 }}.</span>
                <template v-for="(c, j) in row" :key="j">
                  <span class="tl-mv" :class="{ 'tl-mv--now': c.current }" :data-l="c.label">{{ c.san }}<sup v-if="c.label !== 'book'" class="tl-ann">{{ GLYPH[c.label] }}</sup></span>
                  {{ ' ' }}
                </template>
              </template>
            </p>
          </div>
        </section>
      </aside>
    </main>

  </div>
</template>
