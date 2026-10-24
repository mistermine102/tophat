<script setup lang="ts">
// v1 screen: header, board column (eval bar, board, navigation, eval graph), summary + move list, explanation.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import BoardArea from './components/BoardArea.vue';
import ExplanationPanel from './components/ExplanationPanel.vue';
import MoveList from './components/MoveList.vue';
import PgnDialog from './components/PgnDialog.vue';
import SettingsDialog from './components/SettingsDialog.vue';
import SummaryPanel from './components/SummaryPanel.vue';
import { useSession } from './stores/session';

const session = useSession();
const showPgn = ref(false);
const showSettings = ref(false);
const booting = ref(true);
const game = computed(() => session.state.game);
const progress = computed(() => session.progress.value);
const analysing = computed(() => progress.value.total > 0 && progress.value.done < progress.value.total);

const players = computed(() => {
  const h = game.value?.headers;
  if (!h) return null;
  const elo = (e?: string) => (e ? ` (${e})` : '');
  return { white: `${h.White ?? 'White'}${elo(h.WhiteElo)}`, black: `${h.Black ?? 'Black'}${elo(h.BlackElo)}`, result: h.Result ?? '*' };
});

onMounted(async () => {
  await session.loadSettings();
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
  if (showPgn.value || showSettings.value || e.ctrlKey || e.metaKey || e.altKey) return;
  const actions: Record<string, () => void> = {
    ArrowLeft: () => session.prev(),
    ArrowRight: () => session.next(),
    Home: () => session.first(),
    End: () => session.last(),
    f: () => session.flip(),
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
    <header class="flex h-12 shrink-0 items-center gap-4 border-b border-white/5 bg-neutral-900/80 px-4">
      <div class="flex items-center gap-2">
        <span class="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500 text-lg leading-none text-neutral-950">♞</span>
        <span class="text-[15px] font-bold tracking-tight">Chess Coach</span>
        <span
          v-if="session.api.mode === 'mock'"
          class="rounded bg-sky-500/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-sky-300"
          title="Mock mode: fixture data, no server"
        >
          Mock
        </span>
      </div>
      <div v-if="players" class="min-w-0 truncate text-sm text-neutral-300" data-testid="players">
        <span class="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-neutral-100 ring-1 ring-black/40 align-middle"></span>{{ players.white }}
        <span class="mx-1.5 text-neutral-500">vs</span>
        <span class="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-neutral-900 ring-1 ring-white/40 align-middle"></span>{{ players.black }}
        <span class="ml-2 font-semibold text-neutral-200">{{ players.result }}</span>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <span
          v-if="game"
          class="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs"
          :class="analysing ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/10 text-emerald-300'"
          data-testid="progress"
        >
          <span v-if="analysing" class="h-3 w-3 animate-spin rounded-full border-2 border-amber-400 border-t-transparent"></span>
          <span v-else>✓</span>
          <template v-if="analysing">Analysed {{ progress.done }}/{{ progress.total }}</template>
          <template v-else>Analysis complete</template>
        </span>
        <span v-if="session.state.connectionError" class="text-xs text-rose-300" :title="session.state.connectionError">Connection lost</span>
        <button class="hdr-btn" data-testid="open-pgn" @click="showPgn = true">
          <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4v12M4 10h12" /></svg>
          Open PGN
        </button>
        <button class="hdr-btn" data-testid="open-settings" title="Settings" @click="showSettings = true">
          <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="10" cy="10" r="2.6" />
            <path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1L4.7 4.7" />
          </svg>
          Settings
        </button>
      </div>
    </header>

    <main v-if="game" class="flex min-h-0 flex-1 gap-4 p-4">
      <BoardArea class="shrink-0" />
      <div class="flex min-h-0 w-[292px] shrink-0 flex-col gap-3">
        <SummaryPanel />
        <MoveList />
      </div>
      <div class="min-h-0 min-w-[300px] flex-1 overflow-y-auto pr-1">
        <ExplanationPanel />
      </div>
    </main>

    <main v-else class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <template v-if="booting || session.state.loading">
        <span class="h-6 w-6 animate-spin rounded-full border-2 border-neutral-500 border-t-transparent"></span>
        <p class="text-sm text-neutral-400">Loading…</p>
      </template>
      <template v-else>
        <div class="text-5xl text-neutral-700">♞</div>
        <p class="text-neutral-300">No game open.</p>
        <p v-if="session.state.loadError" class="max-w-md text-sm text-rose-300">{{ session.state.loadError }}</p>
        <button class="mt-1 h-9 rounded-md bg-amber-500 px-4 text-sm font-semibold text-neutral-950 hover:bg-amber-400" @click="showPgn = true">
          Paste a PGN
        </button>
      </template>
    </main>

    <PgnDialog v-if="showPgn" :closable="!!game" @close="showPgn = false" />
    <SettingsDialog v-if="showSettings" @close="showSettings = false" />
  </div>
</template>

<style scoped>
@reference "./style.css";
.hdr-btn {
  @apply inline-flex h-8 items-center gap-1.5 rounded-md bg-neutral-800 px-2.5 text-sm text-neutral-200 ring-1 ring-white/5 hover:bg-neutral-700;
}
</style>
