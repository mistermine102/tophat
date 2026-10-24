## How to read the table

- **Moves**: the puzzle FEN is the position *before* the opponent's move `Moves[0]`; the solver's moves are
  `Moves[1]`, `Moves[3]`, … Facts are computed with `immediateFacts(fenBefore, uci)` on every ply.
- **first-move recall**: the detector fires on the solver's first move (`Moves[1]`); for the *opp* rows on the
  opponent's move `Moves[0]`; for *mate (last move)* on the last solver move.
- **any-solver-move recall**: fires on at least one solver move. Lichess themes describe the whole line, so a theme
  is often realised only on a later move (e.g. `Qxf8+ Rxf8 Nb6+` — the fork is the third ply). This column is the
  better measure for fork / skewer / discovered attack / double check / promotion / en passant / castling.
- **fire rate on non-theme puzzles**: the detector fires on the first solver move of a random pool of puzzles
  *without* the theme. This is an upper bound on false positives: Lichess tags are incomplete, so most firings are
  legitimate. **eyeballed precision**: a random sample of 20 such firings (see
  `bench/reports/puzzle-facts-samples.md`) judged by hand.
- Missed puzzles (never detected) are sampled in `bench/reports/puzzle-facts-misses.md`.

## Detector definitions that drive recall (see `server/src/facts/immediate.ts` header)

- A **fork** must win material against *every* legal reply (one ply of brute force + SEE). Pawns are not fork
  targets. Hence a fork answered by a forked piece escaping **with check** (zwischenzug), or one that only works
  because of a deeper mating net, is not reported.
- A **skewer** needs a non-pawn piece behind; the front piece is the king (in check) or worth more than both the
  slider and the piece behind; the mover must win material against every reply.
- **pin** = a *newly created* pin of a non-pawn piece. Lichess' `pin` theme mostly means *exploiting* an existing pin
  (capturing or piling up on the pinned piece), which this fact does not describe — hence the low first-move recall.
  (An "attacks a pinned piece" fact would be a possible addition.)
- **hangingPiece (opp move)** counts `hangs` (new or `already` en prise, loss ≥ 2 for the latter) or a capture with
  outcome `loses-material`. A hang is not reported if the opponent's capture walks into a counter-capture worth at
  least as much (e.g. the move attacked their queen).

## Known misses / weaknesses

- **fork** (first move ≈ 65 %, any ≈ 92 %): misses are mostly forks realised later in the line, "forks" whose
  point is a mating attack or a pin rather than material, and escapes with check (e.g. `Nd3+` from a forked knight)
  that the one-ply verification conservatively treats as refutations.
- **skewer** (first ≈ 53 %, any ≈ 89 %): misses are mostly lines where the king can step next to the piece behind
  (then SEE says no gain) but a deeper tactic still wins, and skewers set up by an earlier sacrifice.
- **discoveredAttack** (first ≈ 63 %, any ≈ 87 %): targets that are pawns are excluded by design; some puzzles use
  the tag for a discovered *threat* (mate threat, attack on a defended piece of equal value).
- **doubleCheck**: 100 % on some solver move; first-move 67 % because the double check often comes after a
  preparatory sacrifice.
- **hangs (opp move)** (≈ 88 %): remaining misses are hangs while the mover was in check (pre-existing hangs are not
  blamed on a forced check evasion), intermezzo/desperado lines that SEE on one square cannot see, and blunders whose
  point is a mate (reported as `allows-mate` instead).
- **promotion / enPassant / castling**: detection is exact; first-move recall is low only because the puzzle's
  promotion / en passant / castling happens later in the line.
- **counter-threats** other than captures (e.g. a mate threat) are not considered by `hangs`.
- Speed: ≈ 0.1 ms per `immediateFacts` call on average (includes SEE for every piece and the mate-in-1 brute force).
