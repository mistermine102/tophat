# Chess Coach — Product Spec (v1)

Agreed with the user in a grilling session on 2026-10-24. This is the source of truth for *what* we build.
`ARCHITECTURE.md` describes *how*.

## Purpose

Review your own finished chess.com games locally with:

1. **chess.com-style move labels** for every move of both sides (main feature).
2. **Explainable suggestions**: instead of only the engine's best move (whose point may be 20 moves away), suggest
   the first *good* move whose point is near-term and can be explained in human terms.
3. **A three-level explanation** (Immediate / Short term / Long term) for every move (experimental feature —
   the user doubts it will work well and wants to test it; labels must stand on their own if it doesn't).

**Golden rule:** every explanation is built only from facts the tool verified on the board or with the engine.
Nothing is invented. Wording is template-based in v1. Facts are stored as structured data so a later AI step may
rephrase them (and must never do chess analysis itself).

## Users and usage

- Single user, runs locally on their Windows PC (Ryzen 5 3600, 12 threads, 16 GB). Beginner chess player.
- Not used during live games (fair play).

## Input and navigation

- User pastes a **PGN** (chess.com: *Share → PGN*). Multiple-game PGNs: take the first game. Comments, clock
  annotations (`{[%clk ...]}`), NAGs, variations in the input are tolerated and ignored.
- Board shows the game; **arrows / buttons / keyboard (←, →, Home, End)** step through it; clicking a move in the
  move list or a point on the eval graph jumps there.
- **Exploration:** in any position the user can drag pieces to try other moves. This creates a side line branching
  from that position. Side-line moves are analysed on demand with the same pipeline. "Back to game" returns to the
  main line position the side line branched from.
- **Orientation:** user stores their chess.com username once (settings). The tool reads `[White]`/`[Black]` from the
  PGN and orients the board to the user's side; "You" in the summary = that side. A flip button exists. If the
  username matches neither side, White is "You" and orientation defaults to White.

## Move labels (every move, both sides)

Win chance (mover's perspective) uses the Lichess formula:
`win% = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)`, cp clamped to ±1000, mate = ±1000 (mate for mover = +).

`winLoss = win%(best move) - win%(played move)`, both from the mover's perspective, both from the same deep search.

Labels (thresholds are settings; defaults approximate chess.com's expected-points bands):

| Label | Rule |
|---|---|
| **Forced** | The played move was the only legal move. |
| **Book** | Position after the move is in the opening book (Lichess `chess-openings`, CC0) and every earlier move in the game was also book. |
| **Best** | Played move is the engine's #1 move, or `winLoss ≤ 0.5`. |
| **Great !** | Played move is Best **and** the engine's 2nd-best move would be a Mistake or worse (`winLoss(2nd) ≥ mistake threshold`) **and** the position wasn't already totally decided in a way that makes the choice irrelevant (mover's win% after best move between 10 and 97, or the 2nd best throws away a win). Requires ≥2 legal moves. |
| **Excellent** | `winLoss ≤ 2` |
| **Good** | `winLoss ≤ 5` |
| **Inaccuracy ?!** | `5 < winLoss ≤ 10` |
| **Mistake ?** | `10 < winLoss ≤ 20` |
| **Blunder ??** | `winLoss > 20` |
| **Miss** | The opponent's previous move was a Mistake/Blunder (by win chance), the best move now would have kept most of that gain, and the played move gave back ≥ an inaccuracy's worth (`winLoss > 5`). Replaces Inaccuracy/Mistake; a Blunder stays Blunder. |

**Material rule (user requirement):** a move that throws away material for nothing is labelled by material too,
and the final label is the *worse* of win-chance label and material label. This makes "hung my queen while +12"
a Blunder.
- Material outcome = mover's material balance at the end of the engine's principal variation after the move,
  resolved to a quiet point (end of capture/recapture sequence, within a horizon), compared with the same measure
  for the best move.
- Material loss ≥ 3 pawns **and** eval drop ≥ 250 cp (mover POV, clamped) → at least **Blunder**.
- Material loss ≥ 2 pawns **and** eval drop ≥ 150 cp → at least **Mistake**.
- The eval-drop guard exempts correct sacrifices (material goes, eval doesn't). Even trades lose no net material.
- The UI states it honestly, e.g. *"Blunder ?? — you left your queen hanging (−9). You're still winning
  (+12.0 → +3.1), but this is the habit to fix."*

**Mate rules (user requirement, same philosophy; added in M3):** honest labels for bad habits even in decided
positions, where the win% clamp hides everything.
- **Allowed mate:** the played move allows a forced mate in ≤ 3 moves (setting) that the best move avoids (or only
  allows a much longer one, ≥ 3 moves longer) → at least **Blunder**, even if win% was already ~0
  (Opera game 15...Nxd7?? allows 16.Qb8+! Nxb8 17.Rd8#; 15...Qxd7 avoids the mate).
- **Missed mate:** the mover had a forced mate in ≤ 3 (setting) and played a move that doesn't force mate → at
  least **Miss** (a Blunder stays a Blunder; a slower mate is not "missed").
- The UI says it, e.g. *"Blunder ?? — this allows a forced mate in 2. Black was already losing, but Qxd7 would have
  avoided it — watch for mating threats."*

**Great — obvious only-moves excluded (M3):** recaptures/take-backs, check evasions with ≤ 3 legal moves, taking
free material (the capture's static exchange alone wins material: a hanging piece or a free pawn), and the next
move of a combination after the opponent had a single legal reply.

Severity order (for "worse of"): Blunder > Miss > Mistake > Inaccuracy > Good > Excellent > Best/Great/Book/Forced.

**Brilliant** is out of v1.

**Accuracy %** per side: Lichess formulas — per-move accuracy
`103.1668 * exp(-0.04354 * (winBefore - winAfter)) - 3.1669` clamped to [0,100] (mover POV, win% before = position
eval before the move, after = eval after the move); game accuracy = mean of (volatility-weighted mean, harmonic
mean) as in Lichess `AccuracyPercent.scala`.

## Three-level explanation (every move, both sides — experimental)

Each level is a list of verified facts rendered by templates. A level may honestly say "nothing notable"
or "you just had to play it" (when every alternative was much worse and nothing changes long-term).

1. **Immediate** — what the move does right now (board facts, before vs after):
   check / checkmate / capture (and whether it wins material, is an even trade, or a recapture) / promotion /
   castling / development / new attacks on enemy pieces that are undefended or worth more than the attacker /
   fork / pin / skewer / discovered attack / escaping an attack (a piece was en prise, now safe) / defending an
   attacked piece / blocking or escaping check / **hanging** a piece (negative fact) / **threat**: what the mover
   would play next if the opponent passed (null-move engine search), with its verified gain, incl. mate threats.
2. **Short term** — a chained story from the engine's principal variation (first ~4–8 plies): each step's key
   facts, whether the opponent's reply was **forced** (verified: alternatives are much worse), and the
   material/mate result at the end of the line. E.g. *"Nd5 attacks the queen → her only safe square is d8 →
   Nxc7+ forks king and rook → you win the exchange (+2)."*
3. **Long term** — positional feature deltas before vs after the move (and after the short line):
   king safety, pawn structure (passed/isolated/doubled pawns), piece mobility, centre control, development,
   rooks on open files, bishop pair. Plus: eval gain not explained by material in the short line → "positional
   gain"; gain seen only by deep search, not shallow → "the payoff is far away".

## Suggestions

For every move that isn't Best/Great/Book/Forced:

- Candidates = engine's top 5 moves (deep MultiPV).
- **Explainable pick** = first candidate in engine order that:
  1. would itself be labelled **Good or better** (`winLoss ≤ 5`) and passes the material rule;
  2. **keeps the result**: if the best move keeps the mover winning (win% ≥ 70) the pick must too; if best holds a
     draw-ish position (win% ≥ 30) the pick must not drop below 30;
  3. is **near-term**: a shallow search (depth ~8) already rates it within tolerance of the deep best, **and** it
     has at least one concrete Immediate or Short-term fact (check, capture winning material, threat with
     verified gain, fork, pin, escape, material gain within the line, mate).
- Show **Try this:** the pick (with its explanation), and **Engine's top:** the best move when it differs.
- If the best move itself is explainable, show just it.
- If no candidate passes: show the best move with *"deep engine move — hard to explain"*.
- Fixed tolerance in v1 (no level slider).

For Best/Great moves the tool confirms ("Good — this was the move") and shows the explanation of the played move.

## Screen (v1)

- Board (drag to explore) with arrows: green = explainable pick, blue = engine best, red = threat, plus
  last-move highlight. Eval bar. Clickable eval graph. Navigation buttons + "back to game".
- Move list with label symbols/colours; side lines shown indented under the move they branch from.
- Explanation panel for the current move: label (with reason), eval change, three levels, Try this, Engine's top.
- Game summary: accuracy % and label counts per side ("You" / "Opponent").
- Settings: chess.com username. Paste-PGN dialog.
- Analysis streams in: board opens immediately; labels appear as moves finish; progress indicator.

## Analysis flow

- Background analysis of all plies in game order; **the currently viewed ply and any side-line move jump the
  queue**. Eval graph fills in as results arrive. Summary appears when the queue is done (partial before).
- **Cache** results by (position, move, analysis-version, settings) in SQLite; reopening a game is instant.

## Out of v1

chess.com import by username, Brilliant, AI rephrasing, level slider, browser-only (WASM) engine, multi-user.

## Verification (definition of done)

1. Unit tests on hand-picked positions for every label and fact type (hung queen at +12 → Blunder, correct
   sacrifice not flagged, only move → Great, single legal move → Forced, fork, pin, missed punish → Miss, mates,
   promotions, en passant, castling).
2. Fact detector benchmarked against Lichess puzzle themes (fork, pin, hangingPiece, discoveredAttack, mateInN,
   skewer, …) — precision/recall measured, misses fixed.
3. Labels benchmarked against Lichess engine-annotated games (with a Lichess-threshold mode to validate the
   pipeline) — deliberate differences explained.
4. End-to-end browser tests (paste PGN, navigate, explore side lines, streaming, caching) + screenshots reviewed.
5. Independent reviewer agents judge explanation quality on sample games; fix and repeat.
6. Final report with numbers and known limitations. User then tests 3 of their own chess.com games.

## License

Stockfish (GPL-3.0) and chessground (GPL-3.0) → project is GPL-3.0-or-later.
