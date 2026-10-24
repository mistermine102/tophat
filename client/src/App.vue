<script setup lang="ts">
// M0 placeholder. The real v1 screen is built in M1c.
import { ANALYSIS_VERSION } from '@chess-coach/shared';
</script>

<template>
  <main class="flex min-h-screen flex-col items-center justify-center gap-2">
    <h1 class="text-4xl font-bold">Chess Coach</h1>
    <p class="text-sm text-neutral-400">analysis v{{ ANALYSIS_VERSION }}</p>
  </main>
</template>
