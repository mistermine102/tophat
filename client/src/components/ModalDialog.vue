<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';

const props = withDefaults(defineProps<{ title: string; closable?: boolean; width?: string }>(), {
  closable: true,
  width: 'max-w-xl',
});
const emit = defineEmits<{ close: [] }>();

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.closable) emit('close');
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-white/25 p-4 backdrop-blur-[2px]" @mousedown.self="closable && emit('close')">
    <div class="th-panel w-full" :class="width" role="dialog" :aria-label="title">
      <header class="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
        <h2 class="th-display text-xl font-bold text-neutral-50">{{ title }}</h2>
        <button v-if="closable" class="rounded p-1 text-neutral-400 hover:bg-white/10 hover:text-neutral-100" aria-label="Close" @click="emit('close')">
          <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 5l10 10M15 5L5 15" /></svg>
        </button>
      </header>
      <div class="max-h-[calc(100vh-6rem)] overflow-y-auto px-5 py-4">
        <slot />
      </div>
    </div>
  </div>
</template>
