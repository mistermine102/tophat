<script setup lang="ts">
// The Open screen ("Open a game", CoachApp.vue): your chess.com games, paste a PGN, recently opened. Its own screen rather
// than a dialog: the landing page when no game is open (lib/route.ts), and reached from the header with a way back to
// the game that is still loaded. Emits `opened` once a game is open, `back` to return to the loaded game.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ApiError } from '../api/types';
import { type ChessComRow, chessComRow, groupByDay } from '../lib/chesscom';
import EndingBadge from './EndingBadge.vue';
import { useSession } from '../stores/session';
import GamePreview from './GamePreview.vue';

const emit = defineEmits<{ opened: []; back: [] }>();
const session = useSession();
/** The game still loaded behind this screen (null on the landing page). */
const loaded = computed(() => {
  const h = session.state.game?.headers;
  return h ? `${h.White ?? 'White'} vs ${h.Black ?? 'Black'}` : null;
});
const panel = ref<HTMLElement | null>(null);
const pgn = ref('');
const error = ref<string | null>(null);
const busy = ref(false);
const area = ref<HTMLTextAreaElement | null>(null);
const isMock = session.api.mode === 'mock';
const recent = computed(() => session.state.recent.filter((r) => r.id !== session.state.game?.id));
// chess.com import: the newest games of a username (prefilled with the one looked up last time)
const ccName = ref(session.state.chessComName ?? '');
const ccInput = ref<HTMLInputElement | null>(null);
const ccRows = ref<ChessComRow[] | null>(null);
const ccLoading = ref(false);
const ccError = ref<string | null>(null);
const ccOpening = ref<string | null>(null);
// "Show more games" asks the server for a longer list (it reads further back in the player's monthly archives)
const PAGE = 50;
const MAX_GAMES = 300;
const ccLimit = ref(PAGE);
const ccMore = ref(false);
const ccGroups = computed(() => groupByDay(ccRows.value ?? []));

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && loaded.value) emit('back');
}
onMounted(() => {
  (ccName.value ? area.value : ccInput.value)?.focus();
  // a name from last time: list its games right away (this is the home screen)
  if (ccName.value) void loadChessCom();
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

async function loadChessCom(more = false) {
  const name = ccName.value.trim();
  ccLimit.value = more ? Math.min(ccLimit.value + PAGE, MAX_GAMES) : PAGE;
  if (!name) {
    ccError.value = 'Type a chess.com username first.';
    return;
  }
  ccLoading.value = true;
  ccError.value = null;
  try {
    const res = await session.api.chessComGames(name, ccLimit.value);
    ccRows.value = res.games.map((g) => chessComRow(g, res.username));
    ccMore.value = res.games.length >= ccLimit.value && ccLimit.value < MAX_GAMES;
    if (!res.games.length) ccError.value = `${res.username} has no finished games on chess.com yet.`;
    if (res.games.length) session.rememberChessComName(res.username);
  } catch (e) {
    ccRows.value = null;
    ccError.value = (e as Error).message;
  } finally {
    ccLoading.value = false;
  }
}

async function openChessCom(row: ChessComRow) {
  busy.value = true;
  ccOpening.value = row.game.url;
  ccError.value = null;
  try {
    await session.importPgn(row.game.pgn, row.side ?? undefined);
    emit('opened');
  } catch (e) {
    ccError.value = `Could not open this game: ${(e as Error).message}`;
  } finally {
    busy.value = false;
    ccOpening.value = null;
  }
}

// hover preview: a small board playing the hovered game, beside the panel (the side with more room)
const PREVIEW_W = 260;
const hovered = ref<{ row: ChessComRow; left: number; top: number } | null>(null);
function showPreview(row: ChessComRow, ev: MouseEvent) {
  const li = ev.currentTarget as HTMLElement;
  const box = panel.value?.getBoundingClientRect();
  const r = li.getBoundingClientRect();
  if (!box) return;
  const roomRight = window.innerWidth - box.right;
  const left = roomRight >= PREVIEW_W + 24 || roomRight >= box.left ? Math.min(box.right + 12, window.innerWidth - PREVIEW_W - 8) : Math.max(8, box.left - PREVIEW_W - 12);
  const top = Math.max(8, Math.min(r.top - 60, window.innerHeight - PREVIEW_W - 70));
  hovered.value = { row, left, top };
}

const OUTCOME = {
  win: { text: 'Won', cls: 'th-badge-good' },
  draw: { text: 'Draw', cls: '' },
  loss: { text: 'Lost', cls: 'th-badge-bad' },
} as const;

async function submit() {
  if (!pgn.value.trim()) {
    error.value = 'Paste a PGN first (chess.com: Share → PGN → Copy).';
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await session.importPgn(pgn.value);
    emit('opened');
  } catch (e) {
    const msg = (e as Error).message;
    error.value = e instanceof ApiError && e.status === 400 ? `Could not read this PGN: ${msg}` : msg;
  } finally {
    busy.value = false;
  }
}

async function open(id: string) {
  busy.value = true;
  error.value = null;
  const ok = await session.openGame(id);
  busy.value = false;
  if (ok) emit('opened');
  else error.value = session.state.loadError;
}

async function sample() {
  const { FIXTURE_PGN } = await import("../fixtures/game");
  pgn.value = FIXTURE_PGN;
  error.value = null;
}

function onPgnKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
}
</script>

<template>
  <main class="flex min-h-0 flex-1 justify-center overflow-y-auto px-4 pb-8 pt-3" data-testid="open-screen">
    <div class="w-full max-w-2xl">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h1 class="th-display text-[30px] font-bold leading-tight text-neutral-50">Open a game</h1>
        <button v-if="loaded" class="th-btn th-btn-sm max-w-full" :title="`Back to ${loaded} (Esc)`" data-testid="open-back" @click="emit('back')">
          <svg viewBox="0 0 20 20" class="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 6 10l6 6" /></svg>
          <span class="truncate">Back to {{ loaded }}</span>
        </button>
      </div>
      <p v-if="!loaded" class="mb-3 text-sm leading-relaxed text-neutral-300" data-testid="welcome">
        Tophat goes through one of your finished games move by move: a label for every move (Best, Mistake,
        Blunder …), what the move did, and a better move to try.
      </p>
      <p v-if="!loaded && session.state.loadError" class="mb-3 rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-300" data-testid="load-error">
        {{ session.state.loadError }}
      </p>
      <div ref="panel" class="th-panel px-5 py-4">
        <section data-testid="chesscom">
          <label for="cc-username" class="block text-sm font-medium text-neutral-200">Your games on chess.com</label>
          <form class="mt-1 flex flex-wrap items-center gap-2" @submit.prevent="loadChessCom()">
            <input
              id="cc-username"
              ref="ccInput"
              v-model="ccName"
              data-testid="cc-username"
              autocomplete="off"
              spellcheck="false"
              class="h-9 w-64 max-w-full rounded-md bg-neutral-900 px-3 text-sm text-neutral-100 ring-1 ring-white/10 outline-none placeholder:text-neutral-600 focus:ring-amber-500/60"
              placeholder="chess.com username"
            />
            <button
              type="submit"
              class="th-btn"
              :disabled="ccLoading || busy"
              data-testid="cc-load"
            >
              <span v-if="ccLoading" class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-300 border-t-transparent"></span>
              Show recent games
            </button>
          </form>
          <p v-if="ccError" class="mt-2 rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-300" data-testid="cc-error">
            {{ ccError }}
          </p>
          <div v-if="ccRows?.length" class="mt-2 max-h-[45vh] overflow-y-auto rounded-xl bg-neutral-900/60 px-1 pb-1 ring-1 ring-white/10" data-testid="cc-games">
            <section v-for="g in ccGroups" :key="g.day" data-testid="cc-day">
              <h3 class="sticky top-0 z-[1] bg-neutral-900 px-2 pb-1 pt-2 text-xs font-bold text-neutral-400">{{ g.label }}</h3>
              <ul class="space-y-0.5">
                <li v-for="r in g.rows" :key="r.game.url" @mouseenter="showPreview(r, $event)" @mouseleave="hovered = null">
                  <button
                    class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-neutral-200 hover:bg-white/5 disabled:opacity-60"
                    :disabled="busy"
                    data-testid="cc-game"
                    @click="openChessCom(r)"
                  >
                    <span v-if="r.outcome" class="th-badge w-12 shrink-0 justify-center" :class="OUTCOME[r.outcome].cls">{{ OUTCOME[r.outcome].text }}</span>
                    <span
                      class="h-3 w-3 shrink-0 rounded-full"
                      :class="r.side === 'black' ? 'th-side-black' : 'th-side-white'"
                      :title="r.side ? `Played ${r.side}` : ''"
                    ></span>
                    <span class="min-w-0 flex-1 truncate">
                      <span class="text-neutral-500">vs</span> {{ r.opponent }}
                      <span v-if="r.opponentRating" class="text-neutral-500">({{ r.opponentRating }})</span>
                    </span>
                    <span v-if="ccOpening === r.game.url" class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-400 border-t-transparent"></span>
                    <span class="text-xs text-neutral-400">{{ r.kind }}</span>
                    <span class="flex w-6 shrink-0 justify-end" data-testid="cc-ending"><EndingBadge v-if="r.ending" :ending="r.ending" /></span>
                  </button>
                </li>
              </ul>
            </section>
            <div v-if="ccMore" class="px-2 pb-1 pt-2">
              <button class="th-btn th-btn-sm" :disabled="ccLoading || busy" data-testid="cc-more" @click="loadChessCom(true)">
                <span v-if="ccLoading" class="h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-transparent"></span>
                Show more games
              </button>
            </div>
          </div>
        </section>
        <Teleport to="body">
          <div
            v-if="hovered"
            class="th-panel pointer-events-none fixed z-[60] p-2.5"
            :style="{ left: `${hovered.left}px`, top: `${hovered.top}px`, width: `${PREVIEW_W}px` }"
          >
            <p class="mb-1.5 truncate text-xs text-neutral-300">
              <span class="text-neutral-500">vs</span> {{ hovered.row.opponent }}
              <span class="text-neutral-500">· {{ hovered.row.kind }}</span>
            </p>
            <GamePreview :pgn="hovered.row.game.pgn" :orientation="hovered.row.side ?? 'white'" />
          </div>
        </Teleport>

        <div class="my-4 flex items-center gap-3 text-xs uppercase tracking-wide text-neutral-500">
          <span class="h-px flex-1 bg-white/5"></span>or paste a game<span class="h-px flex-1 bg-white/5"></span>
        </div>

        <label for="pgn" class="block text-sm font-medium text-neutral-200">Paste your game (PGN)</label>
        <textarea
          id="pgn"
          ref="area"
          v-model="pgn"
          data-testid="pgn-input"
          spellcheck="false"
          class="mt-2 h-36 w-full resize-y rounded-lg bg-neutral-900 p-3 font-mono text-xs leading-relaxed text-neutral-200 ring-1 ring-white/10 outline-none placeholder:text-neutral-600 focus:ring-amber-500/60"
          placeholder='[Event "Live Chess"]&#10;[White "..."]&#10;[Black "..."]&#10;&#10;1. e4 e5 2. Nf3 ...'
          @keydown="onPgnKey"
        ></textarea>
        <p v-if="error" class="mt-2 rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-300" data-testid="pgn-error">
          {{ error }}
        </p>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <button
            class="th-btn th-btn-primary"
            :disabled="busy"
            data-testid="pgn-submit"
            @click="submit"
          >
            <span v-if="busy" class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--th-paper)] border-t-transparent"></span>
            Analyse game
          </button>
          <button
            v-if="isMock"
            class="th-btn"
            data-testid="pgn-sample"
            @click="sample"
          >
            Use sample game
          </button>
        </div>

        <div v-if="recent.length" class="mt-5 border-t border-white/5 pt-4">
          <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Recently opened</div>
          <ul class="space-y-1">
            <li v-for="r in recent" :key="r.id">
              <button
                class="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm text-neutral-200 hover:bg-white/5"
                :disabled="busy"
                @click="open(r.id)"
              >
                <span class="min-w-0 flex-1 truncate">{{ r.white }} <span class="text-neutral-500">vs</span> {{ r.black }}</span>
                <span class="text-xs text-neutral-400">{{ r.result }}</span>
                <span class="w-20 text-right text-xs text-neutral-500">{{ r.date }}</span>
                <span class="w-16 text-right text-xs text-neutral-500">{{ r.moves }} moves</span>
              </button>
            </li>
          </ul>
        </div>
      </div>
      <footer class="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[13px] text-neutral-500" data-testid="site-footer">
        <a class="hover:underline" href="/about">About</a>
        <a class="hover:underline" href="/about#privacy">Privacy</a>
        <a class="hover:underline" href="/about#source">Source code &amp; licences</a>
        <a class="hover:underline" href="/chess-move-labels">What the move labels mean</a>
      </footer>
    </div>
  </main>
</template>
