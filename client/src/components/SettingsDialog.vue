<script setup lang="ts">
import { ref } from 'vue';
import { useSession } from '../stores/session';
import ModalDialog from './ModalDialog.vue';

const emit = defineEmits<{ close: [] }>();
const session = useSession();
const username = ref(session.state.settings.username ?? '');
const busy = ref(false);
const error = ref<string | null>(null);

async function save() {
  busy.value = true;
  error.value = null;
  try {
    await session.saveSettings({ username: username.value.trim() || null });
    emit('close');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ModalDialog title="Settings" width="max-w-md" @close="emit('close')">
    <form class="space-y-3" @submit.prevent="save">
      <div>
        <label for="username" class="block text-sm text-neutral-300">chess.com username</label>
        <input
          id="username"
          v-model="username"
          data-testid="settings-username"
          autocomplete="off"
          class="mt-1.5 h-9 w-full rounded-md bg-neutral-900 px-3 text-sm text-neutral-100 ring-1 ring-white/10 outline-none focus:ring-amber-500/60"
          placeholder="e.g. magnuscarlsen"
        />
        <p class="mt-1.5 text-xs text-neutral-500">
          Used to find your side in a PGN: the board is oriented to you and the summary shows “You” vs “Opponent”.
        </p>
      </div>
      <p v-if="error" class="rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{{ error }}</p>
      <div class="flex justify-end gap-2">
        <button type="button" class="h-9 rounded-md px-3 text-sm text-neutral-300 hover:bg-white/5" @click="emit('close')">Cancel</button>
        <button
          type="submit"
          class="h-9 rounded-md bg-amber-500 px-4 text-sm font-semibold text-neutral-950 hover:bg-amber-400 disabled:opacity-60"
          :disabled="busy"
          data-testid="settings-save"
        >
          Save
        </button>
      </div>
    </form>
  </ModalDialog>
</template>
