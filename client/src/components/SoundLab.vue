<script setup lang="ts">
// Dev-only (`?sounds` in the URL under `npm run dev`): a panel to play each move sound on its own, and a few times in
// a row (the variation between hits), for tuning lib/sound.ts.
import { onMounted, ref } from 'vue';
import { loadedSamples, playSound, preloadSounds, SOUND_KINDS, type SoundKind } from '../lib/sound';

const volume = ref(0.8);
/** Check / mate / draw as a capture too. */
const capture = ref(false);
/** Which recordings loaded (none: the synthesised fallback). */
const loaded = ref<string[] | null>(null);
onMounted(async () => {
  await preloadSounds();
  loaded.value = loadedSamples();
});

function play(kind: SoundKind) {
  playSound(kind, { volume: volume.value, capture: capture.value });
}

function burst(kind: SoundKind) {
  for (let i = 0; i < 4; i++) setTimeout(() => playSound(kind, { volume: volume.value, capture: capture.value }), i * 380);
}
</script>

<template>
  <div class="th-panel fixed bottom-4 right-4 z-50 w-64 p-3 text-sm" data-testid="sound-lab">
    <div class="mb-2 flex items-center justify-between">
      <b class="text-xs uppercase tracking-wide text-neutral-400">Sound lab</b>
      <label class="flex items-center gap-1 text-[11px] text-neutral-500">
        vol
        <input v-model.number="volume" type="range" min="0" max="1" step="0.05" class="w-20" />
      </label>
    </div>
    <p class="mb-2 text-[11px] text-neutral-500" data-testid="sound-lab-loaded">
      {{ loaded === null ? 'loading…' : loaded.length ? 'recordings: ' + loaded.join(', ') : 'no recordings: synthesised' }}
    </p>
    <div class="mb-2">
      <label class="flex items-center gap-1.5 text-[11px] text-neutral-400">
        <input v-model="capture" type="checkbox" />
        check / mate / draw with a capture
      </label>
    </div>
    <div v-for="k in SOUND_KINDS" :key="k" class="mb-1 flex items-center gap-1">
      <button class="th-btn flex-1 justify-start" @click="play(k)">{{ k }}</button>
      <button class="th-btn" title="Four in a row" @click="burst(k)">×4</button>
    </div>
  </div>
</template>
