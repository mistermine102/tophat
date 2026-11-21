<script setup lang="ts">
// Guide: copying a game's PGN from chess.com and Lichess (README "Open a game from chess.com").
import SitePage from '../components/SitePage.vue';
import { GUIDES } from '../guides';
import { usePageSeo } from '../lib/seo';

const page = GUIDES.find((g) => g.path === '/how-to-copy-pgn-chess-com')!;
usePageSeo(page);
</script>

<template>
  <SitePage :path="page.path">
    <h1>How to copy a game’s PGN from chess.com (and Lichess)</h1>
    <p class="lead">
      A PGN is a chess game written down as plain text: the players, the result and every move. Copy it from the site
      where you played and you can paste it into any analysis tool.
    </p>

    <h2>The quickest way for chess.com: skip the PGN</h2>
    <p>
      In <a href="/">Tophat</a> you don't need the PGN of a chess.com game at all: type your username under
      <b>Your games on chess.com</b>, click <b>Show recent games</b> and click the game. Tophat reads it from chess.com's
      public game archive.
    </p>

    <h2>Copy the PGN on chess.com</h2>
    <ol>
      <li>Open the finished game on chess.com (your profile → <b>Games</b>, or the game's review page).</li>
      <li>Click <b>Share</b>, the arrow icon under the board.</li>
      <li>Open the <b>PGN</b> tab and click <b>Copy PGN</b>.</li>
    </ol>

    <h2>Copy the PGN on Lichess</h2>
    <ol>
      <li>Open the finished game on lichess.org.</li>
      <li>Under the board, open <b>Share &amp; export</b> (on the analysis board: the PGN box under the moves).</li>
      <li>Copy the PGN text.</li>
    </ol>

    <h2>Paste it into a review</h2>
    <ol>
      <li>Open <a href="/">Tophat</a>.</li>
      <li>Click into <b>Paste your game (PGN)</b> and paste with <code>Ctrl+V</code> (<code>⌘V</code> on a Mac).</li>
      <li>Click <b>Analyse game</b>.</li>
    </ol>
    <p>
      Clock times, comments and side variations in the PGN are fine: they are ignored. If the text holds several games,
      the first one is used.
    </p>

    <h2>What a PGN looks like</h2>
    <pre class="overflow-x-auto rounded-lg bg-[var(--th-paper-2)] p-3 text-xs leading-relaxed"><code>[Event "Live Chess"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Na5 ... 1-0</code></pre>
    <p>
      The lines in square brackets are the game's details; after them come the moves in standard notation (<code>Nf3</code>:
      knight to f3, <code>exd5</code>: the e-pawn takes on d5) and the result.
    </p>

    <p class="cta"><a href="/" class="th-btn th-btn-primary">Paste a game and review it</a></p>
  </SitePage>
</template>
