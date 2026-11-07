# Backlog

Feedback from playing through real games (2026-11-06). Tickets are grouped into sessions; each session is meant to
be done in one sitting. Suggested order: A → B → C (C moves the analysis code, so land the analysis fixes first).

---

## Session A — Board and UI polish (client only)

### A1. Board tag colours: from the player's point of view, plus neutral blue
**Problem.** The square tags ("forked", "defended", "undefended", "pinned" …) are coloured from the point of view of
the side that just moved (`client/src/lib/consequences.ts`: "green = good for the side that moved"). So the same tag
is green on one move and red on the next, depending on who moved. "Forked" is green when *your opponent* forked
*your* rook. Nobody can tell what the colours mean.

**Change.**
- Colour tags from **the player's** point of view: the reviewed player (chess.com username / the side at the bottom of
  the board), not the side that moved.
  - **Green** = good for us (we fork, pin or attack an undefended piece).
  - **Red** = bad for us (our piece is forked, hanging, pinned or in danger).
  - **Blue** = neutral, nothing to react to (e.g. "defended": a normal response, not a threat).
- `MarkTone` becomes `'good' | 'bad' | 'neutral'`. Update the arrows the same way.
- Decide whether the sentence ✓ / ✗ tones in the explanation panel switch to the same point of view or keep the
  mover's. Whichever you pick, make the legend say it explicitly.
- Update `consequences.test.ts` and the "Label guide" legend.

### A2. Icons on board tags
**Problem.** "defended" and "undefended" look the same: same pill and colour, only the word differs.

**Change.** Add a small icon to each tag, e.g. a shield for defended, a broken shield / exclamation for
undefended / hanging, a fork for forked, a pin for pinned, a lock for trapped, a skull or # for mate. Together with
A1's colours, a tag should be readable without reading the word.

### A3. Label badge glyphs are off-centre
**Problem.** The glyph inside the round label badges (e.g. the purple ✗ Miss badge on the board) is not centred in
the circle.

**Change.** Centre glyphs inside the board badge and the move-list icons, checked on every label (book, best, great,
excellent, good, inaccuracy, mistake, miss, blunder, forced) and at both sizes.

### A4. "Open a game" as its own screen, not a modal
**Problem.** Picking a game (chess.com recent games, paste PGN, recently opened) is a modal over an empty page
(`client/src/components/PgnDialog.vue`, opened from `App.vue`).

**Change.** Make it a separate screen (route, e.g. `/` = game picker, `/game/:id` = analysis). The "+ Open game"
button and Back go to it. It is the landing page when no game is loaded. Keep the `?game=id` reload behaviour working,
or redirect it to the new route. Update the E2E tests that open the dialog.

---

## Session B — Move classification

### B1. Missing a free queen is labelled "Good"
**Example.** mistermine102 vs M1_2_3M, 2026-11-06: 6…Qh4?? leaves the queen en prise to Nf3. 7. O-O is labelled
**Good** ("stops Black's threat of checkmate with Qxf2#"), eval +10.3 → +7.3. 7. Nxh4 wins the queen *and* stops the
mate.

**Cause.** Labels are based on win-chance loss. At +10 → +7, White's win% barely moves (< 5%), so the move is Good.
Miss (`missApplies` in `server/src/analysis/classify.ts`) also needs `winLoss > miss.playedMinLoss` (5), so it can't
fire. The material rule only catches *hanging* material, not *not taking* free material.

