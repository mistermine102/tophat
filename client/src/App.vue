<script setup lang="ts">
// Header (Tophat logo = home, players, progress, Open game) + the screen: layout A (board-first); the older layouts only by
// URL (`?ui=classic|b|c`, lib/uiMode.ts). All layouts share the session store.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import PgnDialog from './components/PgnDialog.vue';
import TophatMark from './components/TophatMark.vue';
import BoardFirstLayout from './layouts/BoardFirstLayout.vue';
import ClassicLayout from './layouts/ClassicLayout.vue';
import CoachLayout from './layouts/CoachLayout.vue';
import GoodBadLayout from './layouts/GoodBadLayout.vue';
import { uiMode } from './lib/uiMode';
import { useSession } from './stores/session';

const session = useSession();
const showPgn = ref(false);
const booting = ref(true);
const game = computed(() => session.state.game);
const progress = computed(() => session.progress.value);
const analysing = computed(() => progress.value.total > 0 && progress.value.done + progress.value.failed < progress.value.total);
const health = computed(() => session.state.health);
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

onMounted(async () => {
  await session.checkHealth();
  const id = new URLSearchParams(location.search).get('game');
  if (id && (await session.openGame(id))) {
    booting.value = false;
    return;
  }
  booting.value = false;
  showPgn.value = true;
});

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (showPgn.value || e.ctrlKey || e.metaKey || e.altKey) return;
  const actions: Record<string, () => void> = {
    ArrowLeft: () => session.prev(),
    ArrowRight: () => session.next(),
    Home: () => session.first(),
    End: () => session.last(),
    f: () => session.flip(),
    n: () => session.nextMistake(),
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
  <div class="flex h-full min-h-[600px] flex-col text-neutral-100">
    <header class="flex h-14 shrink-0 items-center gap-4 px-5 pt-1">
      <div class="flex items-center gap-2">
        <button
          class="-ml-1 flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-white/5"
          title="Home: your chess.com games, paste a game, recently opened"
          data-testid="home"
          @click="showPgn = true"
        >
          <TophatMark class="h-8 w-8" />
          <span class="th-display text-[26px] font-bold leading-none tracking-[-0.01em]">Tophat</span>
        </button>
        <span v-if="session.api.mode === 'mock'" class="th-badge th-badge-info" title="Mock mode: fixture data, no server">
          Mock
        </span>
      </div>
      <!-- layout A shows the players above / below the board instead -->
      <div v-if="players && uiMode !== 'a'" class="min-w-0 truncate text-sm text-neutral-300" data-testid="players">
        <span class="mr-1 inline-block h-2.5 w-2.5 rounded-full th-side-white align-middle"></span>{{ players.white }}
        <span class="mx-1.5 text-neutral-500">vs</span>
        <span class="mr-1 inline-block h-2.5 w-2.5 rounded-full th-side-black align-middle"></span>{{ players.black }}
        <span class="ml-2 font-semibold text-neutral-200">{{ players.result }}</span>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <!-- analysis progress: quiet text while it runs; once complete only screen readers (and tests) see it -->
        <span
          v-if="game"
          class="inline-flex items-center gap-2 text-[13px] text-neutral-400"
          :class="{ 'sr-only': !analysing && !progress.failed }"
          role="status"
          data-testid="progress"
          :title="analysing ? 'The engine checks every move of the game. Moves that are done can be viewed already; the move you are looking at is analysed first.' : undefined"
        >
          <template v-if="analysing">
            <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent"></span>
            Analysed {{ progress.done }}/{{ progress.total }}<span v-if="timeLeft" class="text-neutral-500" data-testid="time-left"> · {{ timeLeft }}</span>
          </template>
          <template v-else-if="progress.failed">Analysed {{ progress.done }}/{{ progress.total }}</template>
          <template v-else>Analysis complete</template>
          <span v-if="progress.failed" class="th-badge th-badge-bad" data-testid="failed-count">{{ progress.failed }} failed</span>
        </span>
        <span v-if="health && !health.ok" class="th-badge th-badge-bad" :title="health.error" data-testid="engine-down">Engine offline</span>
        <span v-if="session.state.connectionError" class="th-badge th-badge-bad" :title="session.state.connectionError">Connection lost</span>
        <button class="th-btn th-btn-primary" data-testid="open-pgn" @click="showPgn = true">
          <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4v12M4 10h12" /></svg>
          Open game
        </button>
      </div>
    </header>

    <template v-if="game">
      <BoardFirstLayout v-if="uiMode === 'a'" />
      <CoachLayout v-else-if="uiMode === 'b'" />
      <GoodBadLayout v-else-if="uiMode === 'c'" />
      <ClassicLayout v-else />
    </template>

    <main v-else class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <template v-if="booting || session.state.loading">
        <span class="h-6 w-6 animate-spin rounded-full border-2 border-neutral-500 border-t-transparent"></span>
        <p class="text-sm text-neutral-400">Loading…</p>
      </template>
      <template v-else>
        <TophatMark class="h-14 w-14 opacity-40" />
        <p class="text-neutral-300">No game open.</p>
        <p v-if="session.state.loadError" class="max-w-md text-sm text-rose-300">{{ session.state.loadError }}</p>
        <button class="th-btn th-btn-primary mt-1" @click="showPgn = true">
          Open a game
        </button>
      </template>
    </main>

    <PgnDialog v-if="showPgn" :closable="!!game" @close="showPgn = false" />
  </div>
</template>

