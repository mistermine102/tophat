<script setup lang="ts">
// The chess app (CoachApp.vue) on the home page, browser only: starts the session (boot.ts) once mounted, then
// provides it to the app. While prerendering and until it has started, the page shows the slot (the home page's
// text), so search engines and visitors without JavaScript see what Tophat is.
import { defineAsyncComponent, onMounted, shallowRef } from 'vue';
import type { Session } from '../stores/session';
import SessionScope from './SessionScope.vue';

// loaded in the browser only: its modules use window, location, Workers …
const CoachApp = defineAsyncComponent(() => import('../CoachApp.vue'));

const session = shallowRef<Session | null>(null);
const failed = shallowRef<string | null>(null);

onMounted(async () => {
  try {
    const { startSession } = await import('../boot');
    session.value = await startSession();
  } catch (e) {
    failed.value = (e as Error).message;
  }
});
</script>

<template>
  <SessionScope v-if="session" :session="session">
    <CoachApp />
  </SessionScope>
  <div v-else class="h-full overflow-y-auto">
    <p v-if="failed" class="p-6 text-rose-300" role="alert">Tophat could not start in this browser: {{ failed }}</p>
    <slot />
  </div>
</template>