**Change.** Missing a free piece (SEE-positive capture of ≥ a minor piece, which the opponent's last move hung) must
be at least **Miss**, even in a completely won position. Ideas:
- A material-based Miss: best move wins ≥ N points of material (quiet-point material, as in `material.ts`) that the
  played move doesn't win. Fire it regardless of win%.
- Optionally, a cp-drop floor for big drops in won positions (300 cp here). Watch the Lichess-agreement benchmark;
  Lichess itself would call this a Good/Inaccuracy, so log it as a deliberate deviation.
- The explanation should say it: "Missed Nxh4, which wins the queen for free (and also stops Qxf2#)."
- Regression test with this position. Bump `ANALYSIS_VERSION`.

### B2. Brilliant moves
**Problem.** No "Brilliant" label. The top good-move label is Great (only good move).

**Change.** Add a `brilliant` label (glyph `!!`, its own colour, above Great). Usual definition: a best (or
near-best) move that **sacrifices material** (piece left en prise or given up, material down at the quiet point of
the PV), but the position stays good / winning for the mover. Exclusions in the same style as `GreatRule`: not when
already completely winning anyway, not a simple recapture, not when the sacrifice is forced/only move in a lost
position, not for obvious trades. Add to `labels.ts`, the move list, the eval-graph markers, the accuracy row, the
label guide and the settings. Benchmark the false-positive rate on `bench/games` before shipping (target: rare and
never wrong, like Great).

---

## Session C — Run everything in the browser (no server)  *(big, its own session)*

### C1. Browser-only analysis with Stockfish WASM
**Goal.** The whole app runs in the browser: no Express server, no native Stockfish, no `npm run setup:engine`. A
static build you can host anywhere.

**Scope.**
- **Engine:** Stockfish WASM (NNUE) in Web Workers instead of `server/src/engine/uci.ts`. Multi-threaded WASM needs
  `SharedArrayBuffer` → the page must be cross-origin isolated (COOP/COEP headers in Vite dev and wherever it's
  hosted). Fall back to single-threaded when it isn't.
- **Pipeline:** move `server/src/analysis/*`, facts, classify, explain, book and the scheduler (priorities, focus,
  preemption) into `shared/` or the client, running in a worker. Most of it is pure TS on chessops already.
- **Cache:** SQLite (`data/cache.sqlite`) → IndexedDB, keyed the same way (settings hash + `ANALYSIS_VERSION`).
- **Opening book:** the vendored Lichess TSVs are loaded as static assets (lazy, ~0.3 s parse today).
- **chess.com import:** call the public API straight from the browser. Check CORS; it's currently proxied by the
  server.
- **Streaming:** SSE → worker messages. `ApiClient` becomes an in-process implementation of the same interface, so
  the UI barely changes.
- **Performance:** the server does an 84-ply game in ~70 s with 5 × 2 threads at depth 16. Measure in the browser.
  Likely needs fewer workers, adaptive depth, or labelling first and explaining later. Set a target (e.g. first
  label < 3 s, full game < 3 min on a typical laptop).
- **Tests:** move server tests to the new location. Engine integration tests run against the WASM build in Node (or
  are marked browser-only). E2E without the server. Update README, ARCHITECTURE.md and `npm start` / `npm run dev`.
- **Depends on:** Session B landed (avoids moving code that's about to change).

---

Feedback round 2 (2026-11-07). A–C are done (merged into master). The "Why" round (explanations from the played
move's own line, Miss only for concrete chances, gold Best star, "Show best move" toggle) is on `explanations-v2`.

## Session D — Fast feedback: "fast, then final"

### D1. Quick labels first, the full analysis after
**Problem.** A move takes ~3 s to get its label and a ply you jump to ~7.5 s (ARCHITECTURE.md "Performance
(browser)"): every ply runs the whole pipeline (deep d14 MultiPV 5 + threat / shallow / forcedness searches) before
anything is shown.
**Decision (2026-11-07):** "fast, then final" — a quick result shows almost at once, a deeper check runs in the
background, and the label only changes if the deeper check finds a real difference (Good → Blunder), never for small
shifts. No flickering arrows.
**Design.**
- `core/src/analysis/quick.ts`: `labelMove` with a light deep budget (≈ d10, MultiPV 2; own SearchCache params, so
  nothing mixes with the full searches) → a provisional `MoveAnalysis` (`provisional: true`): label, evals, best move,
  arrows, `labelText` without reasons, `nextBest`; no explanations.
- Scheduler: a `QUICK` priority between FOCUS and BACKGROUND. `GameManager.load` queues every ply's quick job, then
  the full jobs; `focus` bumps the ply's quick job too. Quick results are emitted as `analysis` events while the
  ply has no final one, and are not persisted.
- Sticky labels: `analyzeMove` gets the provisional label; when the full label is a neighbour on the same side
  (Excellent ↔ Good, Inaccuracy ↔ Mistake) the provisional one stays (labelText rendered for it). Best, Great,
  Brilliant, Miss, Book, Forced and any good ↔ bad change always take the full result.
- Side lines: `analyseQuick` (worker protocol + `ApiClient`), fired next to `analyse`; the session shows the quick
  label at once and the explanation when the full one arrives.
- Client: progress / "Analysis complete" count only final analyses; the explanation panel shows "Working out why…"
  for a provisional analysis; the badge shows the provisional label normally.
- Measure with `npm run bench:browser` (first label, focused ply). Target: a label < 0.5 s after a move is shown.

## Session E — Explanations, next steps (after reviewing `explanations-v2`)

### E1. More causes from the played move's line
`facts/cause.ts` covers a piece the move leaves loose that the line goes after, and trades into a lost / drawn
ending. Still told as "e3, f4 or c3 were all much better": moves whose damage is positional, e.g. 7.d3 and 8.Nd2 in
shiniimini–mistermine102. Candidates, each only when the line uses it: a line opened to the king (f3 opening e1–h4), a
hole the opponent's piece lands on, a development lead the opponent cashes in, a piece chased with tempo.
Corpus: `tmp/grade2.mjs` grading over 15 Lichess games (275 bad moves) — keep it as `bench/explanations.ts`.

### E2. A missed chance whose point is deeper
"f4 was much better. f4 attacks Black's knight on e5." (Re3, a −25% blunder): the best line's later payoff (the knight
is trapped / won ten plies on) isn't told. Extend the best line's story to its first kept material gain within
`LATER_PLIES` and say what it wins.
