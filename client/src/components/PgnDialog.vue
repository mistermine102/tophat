<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ApiError } from '../api/types';
import { useSession } from '../stores/session';
import ModalDialog from './ModalDialog.vue';

const props = defineProps<{ closable: boolean }>();
const emit = defineEmits<{ close: [] }>();
const session = useSession();
const pgn = ref('');
const error = ref<string | null>(null);
const busy = ref(false);
const area = ref<HTMLTextAreaElement | null>(null);
const isMock = session.api.mode === 'mock';
const recent = computed(() => session.state.recent.filter((r) => r.id !== session.state.game?.id));
// First run: ask for the chess.com username right here (it decides which side is 'You' and the board side).
const savedName = computed(() => session.state.settings.username);
const askName = ref(!session.state.settings.username && !isMock);
const username = ref('');

onMounted(() => area.value?.focus());

async function submit() {
  if (!pgn.value.trim()) {
    error.value = 'Paste a PGN first (chess.com: Share → PGN → Copy).';
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    const name = username.value.trim();
    if (askName.value && name) await session.saveSettings({ username: name }).catch(() => undefined);
    await session.importPgn(pgn.value);
    emit('close');
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
  if (ok) emit('close');
  else error.value = session.state.loadError;
}

async function sample() {
  const { FIXTURE_PGN } = await import("../fixtures/game");
  pgn.value = FIXTURE_PGN;
  error.value = null;
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
}
</script>

<template>
  <ModalDialog title="Open a game" :closable="props.closable" width="max-w-2xl" @close="emit('close')">
    <p v-if="!props.closable" class="mb-3 text-sm leading-relaxed text-neutral-300" data-testid="welcome">
      Chess Coach goes through one of your finished games move by move: a label for every move (Best, Mistake,
      Blunder …), what the move did, and a better move to try.
    </p>
    <label for="pgn" class="block text-sm font-medium text-neutral-200">Paste your game (PGN)</label>
    <p class="mt-0.5 text-xs text-neutral-400">
      On chess.com: open the finished game → <b class="font-semibold text-neutral-300">Share</b> (arrow icon under the board) →
      <b class="font-semibold text-neutral-300">PGN</b> → <b class="font-semibold text-neutral-300">Copy PGN</b>, then click below and press Ctrl+V.
    </p>
    <textarea
      id="pgn"
      ref="area"
      v-model="pgn"
      data-testid="pgn-input"
      spellcheck="false"
      class="mt-2 h-48 w-full resize-y rounded-lg bg-neutral-900 p-3 font-mono text-xs leading-relaxed text-neutral-200 ring-1 ring-white/10 outline-none placeholder:text-neutral-600 focus:ring-amber-500/60"
      placeholder='[Event "Live Chess"]&#10;[White "..."]&#10;[Black "..."]&#10;&#10;1. e4 e5 2. Nf3 ...'
      @keydown="onKey"
    ></textarea>
    <div v-if="askName" class="mt-3">
      <label for="pgn-username" class="block text-sm font-medium text-neutral-200">
        Your chess.com username <span class="font-normal text-neutral-500">(optional, asked once)</span>
      </label>
      <input
        id="pgn-username"
        v-model="username"
        data-testid="pgn-username"
        autocomplete="off"
        spellcheck="false"
        class="mt-1 h-9 w-64 max-w-full rounded-md bg-neutral-900 px-3 text-sm text-neutral-100 ring-1 ring-white/10 outline-none placeholder:text-neutral-600 focus:ring-amber-500/60"
        placeholder="e.g. magnuscarlsen"
        @keydown="onKey"
      />
      <span class="ml-2 text-xs text-neutral-500">so the board shows your side and “You” means you</span>
    </div>
    <p v-else-if="savedName" class="mt-2 text-xs text-neutral-500" data-testid="playing-as">
      Your chess.com username: <span class="text-neutral-300">{{ savedName }}</span> (change it in Settings)
    </p>
    <p v-if="error" class="mt-2 rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-300 ring-1 ring-rose-500/30" data-testid="pgn-error">
      {{ error }}
    </p>
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <button
        class="inline-flex h-9 items-center gap-2 rounded-md bg-amber-500 px-4 text-sm font-semibold text-neutral-950 hover:bg-amber-400 disabled:opacity-60"
        :disabled="busy"
        data-testid="pgn-submit"
        @click="submit"
      >
        <span v-if="busy" class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-900 border-t-transparent"></span>
        Analyse game
      </button>
      <button
        v-if="isMock || !props.closable"
        class="h-9 rounded-md bg-neutral-700 px-3 text-sm text-neutral-100 hover:bg-neutral-600"
        data-testid="pgn-sample"
        @click="sample"
      >
        {{ isMock ? "Use sample game" : "No game at hand? Try a sample" }}
      </button>
      <span class="ml-auto text-xs text-neutral-500">Ctrl+Enter to submit · first game of the PGN is used</span>
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
  </ModalDialog>
</template>
