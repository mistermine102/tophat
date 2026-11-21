<script setup lang="ts">
// Home: the app (components/ClientApp.vue → CoachApp.vue, browser only). The prerendered HTML holds the landing text
// below instead: what search engines, link previews and visitors without JavaScript see, and what shows for the
// moment until the app has started.
import { useHead } from '#imports';
import ClientApp from '../components/ClientApp.vue';
import TophatMark from '../components/TophatMark.vue';
import { ABOUT, GUIDES } from '../guides';
import { usePageSeo } from '../lib/seo';
import { SITE_NAME } from '../site';

const description =
  'Free chess game review in your browser: open your chess.com games by username or paste a PGN, and every move gets a label from Brilliant to Blunder, a plain-words explanation and a better move. Stockfish, no account, no limit.';
usePageSeo({ path: '/', title: 'Tophat: free chess game review for your chess.com games', description, fullTitle: true });
useHead({
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: SITE_NAME,
        description,
        applicationCategory: 'GameApplication',
        operatingSystem: 'Any (runs in the browser)',
        browserRequirements: 'A recent browser with WebAssembly (Chrome, Edge, Firefox, Safari)',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        isAccessibleForFree: true,
        license: 'https://www.gnu.org/licenses/gpl-3.0.html',
      }),
    },
  ],
});
</script>

<template>
  <div id="app">
    <ClientApp>
      <div class="mx-auto max-w-2xl px-5 py-10 th-prose" data-testid="landing">
        <div class="mb-4 flex items-center gap-2">
          <TophatMark class="h-10 w-10" />
          <span class="th-display text-[30px] font-bold leading-none">Tophat</span>
        </div>
        <h1>Free chess game review, move by move</h1>
        <p class="lead">
          Open your chess.com games by username or paste any game (PGN). Every move, yours and your opponent's, gets a
          label from Brilliant to Blunder, an explanation in plain words and a better move you can try on the board.
        </p>
        <ul>
          <li><b>Free and unlimited:</b> review as many games as you like. No account, no sign-up.</li>
          <li><b>Private:</b> the Stockfish engine runs inside your browser. Your games are not uploaded anywhere.</li>
          <li><b>Made to learn from:</b> why a move was a mistake, what the opponent threatened, what would have been better.</li>
        </ul>
        <nav aria-label="Guides">
          <h2>Guides</h2>
          <ul>
            <li v-for="g in GUIDES" :key="g.path"><a :href="g.path">{{ g.short }}</a></li>
            <li><a :href="ABOUT.path">About, privacy and licences</a></li>
          </ul>
        </nav>
      </div>
    </ClientApp>
  </div>
</template>
