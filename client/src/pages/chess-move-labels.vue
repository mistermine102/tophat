<script setup lang="ts">
// Guide: what each move label means. The table comes from lib/labels.ts, the same text as the app's legend.
import LabelGlyph from '../components/LabelGlyph.vue';
import SitePage from '../components/SitePage.vue';
import { GUIDES } from '../guides';
import { LABEL_ORDER, LABELS } from '../lib/labels';
import { usePageSeo } from '../lib/seo';

const page = GUIDES.find((g) => g.path === '/chess-move-labels')!;
usePageSeo(page);
const rows = LABEL_ORDER.map((key) => ({ key, ...LABELS[key] }));
</script>

<template>
  <SitePage :path="page.path">
    <h1>What the chess move labels mean</h1>
    <p class="lead">
      Brilliant, Great, Best, Inaccuracy, Mistake, Miss, Blunder: a game review gives every move one of these labels.
      Here is what each one means and how Tophat decides it.
    </p>
    <p>
      Most labels come from one number: how much a move changed your <b>chance of winning</b>, compared with the best
      move in the position. Stockfish rates the position before and after the move, the rating is turned into a win
      chance, and the difference decides the label. Using win chance instead of raw pawns means a slip in a position
      that is already lost (or already won) counts for less than the same slip in a close game.
    </p>

    <h2>All labels at a glance</h2>
    <table>
      <thead>
        <tr><th>Label</th><th>Meaning</th><th>How it is decided</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.key" :id="r.key">
          <td class="whitespace-nowrap">
            <span class="inline-flex items-center gap-2"><LabelGlyph :label="r.key" /> <b>{{ r.name }}</b></span>
          </td>
          <td>{{ r.blurb }}</td>
          <td>{{ r.rule }}</td>
        </tr>
      </tbody>
    </table>

    <h2>Brilliant (!!) and Great (!)</h2>
    <p>
      A <b>Brilliant</b> move is a good sacrifice: you leave a piece where it can be taken, and the position still holds
      up (or gets better) because of a tactic. A <b>Great</b> move is the only good move in a position where everything
      else would have been a mistake: finding it is what counts. Both are rare, and many games have none.
    </p>

    <h2>Inaccuracy (?!), Mistake (?) and Blunder (??)</h2>
    <p>
      These three are the same thing at different sizes: how much of your winning chance the move gave away. An
      inaccuracy is a small slip, a mistake a real one, and a blunder usually loses material or the game, for example by
      leaving a piece undefended or allowing a quick checkmate.
    </p>

    <h2>Miss (✕)</h2>
    <p>
      A <b>Miss</b> is a missed chance rather than a bad move: your opponent had just made a mistake, and your reply let
      the chance to punish it slip, for example a move that would have won a piece or forced mate. Misses are worth
      looking at: they are the tactics you will want to spot next time.
    </p>

    <h2>Book and Forced</h2>
    <p>
      <b>Book</b> moves are known opening moves (Tophat checks the Lichess opening book), so there is nothing to judge
      yet. <b>Forced</b> means there was only one legal move.
    </p>

    <h2>See it on your own games</h2>
    <p>
      The labels make the most sense on a game you played yourself. Tophat labels every move of your game for free,
      explains each one in plain words and shows a better move where there was one.
    </p>
    <p class="cta"><a href="/" class="th-btn th-btn-primary">Review one of your games</a></p>
  </SitePage>
</template>
