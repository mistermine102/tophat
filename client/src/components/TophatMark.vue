<script setup lang="ts">
// The Tophat mark: a pawn in a top hat (ink, with a rust hat band).
</script>

<template>
  <svg viewBox="0 0 64 64" class="overflow-visible" aria-hidden="true" data-testid="tophat-mark">
    <g fill="var(--th-ink)">
      <circle cx="32" cy="31" r="9" />
      <rect x="22" y="39" width="20" height="4.5" rx="2.25" />
      <path d="M26.5 43.5h11c0 4 2.6 7.4 6 9.5H20.5c3.4-2.1 6-5.5 6-9.5z" />
      <rect x="15" y="52.5" width="34" height="7" rx="3.5" />
      <g transform="rotate(-9 32 18)">
        <path d="M24.6 21.5 23.4 4.6Q32 3.2 40.6 4.6L39.4 21.5Z" />
        <path fill="var(--th-accent)" d="M24.25 15.8h15.5l-.3 4.6H24.55Z" />
        <path d="M14.5 21.8Q32 17.6 49.5 21.8Q49 24.6 32 24.4Q15 24.6 14.5 21.8Z" />
      </g>
    </g>
  </svg>
</template>
