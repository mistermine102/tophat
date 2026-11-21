<script setup lang="ts">
// Provides the session store (stores/session.ts) to everything inside: useSession().
import { provide } from 'vue';
import { type Session, SessionKey } from '../stores/session';

const props = defineProps<{ session: Session }>();
provide(SessionKey, props.session);
</script>

<template>
  <slot />
</template>
