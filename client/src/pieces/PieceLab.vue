<script setup lang="ts">
// The piece lab: the Tophat set (lib/pieceSet.ts) as large specimens next to cburnett, then on the app's own board
// (ChessBoard.vue) at desktop and phone size, then every board palette and coordinate style side by side. Clicking a
// palette / coordinate card picks it for the main boards. The choice is kept in the URL (?set=&board=&coords=&…).
import type { Color } from '@chess-coach/shared';
import { computed, ref, watch } from 'vue';
import ChessBoard from '../components/ChessBoard.vue';
import PlayerBar from '../components/PlayerBar.vue';
import { BLACK_PALETTES, DEFAULT_STYLE, DESIGNS, installPieceSet, pieceSvg, svgDataUri, WHITE_PALETTES, type PieceStyle, type Role } from '../lib/pieceSet';
import { BOARD_PALETTES, COORD_STYLES } from './looks';

const q = new URLSearchParams(location.search);
const set = ref<'tophat' | 'cburnett'>(q.get('set') === 'cburnett' ? 'cburnett' : 'tophat');
const board = ref(q.get('board') ?? 'chocolate');
const coords = ref(q.get('coords') ?? 'ink');
const pos = ref<'ending' | 'middlegame'>(q.get('pos') === 'middlegame' ? 'middlegame' : 'ending');
const orientation = ref<Color>(q.get('flip') ? 'black' : 'white');
const outline = ref(Number(q.get('outline') ?? DEFAULT_STYLE.outline));
const shading = ref(q.get('shading') !== '0');
const drop = ref(q.get('drop') !== '0');
const blackPal = ref<keyof typeof BLACK_PALETTES>((q.get('black') as keyof typeof BLACK_PALETTES) ?? 'chocolate');
const whitePal = ref<keyof typeof WHITE_PALETTES>((q.get('white') as keyof typeof WHITE_PALETTES) ?? 'paper');

watch([set, board, coords, pos, orientation, outline, shading, drop, blackPal, whitePal], () => {
  const u = new URL(location.href);
  const p = u.searchParams;
  p.set('set', set.value);
  p.set('board', board.value);
  p.set('coords', coords.value);
  p.set('pos', pos.value);
  if (orientation.value === 'black') p.set('flip', '1');
  else p.delete('flip');
  p.set('outline', String(outline.value));
  p.set('shading', shading.value ? '1' : '0');
  p.set('drop', drop.value ? '1' : '0');
  p.set('black', blackPal.value);
  p.set('white', whitePal.value);
  history.replaceState(null, '', u);
});

const style = computed<PieceStyle>(() => ({
  outline: outline.value,
  shading: shading.value,
  drop: drop.value,
  white: WHITE_PALETTES[whitePal.value],
  black: BLACK_PALETTES[blackPal.value],
}));
watch(style, (s) => installPieceSet('th-pieces-lab', '.th-pieces', s), { immediate: true });

const POSITIONS = {
  // only pawns, knights and kings: the whole board in the new set
  ending: { fen: '8/5pk1/4n1p1/3N3p/7P/6P1/5PK1/8 b - - 0 41', last: ['f4', 'd5'] as [string, string] },
  middlegame: { fen: 'r2q1rk1/pp2bppp/2n1pn2/3p4/3P1B2/2NBPN2/PP3PPP/R2QK2R w KQ - 4 10', last: ['b8', 'c6'] as [string, string] },
};
const position = computed(() => POSITIONS[pos.value]);
const NO_DESTS = new Map<string, string[]>();
const turn = computed<Color>(() => (position.value.fen.split(' ')[1] === 'w' ? 'white' : 'black'));

const palette = computed(() => BOARD_PALETTES.find((p) => p.id === board.value) ?? BOARD_PALETTES[0]);
const paletteVars = (id: string) => {
  const p = BOARD_PALETTES.find((x) => x.id === id) ?? BOARD_PALETTES[0];
  return { '--th-sq-light': p.light, '--th-sq-dark': p.dark, '--lab-last': p.last } as Record<string, string>;
};

