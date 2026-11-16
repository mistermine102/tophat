<script setup lang="ts">
// Header (Tophat logo = home, players, progress, Open game) + one of two screens (lib/route.ts): the Open screen
// (OpenScreen: the landing page when no game is open) or the game in layout A (board-first); the older layouts only
// by URL (`?ui=classic|b|c`, lib/uiMode.ts). All layouts share the session store. Phones (< 768px) get the phone
// layout (MobileLayout) instead of layout A, under a slimmer header.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import OpenScreen from './components/OpenScreen.vue';
import TophatMark from './components/TophatMark.vue';
import BoardFirstLayout from './layouts/BoardFirstLayout.vue';
import ClassicLayout from './layouts/ClassicLayout.vue';
import CoachLayout from './layouts/CoachLayout.vue';
import GoodBadLayout from './layouts/GoodBadLayout.vue';
import MobileLayout from './layouts/MobileLayout.vue';
import { isPhone } from './lib/phone';
import { playSound, soundFor } from './lib/sound';
import { gameIdOf, isOpenState, OPEN_STATE, type Screen, withGame } from './lib/route';
import { uiMode } from './lib/uiMode';
import { useSession } from './stores/session';

const session = useSession();

// Sound effects: one move forward (played, or "Next") sounds like that move, one move back a quiet knock, a jump
// (start / end / a click further away in the move list, another game) nothing.
watch(
  () => session.current.value,
  (now, before) => {
    if (!session.state.sound || !now || !before || screen.value !== 'game') return;
    if (now.parent === before && now.uci) playSound(soundFor(now.san, now.fen));
    else if (before.parent === now) playSound('back');
  },
);
/** null while booting (a `?game=` URL is being opened). */
const screen = ref<Screen | null>(null);
const game = computed(() => session.state.game);
const progress = computed(() => session.progress.value);
const analysing = computed(() => progress.value.total > 0 && progress.value.done + progress.value.failed < progress.value.total);
const health = computed(() => session.state.health);
/** A phone showing a game: the phone layout and a slimmer header. */
const phoneGame = computed(() => isPhone.value && uiMode.value === 'a' && screen.value === 'game');
/** 'about 2 min left' / 'under a minute left' (null until the pace is known). */
const timeLeft = computed(() => {
  const s = session.etaSeconds.value;
  if (s === null) return null;
  return s < 50 ? 'under a minute left' : `about ${Math.round(s / 60)} min left`;
});

const players = computed(() => {
  const h = game.value?.headers;
  if (!h) return null;
  const elo = (e?: string) => (e ? ` (${e})` : '');
  return { white: `${h.White ?? 'White'}${elo(h.WhiteElo)}`, black: `${h.Black ?? 'Black'}${elo(h.BlackElo)}`, result: h.Result ?? '*' };
});

/** The screen for the URL: `?game=<id>` opens that game (unless it is the one loaded), else the Open screen. */
async function route() {
  const id = gameIdOf(location.search);
  if (id && (session.state.game?.id === id || (await session.openGame(id)))) {
    screen.value = 'game';
    return;
  }
  // a game that can't be opened (e.g. gone from the server's cache): the Open screen says why, and a reload doesn't
  // try again
  if (id) history.replaceState(null, '', withGame(location.href, null));
  screen.value = 'open';
}

onMounted(async () => {
  await session.checkHealth();
  await route();
});
window.addEventListener('popstate', route);
onBeforeUnmount(() => window.removeEventListener('popstate', route));

/** Header "Open game" / the logo: the Open screen over the game, which stays loaded (Back returns to it). */
function showOpen() {
  if (screen.value === 'open') return;
  if (session.state.game) history.pushState(OPEN_STATE, '', withGame(location.href, null));
  screen.value = 'open';
}
/** Back from the Open screen to the loaded game. */
function backToGame() {
  if (!session.state.game) return;
  if (isOpenState(history.state)) history.back(); // → popstate → route()
  else {
    history.replaceState(null, '', withGame(location.href, session.state.game.id));
    screen.value = 'game';
  }
}

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (screen.value !== 'game' || e.ctrlKey || e.metaKey || e.altKey) return;
  const actions: Record<string, () => void> = {
    ArrowLeft: () => session.prev(),
    ArrowRight: () => session.next(),
    Home: () => session.first(),
    End: () => session.last(),
    f: () => session.flip(),
    n: () => session.nextMistake(),
    b: () => session.toggleShowBest(),
    m: () => session.toggleSound(),
  };
  const act = actions[e.key];
  if (act && session.state.tree) {
    e.preventDefault();
    act();
  }
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  session.dispose();
});
</script>

