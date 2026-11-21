<script setup lang="ts">
// Identity lab (dev only, /identity): static prototypes of the "Tophat" look on the board-first screen.
// Added by nuxt.config.ts (pages:extend) on a dev server started with LABS=1 only.
import { ClientOnly } from '#components';
import IdentityLab from './IdentityLab.vue';
import './identity.css';
</script>

<template>
  <ClientOnly><div id="identity"><IdentityLab /></div></ClientOnly>
</template>