// --- specimens ---
const ROLES = Object.keys(DESIGNS) as Role[];
const OTHER: Role[] = ['bishop', 'rook', 'queen'];
function uri(role: Role, color: 'white' | 'black') {
  return svgDataUri(pieceSvg(role, color, style.value)!);
}

// a player strip with pieces taken (the captured-piece size)
const STRIP_HEADERS = { White: 'White player', Black: 'Black player', WhiteElo: '1650', BlackElo: '1612', Result: '*' };
const STRIP_FEN = '6k1/5p2/6p1/7p/7P/6P1/5PK1/3N4 w - - 0 50';
</script>

<template>
  <div class="mx-auto max-w-[1500px] p-6 pb-24" :class="set === 'tophat' ? 'th-pieces' : ''">
    <header class="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="th-display text-4xl font-semibold">Piece lab</h1>
        <p class="mt-1 text-sm text-neutral-400">
          Pawn, knight and king in the Tophat style; bishop, rook and queen are still cburnett. Pick a board below.
        </p>
      </div>
      <div class="th-panel flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm">
        <div class="flex items-center gap-1.5">
          <span class="lab-k">Set</span>
          <button v-for="s in ['tophat', 'cburnett'] as const" :key="s" class="th-btn th-btn-sm" :class="{ 'th-btn-primary': set === s }" @click="set = s">
            {{ s === 'tophat' ? 'Tophat' : 'cburnett' }}
          </button>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="lab-k">Black</span>
          <button v-for="(_, k) in BLACK_PALETTES" :key="k" class="th-btn th-btn-sm" :class="{ 'th-btn-primary': blackPal === k }" @click="blackPal = k">{{ k }}</button>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="lab-k">White</span>
          <button v-for="(_, k) in WHITE_PALETTES" :key="k" class="th-btn th-btn-sm" :class="{ 'th-btn-primary': whitePal === k }" @click="whitePal = k">{{ k }}</button>
        </div>
        <label class="flex items-center gap-1.5">
          <span class="lab-k">Outline</span>
          <input v-model.number="outline" type="range" min="2.6" max="6" step="0.2" class="w-24" />
          <span class="w-7 tabular-nums text-neutral-400">{{ outline.toFixed(1) }}</span>
        </label>
        <label class="flex items-center gap-1.5"><input v-model="shading" type="checkbox" /> shading</label>
        <label class="flex items-center gap-1.5"><input v-model="drop" type="checkbox" /> drop</label>
      </div>
    </header>

    <!-- specimens -->
    <section class="th-panel mb-6 p-5">
      <h2 class="lab-h">Specimens</h2>
      <div class="flex flex-wrap gap-6">
        <div v-for="c in ['white', 'black'] as const" :key="c">
          <div class="flex overflow-hidden rounded-lg border-2 border-white">
            <template v-for="r in ROLES" :key="r">
              <div v-for="sq in ['light', 'dark']" :key="sq" class="lab-spec" :style="{ background: `${sq === 'light' ? palette.light : palette.dark} url('${uri(r, c)}') center/contain no-repeat` }"></div>
            </template>
          </div>
          <div class="mt-2 flex items-center gap-2">
            <span class="lab-k w-16">cburnett</span>
            <div class="cg-wrap lab-cb flex">
              <component :is="'piece'" v-for="r in ROLES" :key="r" :class="[r, c]" />
            </div>
            <span class="lab-k ml-4 w-20">others now</span>
            <div class="cg-wrap lab-cb flex">
              <component :is="'piece'" v-for="r in OTHER" :key="r" :class="[r, c]" />
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- the real board, desktop and phone size -->
    <section class="mb-6 flex flex-wrap items-start gap-8">
      <div>
        <div class="mb-2 flex items-center gap-2">
          <h2 class="lab-h mb-0!">On the board</h2>
          <button v-for="p in ['ending', 'middlegame'] as const" :key="p" class="th-btn th-btn-sm" :class="{ 'th-btn-primary': pos === p }" @click="pos = p">{{ p }}</button>
          <button class="th-btn th-btn-sm" @click="orientation = orientation === 'white' ? 'black' : 'white'">flip</button>
          <span class="text-xs text-neutral-500">{{ palette.name }} · {{ COORD_STYLES.find((c) => c.id === coords)?.name }}</span>
        </div>
        <div class="lab-board" :class="`co-${coords}`" :style="{ ...paletteVars(board), width: '600px' }">
          <div class="lab-frame">
            <div style="width: 100%; aspect-ratio: 1">
              <ChessBoard :fen="position.fen" :orientation="orientation" :turn-color="turn" :dests="NO_DESTS" :last-move="position.last" :check="false" :shapes="[]" :movable="false" />
            </div>
          </div>
        </div>
      </div>
      <div class="flex flex-col gap-3">
        <h2 class="lab-h mb-0!">Phone size</h2>
        <div class="lab-board" :class="`co-${coords}`" :style="{ ...paletteVars(board), width: '360px' }">
          <div class="lab-frame">
            <div style="width: 100%; aspect-ratio: 1">
              <ChessBoard :fen="position.fen" :orientation="orientation" :turn-color="turn" :dests="NO_DESTS" :last-move="position.last" :check="false" :shapes="[]" :movable="false" />
            </div>
          </div>
        </div>
        <h2 class="lab-h mb-0! mt-3">Captured pieces</h2>
        <div class="th-panel w-[440px] px-3 py-1">
          <PlayerBar color="white" :headers="STRIP_HEADERS" :fen="STRIP_FEN" />
          <PlayerBar color="black" :headers="STRIP_HEADERS" :fen="STRIP_FEN" />
        </div>
      </div>
    </section>

    <!-- palettes -->
    <section class="th-panel mb-6 p-5">
      <h2 class="lab-h">Board colours</h2>
      <div class="flex flex-wrap gap-5">
        <button v-for="p in BOARD_PALETTES" :key="p.id" class="lab-card" :class="{ 'lab-card-on': board === p.id }" @click="board = p.id">
          <div class="lab-board" :class="`co-${coords}`" :style="{ ...paletteVars(p.id), width: '280px' }">
            <div class="lab-frame">
              <div style="width: 100%; aspect-ratio: 1">
                <ChessBoard :fen="position.fen" :orientation="orientation" :turn-color="turn" :dests="NO_DESTS" :last-move="position.last" :check="false" :shapes="[]" :movable="false" />
              </div>
            </div>
          </div>
          <div class="mt-2 flex items-baseline justify-between gap-2 px-0.5">
            <b class="th-display text-lg">{{ p.name }}</b>
            <span class="text-xs text-neutral-500">{{ p.note }}</span>
          </div>
        </button>
      </div>
    </section>

    <!-- coordinates -->
    <section class="th-panel p-5">
      <h2 class="lab-h">Coordinates</h2>
      <div class="flex flex-wrap gap-5">
        <button v-for="c in COORD_STYLES" :key="c.id" class="lab-card" :class="{ 'lab-card-on': coords === c.id }" @click="coords = c.id">
          <div class="lab-board" :class="`co-${c.id}`" :style="{ ...paletteVars(board), width: '280px' }">
            <div class="lab-frame">
              <div style="width: 100%; aspect-ratio: 1">
                <ChessBoard :fen="position.fen" :orientation="orientation" :turn-color="turn" :dests="NO_DESTS" :last-move="position.last" :check="false" :shapes="[]" :movable="false" />
              </div>
            </div>
          </div>
          <div class="mt-2 flex items-baseline justify-between gap-2 px-0.5">
            <b class="th-display text-lg">{{ c.name }}</b>
            <span class="text-xs text-neutral-500">{{ c.note }}</span>
          </div>
        </button>
      </div>
    </section>
  </div>