<template>
  <div class="flex h-full flex-col text-neutral-100 md:min-h-[600px]">
    <header class="flex h-14 shrink-0 items-center gap-4 px-5 pt-1 max-sm:gap-2 max-sm:px-3" :class="{ 'h-10! pt-0!': phoneGame }">
      <div class="flex items-center gap-2">
        <button
          class="-ml-1 flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-white/5"
          title="Home: your chess.com games, paste a game, recently opened"
          data-testid="home"
          @click="showOpen()"
        >
          <TophatMark :class="phoneGame ? 'h-7 w-7' : 'h-8 w-8'" />
          <span class="th-display text-[26px] font-bold leading-none tracking-[-0.01em] max-sm:text-[22px]" :class="{ 'text-[20px]!': phoneGame }">Tophat</span>
        </button>
        <span v-if="session.api.mode === 'mock'" class="th-badge th-badge-info max-sm:hidden!" title="Mock mode: fixture data, no server">
          Mock
        </span>
      </div>
      <!-- layout A shows the players above / below the board instead -->
      <div v-if="players && screen === 'game' && uiMode !== 'a'" class="min-w-0 truncate text-sm text-neutral-300" data-testid="players">
        <span class="mr-1 inline-block h-2.5 w-2.5 rounded-full th-side-white align-middle"></span>{{ players.white }}
        <span class="mx-1.5 text-neutral-500">vs</span>
        <span class="mr-1 inline-block h-2.5 w-2.5 rounded-full th-side-black align-middle"></span>{{ players.black }}
        <span class="ml-2 font-semibold text-neutral-200">{{ players.result }}</span>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <!-- analysis progress: quiet text while it runs; once complete only screen readers (and tests) see it -->
        <span
          v-if="game && screen === 'game'"
          class="inline-flex items-center gap-2 text-[13px] text-neutral-400"
          :class="{ 'sr-only': !analysing && !progress.failed }"
          role="status"
          data-testid="progress"
          :title="analysing ? 'The engine checks every move of the game. Moves that are done can be viewed already; the move you are looking at is analysed first.' : undefined"
        >
          <template v-if="analysing">
            <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent"></span>
            <!-- phones: just the count -->
            <span><span class="max-sm:hidden">Analysed </span>{{ progress.done }}/{{ progress.total }}</span><span v-if="timeLeft" class="text-neutral-500 max-sm:hidden" data-testid="time-left"> · {{ timeLeft }}</span>
          </template>
          <template v-else-if="progress.failed">Analysed {{ progress.done }}/{{ progress.total }}</template>
          <template v-else>Analysis complete</template>
          <span v-if="progress.failed" class="th-badge th-badge-bad" data-testid="failed-count">{{ progress.failed }} failed</span>
        </span>
        <span v-if="health && !health.ok" class="th-badge th-badge-bad" :title="health.error" data-testid="engine-down">Engine offline</span>
        <span v-if="session.state.connectionError" class="th-badge th-badge-bad" :title="session.state.connectionError">Connection lost</span>
        <button v-if="screen === 'game'" class="th-btn th-btn-primary" :class="{ 'h-8! px-2.5! py-0!': phoneGame }" :aria-label="phoneGame ? 'Open game' : undefined" data-testid="open-pgn" @click="showOpen()">
          <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4v12M4 10h12" /></svg>
          <template v-if="!phoneGame">Open<span class="max-sm:hidden"> game</span></template>
        </button>
      </div>
    </header>

    <OpenScreen v-if="screen === 'open'" @opened="screen = 'game'" @back="backToGame()" />

    <template v-else-if="screen === 'game' && game">
      <MobileLayout v-if="phoneGame" />
      <BoardFirstLayout v-else-if="uiMode === 'a'" />
      <CoachLayout v-else-if="uiMode === 'b'" />
      <GoodBadLayout v-else-if="uiMode === 'c'" />
      <ClassicLayout v-else />
    </template>

    <!-- booting: the game in the URL is being opened -->
    <main v-else class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <span class="h-6 w-6 animate-spin rounded-full border-2 border-neutral-500 border-t-transparent"></span>
      <p class="text-sm text-neutral-400">Loading…</p>
    </main>
  </div>
</template>

