<script setup lang="ts">
// Frame of the text pages (about, guides): the Tophat header with a way into the app, the page, links to the other
// pages. Links into the app are plain <a> (a full page load: the app starts fresh, like on a first visit).
import { NuxtLink } from '#components';
import { ABOUT, GUIDES } from '../guides';
import TophatMark from './TophatMark.vue';

defineProps<{ path: string }>();
</script>

<template>
  <div class="min-h-full px-4 py-6 sm:py-10">
    <header class="mx-auto mb-6 flex max-w-3xl items-center justify-between gap-3">
      <a href="/" class="flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-white/5">
        <TophatMark class="h-8 w-8" />
        <span class="th-display text-[26px] font-bold leading-none">Tophat</span>
      </a>
      <a href="/" class="th-btn th-btn-primary">Review a game</a>
    </header>
    <main class="th-panel th-prose mx-auto max-w-3xl px-5 py-7 sm:px-9">
      <slot />
    </main>
    <nav class="mx-auto mt-6 max-w-3xl text-sm" aria-label="Guides">
      <ul class="flex flex-wrap justify-center gap-x-5 gap-y-1 text-neutral-400">
        <li v-for="g in [...GUIDES, ABOUT]" :key="g.path">
          <span v-if="g.path === path" class="font-semibold text-neutral-200">{{ g.short }}</span>
          <NuxtLink v-else :to="g.path" class="hover:underline">{{ g.short }}</NuxtLink>
        </li>
      </ul>
    </nav>
  </div>
</template>
