# Chess Coach

Review your own chess.com games on your own PC. Paste a game, step through it, and for every move (yours and your
opponent's) Chess Coach shows a chess.com-style label (Best, Mistake, Blunder …), explains in plain words what the
move did, and suggests a better move you can actually understand. It uses the Stockfish engine, which runs **inside
your browser** (WebAssembly): there is no server, nothing is uploaded, and it needs no account.

It is meant for reviewing **finished** games, not for help during a game.

## What you need

- A recent desktop browser: Chrome, Edge or Firefox (Safari should work too)
- To run it from this folder: Windows 10 or 11, macOS or Linux and [Node.js 24](https://nodejs.org/) or newer (the
  "LTS" installer is fine; tick nothing special)
- An internet connection for the first install (`npm install` downloads everything, including the Stockfish engine)
- About 2 GB of free memory while a game is analysed (each engine copy needs about 0.4 GB; see "How long it takes")

## Install (once)

Open a terminal (PowerShell or Command Prompt) in this folder and run:

```
npm install
npm start
```

`npm start` opens Chess Coach in your browser at <http://localhost:5174> (the first start takes a few seconds longer:
it builds the app). Next time you only need `npm start` — keep that terminal window open while you use the app; to stop
it, press `Ctrl+C` there or close the window. Running `npm start` again while it is already running just opens the
browser. `npm start` only serves the files; the analysis itself happens in the browser tab. The first time, the browser
loads the engine (about 100 MB, from your own PC); after that it comes from the browser's cache.

### Hosting it somewhere else

`npm run build` writes a static site to `client/dist/` (the app, plus the engine files in `client/dist/engine/`). Any
static web host can serve it. For the fastest analysis the host should send the two cross-origin isolation headers
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (they allow the
multi-threaded engine, `?threads=2`); without them the default single-threaded engines still work. The engine's
`.wasm` files are about 100 MB each, more than some free hosts allow per file — the small engine (`?engine=lite`,
2 MB) works everywhere.

## Open a game from chess.com