</template>

<style>
.lab-h {
  font-family: var(--font-display);
  font-variation-settings: var(--th-display-settings);
  font-size: 1.35rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
}
.lab-k {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--th-ink-soft);
}
.lab-spec {
  width: 128px;
  height: 128px;
}
.lab-cb.cg-wrap {
  display: flex;
  position: static;
  width: auto;
  height: auto;
}
.lab-cb piece {
  position: static;
  display: block;
  width: 40px;
  height: 40px;
}
.lab-card {
  border-radius: 14px;
  padding: 8px;
  text-align: left;
  border: 2px solid transparent;
}
.lab-card:hover {
  background: var(--th-paper-2);
}
.lab-card-on {
  border-color: var(--th-accent);
  background: var(--th-paper-2);
}

/* the frame: the app's (an ink outline, rounded) */
.lab-frame {
  border: 2px solid var(--th-ink);
  border-radius: 10px;
  overflow: hidden;
  background: var(--th-sq-light);
}
.lab-board .cc-board cg-board square.last-move {
  background-color: var(--lab-last);
}

/* ---------- coordinate styles ---------- */

/* two-tone: on a light square in the dark colour and the other way round. The labels sit inside their own square
   (rank numbers on the a / h file, file letters on the bottom rank); a1 and h8 are dark, so the first label of each
   row is on a dark square from White's side, the first rank label on a light one (h1) from Black's. */
