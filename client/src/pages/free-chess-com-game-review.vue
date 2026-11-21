<script setup lang="ts">
// Guide: Tophat as a free review for chess.com games (the search people make when the free review runs out).
import SitePage from '../components/SitePage.vue';
import { GUIDES } from '../guides';
import { usePageSeo } from '../lib/seo';

const page = GUIDES.find((g) => g.path === '/free-chess-com-game-review')!;
usePageSeo(page);
</script>

<template>
  <SitePage :path="page.path">
    <h1>Free chess.com game review, with no daily limit</h1>
    <p class="lead">
      Type your chess.com username, click a game and get a full move-by-move review: free, for as many games as you
      want, without an account.
    </p>
    <p>
      chess.com's own Game Review is limited on free accounts. Tophat is a separate, free tool that reviews the same
      games. It reads your finished games from chess.com's public game archive, so there is nothing to copy or
      download, and it analyses them with Stockfish, the strongest open-source chess engine.
    </p>

    <h2>What you get for every game</h2>
    <ul>
      <li>
        <b>A label for every move</b>, yours and your opponent's: Brilliant, Great, Best, Excellent, Good, Inaccuracy,
        Mistake, Miss or Blunder (<a href="/chess-move-labels">what they mean</a>).
      </li>
      <li><b>An explanation in plain words:</b> what the move did, what it allowed, what the opponent was threatening.</li>
      <li><b>A better move</b> where there was one, with the line that shows why, to step through on the board.</li>
      <li><b>An overview of the game:</b> the evaluation graph, accuracy and how many moves of each kind both players made.</li>
      <li><b>"Next mistake"</b> to jump straight to the moves worth learning from.</li>
    </ul>

    <h2>How to review a chess.com game</h2>
    <ol>
      <li>Open <a href="/">Tophat</a>.</li>
      <li>Under <b>Your games on chess.com</b>, type your username and click <b>Show recent games</b>.</li>
      <li>Click a game. The review starts at once and fills in move by move as the engine works through it.</li>
    </ol>
    <p>
      Tophat remembers your username, so next time your latest games are already listed. You can also paste a game
      instead (<a href="/how-to-copy-pgn-chess-com">how to copy a PGN</a>), which works for games from Lichess or any
      other site too.
    </p>

    <h2>Private by design</h2>
    <p>
      The engine runs inside your browser, on your own computer or phone. Your games and their reviews are not uploaded
      to any server; they are saved in your browser so a game you open again is ready straight away. There are no ads
      and no tracking. Details are on the <a href="/about#privacy">privacy page</a>.
    </p>

    <h2>Questions</h2>
    <h3>Is it really free?</h3>
    <p>Yes. There is no paid plan and no limit on the number of games. Tophat is open-source software (GPL-3.0).</p>
    <h3>Do I need a chess.com account or password?</h3>
    <p>No. Tophat only reads the public list of your finished games, the same games anyone can see on your profile.</p>
    <h3>Is it the same as chess.com's Game Review?</h3>
    <p>
      No, it is an independent tool, not made by or affiliated with chess.com. It uses similar labels, but its own
      engine settings and explanations, so a label can now and then differ from the one chess.com would give.
    </p>
    <h3>Can I use it during a game?</h3>
    <p>No, and please don't: it is meant for reviewing <b>finished</b> games. Using an engine during a game is cheating.</p>
    <h3>Does it work on a phone?</h3>
    <p>Yes, in a recent phone browser. A long game takes a little longer to analyse on a phone than on a computer.</p>

    <p class="cta"><a href="/" class="th-btn th-btn-primary">Review your chess.com games</a></p>
  </SitePage>
</template>
