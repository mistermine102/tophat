<script setup lang="ts">
// The little icon in front of a board tag (BoardTags), so the tags read at a glance without the word: a shield for
// "defended", a crossed-out shield for "undefended", a crosshair for "attacked", a pushpin for "pinned" … Drawn in
// currentColor on a 16×16 grid.
import type { MarkKind } from '../lib/consequences';

defineProps<{ kind: MarkKind }>();
</script>

<template>
  <svg viewBox="0 0 16 16" class="shrink-0" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" :data-icon="kind">
    <!-- defended: a solid shield -->
    <path v-if="kind === 'defended'" d="M8 1.6 13.4 3.6v3.9c0 3.3-2.2 5.7-5.4 6.9-3.2-1.2-5.4-3.6-5.4-6.9V3.6z" fill="currentColor" />
    <!-- undefended: an empty shield, crossed out -->
    <template v-else-if="kind === 'undefended'">
      <path d="M8 1.6 13.4 3.6v3.9c0 3.3-2.2 5.7-5.4 6.9-3.2-1.2-5.4-3.6-5.4-6.9V3.6z" />
      <path d="M2 14 14 2" />
    </template>
    <!-- hanging: a bold "!" (free to take) -->
    <template v-else-if="kind === 'hanging'">
      <path d="M8 2.2v7.3" stroke-width="2.6" />
      <circle cx="8" cy="13.4" r="1.5" fill="currentColor" stroke="none" />
    </template>
    <!-- in danger: a warning triangle -->
    <template v-else-if="kind === 'danger'">
      <path d="M8 1.8 14.6 13.8H1.4z" />
      <path d="M8 6.2v3.4M8 11.8v.1" />
    </template>
    <!-- attacked: a crosshair -->
    <template v-else-if="kind === 'attacked'">
      <circle cx="8" cy="8" r="4.6" />
      <path d="M8 1v3M8 12v3M1 8h3M12 8h3" />
    </template>
    <!-- forked: a two-pronged fork -->
    <path v-else-if="kind === 'forked'" d="M8 15V9.2M3.6 1.6v3.6a4.4 4.4 0 0 0 8.8 0V1.6" />
    <!-- pinned: a pushpin -->
    <path v-else-if="kind === 'pinned'" d="M5.5 1.8h5M6.8 1.8v4L4.2 9h7.6L9.2 5.8v-4M8 9v5.4" />
    <!-- skewered: two pieces on one line -->
    <template v-else-if="kind === 'skewered'">
      <path d="M1 8h14" />
      <circle cx="5.2" cy="8" r="2.4" fill="currentColor" />
      <circle cx="11" cy="8" r="2.4" fill="currentColor" />
    </template>
    <!-- trapped: a padlock -->
    <template v-else-if="kind === 'trapped'">
      <rect x="2.8" y="7" width="10.4" height="7.4" rx="1.4" fill="currentColor" />
      <path d="M5 7V5.2a3 3 0 0 1 6 0V7" />
    </template>
    <!-- safe now: a tick -->
    <path v-else-if="kind === 'safe'" d="M2.6 8.6 6.3 12.2 13.4 4" stroke-width="2.3" />
    <!-- mate in N / checkmate: a crown; missed mate: the crown crossed out -->
    <template v-else>
      <path d="M2 12.6h12l-.9-7.8-3 3L8 3.2 5.9 7.8l-3-3z" :fill="kind === 'missed-mate' ? 'none' : 'currentColor'" />
      <path v-if="kind === 'missed-mate'" d="M2 15 14 1" />
    </template>
  </svg>
</template>
