# M6 acceptance test as a beginner (2026-10-25)

I played a beginner who never reads the code: start the app with `npm start`, paste a game, watch the analysis come
in, click through every mistake and blunder and read the panel, press "Play it", drag pieces in a few positions, use
"Back to game", flip the board, set the username, reload. All of it ran against the real app (full-depth default
profile, real Stockfish, a fresh cache each round) and was automated with Playwright
(`client/e2e/acceptance/acceptance.spec.ts`, run with `npm run acceptance` while `npm start` is running). The test
writes everything the panel said into a log and takes screenshots at 1366×768 (a common laptop) and 1920×1080. I
looked at the screenshots myself.

**Games:** a chess.com-style PGN written for this test (`client/e2e/acceptance/chesscom-SzymonPlays.pgn`: `[Event
"Live Chess"] [Site "Chess.com"]`, all the chess.com headers, `{[%clk 0:09:58.5]}` after every move, checked with
chessops: 69 plies, a beginner game where White hangs his queen twice while winning), plus three Lichess games with
blunders from `bench/games/lichess/`: 5frUvyHl (45 plies), mcz8Z7Cr (46), 57RP5sCb (41). In the Lichess games the
user is Black, which tests that the board flips and that "You" is right.

**Machine:** the CPU was shared with another agent, so the app ran with `ENGINE_PROCESSES=3 ENGINE_THREADS=3`
(3 processes × 1 thread, against the default 5 × 2).

Rounds: **r1** (before any fixes) → fixes → **r2** (all 4 games) → small fixes → **r3** (chess.com + 5frUvyHl). The
final screenshots are in `client/e2e/screenshots/acceptance-*.png`.

## Measured (3 × 1 threads, shared CPU)

| | r1 | r2 / r3 |
|---|---|---|
| board visible after "Analyse game" | 0.1–0.9 s | 0.1–0.9 s |
| whole game analysed (69 / 45 / 46 / 41 plies) | 49 / 34 / 27 / 26 s | 40–43 / 34 / 29 / 26 s |
| a move you are looking at that isn't analysed yet | 1.9–2.9 s | 1.4–3.9 s |
| "Play it" / dragged move analysed | 0.8–2.7 s | 0.3–2.8 s |
| reload (game reopens from the cache, analysis complete) | 60–114 ms | 59–68 ms |

"You" and the board side were right in every game (chess.com username = White; for the Lichess games the username
was the Black player and the board flipped). No layout problem at the page level at either size. The automatic
check's "h-overflow in board / eval-graph" lines are false alarms: chessground's coordinates and the graph's hover
label overflow inside containers with `overflow: hidden`, and nothing is visibly cut off.

## UX problems found and what was done

Severity: **High** = a beginner gets a wrong idea or gives up; **Medium** = confusing or slows them down;
**Low** = polish. All problems in my area (client, `npm start` / scripts, README) were fixed. The problems that
need explanation-template changes (outside my area) are listed under "Remaining".

