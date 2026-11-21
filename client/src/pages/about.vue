<script setup lang="ts">
// About, privacy and licences (was public/about.html; /about.html still works: the prerendered file is about.html).
import SitePage from '../components/SitePage.vue';
import { ABOUT } from '../guides';
import { usePageSeo } from '../lib/seo';

usePageSeo({ ...ABOUT, title: ABOUT.title });
</script>

<template>
  <SitePage :path="ABOUT.path">
    <h1>About Tophat</h1>
    <p class="lead">A free chess coach that reviews your games move by move, in your browser.</p>
    <p>
      Open one of your chess.com games or paste a game, and Tophat labels every move (best, good, inaccuracy,
      mistake, blunder …), explains why a move was bad and shows what would have been better. The analysis is
      done by the <a href="https://stockfishchess.org/">Stockfish</a> chess engine, running inside your own
      browser tab.
    </p>

    <h2 id="privacy">Privacy</h2>
    <p>Tophat has no accounts and no database of its own. In short: your games stay on your device.</p>
    <ul>
      <li>
        <b>On your device:</b> the games you open, their analyses and your settings (sound, board options) are saved
        in your browser's own storage (IndexedDB and localStorage), so a game you open again is ready at once. They
        are not sent to us. To delete them, clear this site's data in your browser's settings.
      </li>
      <li>
        <b>chess.com:</b> when you look up a chess.com username, your browser asks chess.com's public API
        (<code>api.chess.com</code>) for that player's games. chess.com then receives your IP address and the
        username, as with any visit to their site; their own privacy policy applies. Tophat is not affiliated with
        chess.com.
      </li>
      <li>
        <b>Our web server</b> keeps standard access logs (IP address, time, the page requested, browser type) to
        keep the site running and secure. They are not used for anything else and are deleted regularly.
      </li>
      <li>
        <b>No tracking:</b> there are no analytics, no ads and no tracking cookies. The fonts and the engine are
        served from this site, not from third parties.
      </li>
    </ul>
    <p class="small">
      If that changes (for example if ads are added), this page will say so first.
    </p>

    <h2 id="source">Source code and licence</h2>
    <p>
      Tophat is free software under the
      <a href="https://www.gnu.org/licenses/gpl-3.0.html">GNU General Public License v3.0 or later</a>. Its full
      source code is on GitHub: <a href="https://github.com/mistermine102/tophat">github.com/mistermine102/tophat</a>.
    </p>
    <p>It is built on:</p>
    <ul>
      <li>
        <a href="https://stockfishchess.org/">Stockfish</a> (GPL-3.0), compiled to WebAssembly by
        <a href="https://github.com/nmrugg/stockfish.js">Stockfish.js</a> (GPL-3.0;
        <a href="/engine/STOCKFISH-COPYING.txt">licence</a>)
      </li>
      <li>
        <a href="https://github.com/lichess-org/chessground">chessground</a> and
        <a href="https://github.com/niklasf/chessops">chessops</a> (GPL-3.0), from Lichess
      </li>
      <li>the <a href="https://github.com/lichess-org/chess-openings">Lichess opening names</a> (CC0)</li>
      <li>
        move sounds from <a href="https://github.com/pychess/pychess">PyChess</a> (GPL-3.0-or-later;
        <a href="/sounds/CREDITS.md">details</a>)
      </li>
      <li>
        the <a href="https://fonts.google.com/specimen/Fraunces">Fraunces</a> and
        <a href="https://fonts.google.com/specimen/Figtree">Figtree</a> fonts (SIL Open Font License)
      </li>
    </ul>

    <h2 id="contact">Contact</h2>
    <p>
      Questions, bugs or ideas: <a href="https://github.com/mistermine102/tophat/issues">open an issue on GitHub</a>.
    </p>
  
  </SitePage>
</template>
