<script setup lang="ts">
// Piece lab (dev only, /pieces): the Tophat piece set (lib/pieceSet.ts) next to cburnett, on the app's real board in a few square palettes and coordinate styles.
// Added by nuxt.config.ts (pages:extend) on a dev server started with LABS=1 only.
import { ClientOnly } from '#components';
import PieceLab from './PieceLab.vue';

</script>

<template>
  <ClientOnly><div id="pieces"><PieceLab /></div></ClientOnly>
</template>