.lab-board:is(.co-contrast, .co-serif) .cc-board coords coord {
  color: var(--th-sq-dark) !important;
}
.lab-board:is(.co-contrast, .co-serif) .orientation-white .ranks coord:nth-child(odd),
.lab-board:is(.co-contrast, .co-serif) .orientation-white .files coord:nth-child(odd),
.lab-board:is(.co-contrast, .co-serif) .orientation-black .ranks coord:nth-child(even),
.lab-board:is(.co-contrast, .co-serif) .orientation-black .files coord:nth-child(even) {
  color: var(--th-sq-light) !important;
}
.lab-board:is(.co-contrast, .co-serif) .cc-board coords {
  opacity: 1;
}
.lab-board:is(.co-contrast, .co-serif) .cc-board coords.files {
  bottom: 3px;
  text-transform: none;
}
.lab-board:is(.co-contrast, .co-serif) .cc-board coords.files coord {
  padding-right: 4px;
}
.lab-board:is(.co-contrast, .co-serif) .cc-board coords.ranks {
  left: 3px;
}
.lab-board.co-contrast .cc-board coords {
  font-weight: 700;
  font-size: 11.5px;
}
.lab-board.co-serif .cc-board coords {
  font-family: var(--font-display);
  font-variation-settings: var(--th-display-settings);
  font-style: italic;
  font-weight: 600;
  font-size: 13px;
}
.lab-board.co-serif .cc-board coords.files {
  text-transform: none;
}

/* frame: a chocolate rim around the board with the coordinates on it, centred on their rank / file */
.lab-board.co-frame .lab-frame {
  overflow: visible;
  border: none;
  border-radius: 12px;
  padding: 20px;
  background: var(--th-ink);
  box-shadow: 0 3px 0 #2e1b11;
}
.lab-board.co-frame .cc-board cg-container {
  outline: 2px solid #2e1b11;
}
.lab-board.co-frame .cc-board coords {
  opacity: 1;
  font-family: var(--font-display);
  font-variation-settings: var(--th-display-settings);
  font-weight: 600;
  font-size: 12px;
  text-transform: none;
}
.lab-board.co-frame .cc-board coords coord {
  color: #f1e4c9 !important;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: none !important;
  padding: 0 !important;
}
.lab-board.co-frame .cc-board coords.ranks {
  left: -20px !important;
  top: 0;
  width: 20px;
}
.lab-board.co-frame .cc-board coords.files {
  left: 0 !important;
  bottom: -20px;
  height: 20px;
}

.lab-board.co-none .cc-board coords {
  display: none;
}
</style>
