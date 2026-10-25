# Chess Coach

Review your own chess.com games on your own PC. Paste a game, step through it, and for every move (yours and your
opponent's) Chess Coach shows a chess.com-style label (Best, Mistake, Blunder …), explains in plain words what the
move did, and suggests a better move you can actually understand. It uses the Stockfish engine, runs entirely on your
computer and needs no account.

It is meant for reviewing **finished** games, not for help during a game.

## What you need

- Windows 10 or 11 (64-bit)
- [Node.js 24](https://nodejs.org/) or newer (the "LTS" installer is fine; tick nothing special)
- An internet connection for the first install (it downloads the Stockfish engine, about 80 MB)

## Install (once)

Open a terminal (PowerShell or Command Prompt) in this folder and run:

```
npm install
npm run setup:engine
npm start
```

`npm start` opens Chess Coach in your browser at <http://localhost:5174> (the first start takes a few seconds longer).
Next time you only need `npm start` — keep that terminal window open while you use the app; to stop it, press
`Ctrl+C` there or close the window. Running `npm start` again while it is already running just opens the browser.
(If you forget `npm run setup:engine`, `npm start` downloads Stockfish itself.)

## Get a PGN from chess.com

1. Open the finished game on chess.com (Profile → Games, or the game review page).
2. Click **Share** (the arrow icon under the board) → **PGN** tab → **Copy PGN**.
3. In Chess Coach click **Open PGN** (it opens by itself the first time), paste with `Ctrl+V`, click **Analyse game**.
   The first time, it also asks for your chess.com username (see below).

No game at hand? The first window has a **Try a sample** button with a short beginner game.

Clock times, comments and variations in the PGN are fine; they are ignored. If you paste several games, the first
one is used.

## Using it

- **Your username:** enter your chess.com username once (in the first window, or later in **Settings**). Then the
  board is turned to your side and "You" / "Opponent" are right. (Without it, White is "You".)
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
- **Try a different screen layout (prototypes):** the **Layout** switch in the header (or `?ui=a`, `?ui=b`, `?ui=c`
  in the address) shows three experimental screens: **A** board-first (the verdict next to the moved piece),
  **B** coach + replay ("Show me why" plays the consequences on the board), **C** good vs bad. In all three the
  move's label sits on the board, and every sentence is marked ✓ (good for the side that moved) or ✗ (bad).
  **Classic** is the normal screen.
- Recently opened games are listed in the **Open PGN** window. Reopening one is instant.

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
"Analysed 23/80 · about 1 min left"). A typical 40-move game takes **about 1–1.5 minutes** on a 6-core PC (e.g. Ryzen 5 3600). The move
you are looking at and moves you try yourself jump the queue (a few seconds). Results are saved, so opening the
same game again is instant.

## Troubleshooting

- **"Another program is using port 5174"** — close that program, or use a different port: `$env:PORT=5180;
  npm start` (PowerShell) or `set PORT=5180 && npm start` (Command Prompt), then open <http://localhost:5180>.
- **"Engine offline" / "Stockfish is not installed"** — run `npm run setup:engine` and start again. To use a
  Stockfish you already have, set `STOCKFISH_PATH` to the full path of `stockfish.exe`.
- **Analysis failed for a move** — click **Try again** in the panel. If it keeps failing, restart with `npm start`.
- **Clear the saved analyses** — stop Chess Coach and delete the `data` folder (it only holds the cache and your
  username). Games are analysed again the next time you open them.
- **The PC gets loud or slow during analysis** — that's Stockfish using the CPU. Use fewer engine processes, e.g.
  `$env:ENGINE_PROCESSES=2` (PowerShell) before `npm start`; analysis then takes longer.
- **`npm` is not recognised** — Node.js is not installed (or the terminal was open before installing it; open a new
  one).

## For developers

```
npm run dev         # server (5174) + Vite dev server with hot reload (http://localhost:5173)
npm test            # unit + integration tests (Vitest); engine tests skip without Stockfish
npm run typecheck   # tsc + vue-tsc
npm run build       # client production build
npm run e2e         # Playwright: mock UI tests + real-server tests (needs Stockfish)
npm run acceptance  # beginner walk-through against a running `npm start` (screenshots + log in tmp/acceptance)
```

Server environment: `PORT`, `STOCKFISH_PATH`, `ENGINE_THREADS` (total, default CPUs − 2), `ENGINE_PROCESSES`
(default threads / 2), `ENGINE_HASH_MB`, `CHESS_COACH_DB`, `ANALYSIS_PROFILE=fast`, `LOG_ANALYSIS=1`.

Benchmarks and tools: `npm run bench:engine` (engine timing), `npx tsx server/scripts/analyze-pgn.ts game.pgn --out
report.md` (whole pipeline → markdown), `npx tsx server/scripts/profile-game.ts <pgn> --probe` (cold-cache timing),
`npx tsx bench/puzzle-facts.ts` (facts vs Lichess puzzle themes), `npx tsx bench/label-benchmark.ts run|report`
(labels vs Lichess). Reports are in `bench/reports/` (UX acceptance test: `bench/reports/acceptance.md`).

Docs: [SPEC.md](SPEC.md) (what it does), [ARCHITECTURE.md](ARCHITECTURE.md) (how: modules, API, analysis budget),
[PLAN.md](PLAN.md) (build history).

## License

Chess Coach is free software under the **GNU GPL v3.0 or later** (see [LICENSE](LICENSE)).
It uses [Stockfish](https://stockfishchess.org/) (GPL-3.0, downloaded separately by `npm run setup:engine`, its
licence is saved next to it as `engine/STOCKFISH-COPYING.txt`), [chessground](https://github.com/lichess-org/chessground)
and [chessops](https://github.com/niklasf/chessops) (GPL-3.0), and the
[Lichess opening book](https://github.com/lichess-org/chess-openings) (CC0). Not affiliated with chess.com or Lichess.