| # | Sev. | Problem (round found) | Fix | Status |
|---|---|---|---|---|
| 1 | High | **The app didn't say how long the analysis would take.** It only showed "Analysed 2/69", and for the first seconds the panel was empty (r1). | The header now shows the time left, e.g. "Analysed 6/69 · under a minute left" / "about 2 min left", worked out from how fast moves are coming in. A tooltip explains that finished moves can already be viewed and that the move you're looking at goes first. | fixed (r2) |
| 2 | High | **The label sentence for material-rule labels contradicted the rest of the panel.** For 17...Qxh4 (the queen takes a knight and is taken back) it said "Black left the queen on h4 hanging (−5)", while the Immediate level said −6 and the story said −7. For 32...h5 it said "left the pawn on h5 hanging (−8)", but the 8 points came from a later promotion. For 26.Qb6 it said −8 while Immediate said −9 (r1). | `client/src/lib/reason.ts`: a piece is called "hanging" only when losing it is the whole loss, using the same number as the Immediate level (`hungLoss`). A capture now reads "took a knight with the queen, but the queen can be taken back (−6 points)". Anything else reads "lost material: the engine line ends 8 points worse than after Kxe4" (the server's wording). Numbers now always say "points". | fixed (r2), unit tests added |
| 3 | Medium | **First launch:** a bare "Open a game" box. Nothing said what the app does, the chess.com steps were small grey text, and the username was hidden in Settings, so a Black player's board stayed the wrong way round and "You" meant White (r1). | One welcome sentence; step-by-step chess.com instructions (Share → PGN → Copy PGN → Ctrl+V); a "Your chess.com username (optional, asked once)" field the first time; a "No game at hand? Try a sample" button. | fixed (r2) |
| 4 | Medium | **At 1366×768 the explanation was cut off with no sign there was more.** "Engine's top" sat below the fold. The panel also kept its scroll position when you moved to another move (r1). | Added a fade and a "More below ↓" button while text is cut off. The panel jumps back to the top for every new move. | fixed (r2) |
| 5 | Medium | **"Back to game" after "Play it" lost your place.** You played the suggestion for 13...Nd4?? and "Back to game" took you to 13.Nh4, the move before the blunder (r1). | "Back to game" now returns to the game move whose alternative you played (`MoveTree.returnTo`). After a drag it still returns to the position you dragged from. | fixed (r2), unit test |
| 6 | Medium | **No way to go from mistake to mistake once inside the game.** Key moments are only listed at the start position (r1). | "Next mistake ⏩" button next to the board, or the `N` key. It jumps to the next inaccuracy, mistake, miss or blunder of either side. | fixed (r2), unit test |
| 7 | Medium | **Jargon in the rule note:** "By win chance alone this would be 'Good'; the material rule makes it Mistake" (r1). | Now reads "Winning chances alone would say 'Good'. It's marked Mistake because it gives away material for nothing — a habit worth fixing even when the game is decided." The mate rule note uses the same wording ("…because it allows / misses a quick forced mate"). | fixed (r2) |
| 8 | Medium | **Running `npm start` twice:** the second copy started three engines and then failed with "port 5174 is already in use" (install test). | `npm start` checks the port first. If Chess Coach is already running it just opens the browser. If another program has the port it prints how to use another port. | fixed |
| 9 | Medium | **Skipping `npm run setup:engine`** meant the app opened with "Engine offline". | `npm start` downloads Stockfish itself when it is missing. | fixed |
| 10 | Low | The summary count columns were headed "Y" / "O" (r1). | Now "You" / "Opp", with fixed widths. r2 found "Inaccuracy" cut off at 1920×1080 (the text there is bigger); fixed by using px widths. | fixed (r3) |
| 11 | Low | The waiting text "this move was moved to the front of the queue" is jargon (r1). | Now "Analysing this move now — usually a few seconds." | fixed |
| 12 | Low | The eval graph wasn't explained, and the dots at the top and bottom were half cut off (r1). | Added "White ahead" / "Black ahead" captions, a tooltip ("Who was winning… dots mark mistakes… click to jump"), and kept the dots inside the graph. | fixed |
| 13 | Low | The label guide was a bare "?" button (r1). | Now a "? Label guide" button. | fixed (r3) |
| 14 | Low | "Deep engine move — hard to explain" appeared under concrete-looking Immediate facts, which reads as a contradiction (r1). | Reworded: "…its real point lies further ahead than the lines below. No simpler good move with a clear short-term point was found." (The root cause is #R4.) | mitigated |
| 15 | Low | Every `npm start` printed "ExperimentalWarning: SQLite is an experimental feature", which looks alarming to a beginner (install test). | The warning is suppressed in `scripts/start.mjs`. | fixed |
| 16 | Low | `npm run setup:engine` printed nothing during the 81 MB download, so a slow connection looked frozen (install test). | Progress is printed every 10 %. | fixed |

Totals: **2 High, 7 Medium, 7 Low found; all 16 fixed or mitigated.**

## Answers to the specific questions

- **Is it obvious what to do on first launch?** Now yes: the window says what the app does, how to copy a PGN on
  chess.com, asks for the username once, and offers a sample game.
- **Is it obvious that analysis is still running, and how long it will take?** Yes. There is a spinner chip with
  "Analysed n/N · about X min left" in the header, a progress bar in the summary, "partial n/N" on the summary, and
  "Analysing this move now…" for a move that isn't done yet. Moves fill in with labels as they finish.
- **Does the explanation panel scroll sensibly with long text?** Yes since #4: it scrolls on its own, shows "More
  below ↓" while something is cut off, and starts at the top for every move. At 1366×768 about half of the blunders
  need one scroll to reach "Engine's top".
- **Are the label colours and symbols understandable?** Mostly. Each symbol sits in a coloured circle, and the name
  appears in the panel and the key moments list. The "? Label guide" pop-up explains every label with its rule.
  Excellent and Good share the ✓ symbol and differ only by shade. That's acceptable, because both mean "fine".
- **Does the eval graph help?** It makes the turning points easy to see (a big jump with a red dot = the blunder),
  and it now says which side is which. Clicking it jumps to the move.
- **Is "You" correct?** Yes in all 4 games, including the Black ones. The board flips, and the summary and labels say
  "You" for the right side.

## Remaining (outside my area: `server/src/facts/**`, `analysis/explain.ts`, `analysis/suggest.ts`, for M5c)

| # | Sev. | Problem | Example |
|---|---|---|---|
| R1 | Medium | The Long-term level contradicts material-rule labels: it claims "compensation" for a move that was labelled a Mistake or Blunder *because* it gave material away. | 17...Qxh4 (Mistake, material rule): "Black gives up material, but the engine sees about 5.5 pawns' worth of compensation in the position." The same happens on 15...Nxe4 and 27.Qxd6+. |
| R2 | Medium | Prophylaxis text that refers to itself. | mcz8Z7Cr 9.O-O (Miss): "Misses d5, which prevents d5." 8...d5: "Prevents d5, White's best idea here… Black's pawn now stands on d5." |
| R3 | Medium | Some Mistakes only list good things, so a beginner can't see why the move was bad. | mcz8Z7Cr 11...Nxe4 (Mistake): "Wins White's pawn on e4 (+1 point)… Black wins a pawn (+1 point)." Nothing says what it allows. |
| R4 | Low | "Deep engine move — hard to explain" appears for moves whose own explanation has a concrete fact (the shallow search disagrees), which reads as a contradiction. | mcz8Z7Cr 9.d5: "Attacks Black's knight on c6 and pawn on e6 at once", yet it is shown as hard to explain. |
| R5 | Low | Different material numbers in the levels of the same move. | 15...Nxe4: "the engine line costs Black 3 points" vs "loses material when the pieces are traded off (−2 points)". |
| R6 | Low | Borderline labels change from run to run (the known M3 nondeterminism of about 5 %). | 17...Qxh4 was a Blunder in r1 and a Mistake in r2; 26...Ke6 was Good in r1 and Inaccuracy or Mistake later. |
| R7 | Low (client, left as is) | Key moments include inaccuracies and great moves, so a messy 45-ply game lists 16 entries. "Next mistake" covers stepping through them. | 5frUvyHl |