**By username (easiest):** in Chess Coach click **Open game** or the **Chess Coach** logo (it opens by itself the first
time), type your chess.com username under **Your games on chess.com**, click **Show recent games** and click a game.
The box remembers the name, so next time the list appears by itself. Hover over a game to see it play through on a
small board. The list shows your 30 newest finished games (standard chess; variants like Chess960 are skipped), with
the result from your side, the opponent, time control and date. This needs an internet connection (it reads
chess.com's public game archive; no login or password).

**Or paste a PGN:**

1. Open the finished game on chess.com (Profile → Games, or the game review page).
2. Click **Share** (the arrow icon under the board) → **PGN** tab → **Copy PGN**.
3. In Chess Coach click **Open game** (it opens by itself the first time), paste with `Ctrl+V`, click **Analyse game**.

No game at hand? The first window has a **Try a sample** button with a short beginner game.

Clock times, comments and variations in the PGN are fine; they are ignored. If you paste several games, the first
one is used.

## Using it

- **Your side:** the side at the bottom of the board is "You". A game from your chess.com list opens on your side;
  a pasted game opens on the side whose player name matches the name in the chess.com box (else White). Wrong side?
  Flip the board (the ⇅ button or `F`) — "You" / "Opponent" switch with it, and the game remembers it. The players
  are shown above and below the board (name, rating, the pieces they have taken so far with +N for the side ahead in material, Won / Lost / Draw).
- **Mates on the board:** whenever the engine sees a forced mate, the king that gets mated is tagged "mate in N"
  (green if the side that just moved is mating, red if it is being mated); a mate that was let go is tagged
  "missed mate in N".
- **Step through the game:** the arrow buttons under the board, or the keyboard: `←` `→` one move, `Home` / `End`
  start and end, `F` flips the board. You can also click a move in the move list or a point on the eval graph
  (the graph shows who was winning; dots mark mistakes).
- **Next mistake** (or the `N` key) jumps straight to the next inaccuracy, mistake, miss or blunder.
- **Key moments:** at the start position the right-hand panel lists every mistake and great move — click one to
  jump there.
- **Try your own moves:** drag a piece. This starts a *side line* (shown indented in the move list); your move is
  analysed too. **Back to game** returns to where you were in the game.
- **Play a suggestion:** **Play it** next to "Try this" or "Engine's top" plays that move on the board. Hovering a
  move of the engine's line shows it on the board; clicking it plays the line up to there.
- Hover over a square name in an explanation (like "f7") to see that square highlighted on the board.
- **On the board:** the move's label sits on the moved piece, and what the move does is drawn on the board — green /
  red squares tagged "hanging", "forked", "pinned" … and thin arrows for who attacks what (green = good for the side
  that moved, red = bad). Every hanging piece has its square lightly tinted, on every move: red if it is yours,
  green if it is the opponent's (hanging = attacked and can be won: nothing defends it, a cheaper piece attacks it,
  or more attackers than defenders). Under the board: the eval graph. Next to it: the verdict with up to two ✓ / ✗
  points (the better move is the arrow on the board), and the moves right below (side lines you tried aren't listed).
- **Labels:** Best (★) is only the engine's top move; a different move that scores just as well is Excellent.
- **Older screens:** `?ui=classic`, `?ui=b` or `?ui=c` in the address still shows the earlier layouts.
- Recently opened games are listed in the **Open game** window (click **Open game** or the logo). Reopening one is instant.

## What the labels mean

The labels come from how much a move changed **the mover's winning chances** compared with the engine's best move
(the same formula Lichess uses). Click **? Label guide** (next to "Summary") in the app to see this table any time.

| Label | Symbol | Meaning |
|---|---|---|
| Book | ≡ | A known opening move (still "in the book"). |
| Forced | □ | The only legal move. |
| Great | ! | The best move, and the only good one — the second-best move would have been a mistake. |
| Best | ★ | The engine's top move (or practically as good). |
| Excellent | ✓ | Loses at most 2 % winning chances. |
| Good | ✓ | Loses at most 5 %. |
| Inaccuracy | ?! | Loses 5–10 %. A better move was available. |
| Mistake | ? | Loses 10–20 %. |
| Miss | ✕ | Your opponent had just made a mistake and you let the chance to punish it slip — or you missed a forced mate in 3 or less. |
| Blunder | ?? | Loses more than 20 %. |

Two extra rules make the labels honest about bad habits, even when the game was already decided:

- **Material rule:** giving away material for nothing is a mistake no matter the score. Losing 2+ points of
  material (a pawn = 1, knight/bishop = 3, rook = 5, queen = 9) is at least a **Mistake**, 3+ points at least a
  **Blunder**. So *hanging your queen while you are winning is still a Blunder* — the text then says something like
  "You're still winning, but this is the habit to fix." Correct sacrifices (the engine agrees the material was
  worth it) are not punished.
- **Mate rules:** a move that allows a forced mate in 3 or less (when another move avoided it) is a **Blunder**;
  missing your own forced mate in 3 or less is at least a **Miss**.

The **eval** numbers (like +1.5) are always from **White's** point of view: plus = White is better, minus = Black
is better, roughly in pawns. "M3" means mate in 3. **Accuracy %** per side uses the Lichess formula (100 = every move
was the engine's choice).

## How the explanations work

For the move you are looking at, the right-hand panel shows:

- the **label and the reason** (for example "leaves the queen on g5 hanging (−9)");
- **Immediate** — what the move does right now: checks, captures, attacks, forks, pins, a piece left hanging, or what
  it threatens next;
- **Short term** — the engine's main line for the next few moves, told as a story ("Nd5 attacks the queen → Nxc7+
  forks king and rook → White wins the exchange");
- **Long term** — changes in pawn structure, king safety, piece activity and so on.

For moves that were not the best, two suggestions can appear:

- **Try this** (green arrow) — the first good move whose point can be shown within a few moves, with its own
  explanation. This is usually the most useful one to learn from.
- **Engine's top** (blue arrow) — Stockfish's favourite, when it is a different move. If its point is too far away to
  explain, it says **"Deep engine move — hard to explain"**.

A red arrow on the board marks a threat. Every sentence is built only from facts the program checked on the board or
with the engine — nothing is made up. The explanations are still experimental: sometimes a level just says
"Nothing notable", and the labels are meant to be useful on their own.

## How long it takes

The board opens right away and labels appear move by move while the rest is analysed (the header shows
"Analysed 23/80 · about 1 min left"); the first label shows after about 2–3 seconds. A typical 40-move game takes
**about 1 minute** on a 6-core PC (e.g. Ryzen 5 3600: 84 plies in about 50 s with the default 6 engine copies, in the
browser). The move you are looking at and moves you try yourself jump the queue (a few seconds). Results are saved in
the browser, so opening the same game again is instant.

Chess Coach runs one engine copy per CPU core (minus two, at most six, fewer on PCs with little memory). Each copy
needs about 0.4 GB of memory. You can choose another number by adding `?engines=3` to the address (fewer = slower
but lighter), or use the much smaller engine with `?engine=lite` (2 MB instead of 100 MB to load, about a third
faster, a bit weaker).

## Troubleshooting

- **"Another program is using port 5174"** — close that program, or use a different port: `$env:PORT=5180;
  npm start` (PowerShell) or `set PORT=5180 && npm start` (Command Prompt), then open <http://localhost:5180>.
- **"Engine offline"** — the engine could not start in the browser (the panel says why). Reload the page; if your
  PC is short of memory, close other tabs or try `?engines=2` or `?engine=lite` in the address.
- **Analysis failed for a move** — click **Try again** in the panel. If it keeps failing, reload the page.
- **Clear the saved analyses** — they are stored in the browser (IndexedDB) for this address: clear the site data
  in the browser's settings (in Chrome: the icon left of the address → Site settings → Delete data). Games are
  analysed again the next time you open them.
- **The PC gets loud or slow during analysis** — that's Stockfish using the CPU. Use fewer engine copies, e.g. add
  `?engines=2` to the address; analysis then takes longer.
- **`npm` is not recognised** — Node.js is not installed (or the terminal was open before installing it; open a new
  one).

## For developers

```
npm run dev         # Vite dev server with hot reload (http://localhost:5173); the analysis runs in the page
npm test            # unit + integration tests (Vitest); engine tests use Stockfish WASM in Node
npm run typecheck   # tsc + vue-tsc
npm run build       # static production build (client/dist, incl. the engine files)
npm run e2e         # Playwright: mock UI tests + real in-browser analysis tests
npm run acceptance  # beginner walk-through against a running `npm start` (screenshots + log in tmp/acceptance)
npm run bench:browser -- <file.pgn> --url http://localhost:5173 [--query "engines=4"] [--probe]
                    # in-browser timing (Playwright Chromium, cold cache): first label, 10 plies, whole game
```

Workspaces: `shared/` (types, settings, win% formulas), `core/` (the analysis pipeline: engine wrapper, scheduler,
facts, labels, explanations — environment-neutral TypeScript), `client/` (Vue app; `client/src/worker/` runs `core`
in a Web Worker with Stockfish WASM workers and an IndexedDB cache).

URL parameters for the analysis: `engines=N`, `threads=N` (per engine; needs the isolation headers), `hash=MB`,
`engine=lite`, `profile=fast` (shallow searches, for tests), `testhooks=1`.

Benchmarks and tools run the same pipeline in Node: `npm run bench:engine` (engine timing), `npx tsx
core/scripts/analyze-pgn.ts game.pgn --out report.md` (whole pipeline → markdown), `npx tsx core/scripts/profile-game.ts
<pgn> --probe` (cold-cache timing), `npx tsx bench/puzzle-facts.ts` (facts vs Lichess puzzle themes), `npx tsx
bench/label-benchmark.ts run|report` (labels vs Lichess). In Node they use the WASM engine from the `stockfish` npm
package; set `STOCKFISH_PATH` to a native Stockfish binary to make them about 2× faster. Reports are in
`bench/reports/` (UX acceptance test: `bench/reports/acceptance.md`).

Docs: [SPEC.md](SPEC.md) (what it does), [ARCHITECTURE.md](ARCHITECTURE.md) (how: modules, worker protocol, analysis
budget), [PLAN.md](PLAN.md) (build history).

## License

Chess Coach is free software under the **GNU GPL v3.0 or later** (see [LICENSE](LICENSE)).
It uses [Stockfish](https://stockfishchess.org/) (GPL-3.0) compiled to WebAssembly by
[Stockfish.js](https://github.com/nmrugg/stockfish.js) (npm `stockfish`, GPL-3.0; its licence is copied next to the
engine files as `client/dist/engine/STOCKFISH-COPYING.txt`), [chessground](https://github.com/lichess-org/chessground)
and [chessops](https://github.com/niklasf/chessops) (GPL-3.0), and the
[Lichess opening book](https://github.com/lichess-org/chess-openings) (CC0). Not affiliated with chess.com or Lichess.

