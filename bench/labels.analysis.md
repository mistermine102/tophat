<!-- Hand-written analysis spliced into bench/reports/labels.md by `bench/label-benchmark.ts report` (each block
replaces the marker of the same name). Numbers quoted here are from the runs described in the report. -->

<!-- ANALYSIS:summary -->
**Key findings**

- **Pipeline validated.** With Lichess' thresholds our labels match Lichess' judgements on 87.4 % of the 4826
  moves (4 classes; "flagged or not": 89 % precision, 81 % recall; Blunder 81 % / 92 %). Applying Lichess' *own*
  rules to *our* evals gives 86.5 %, i.e. the remaining gap is the engines' evaluations (Stockfish 19 at d18 vs
  Lichess' fishnet analysis), not our method; disagreements go both ways (299 moves we judge more severely, 311
  Lichess does). No category points at a pipeline bug; the deliberate differences (Book, the ±10 clamp, the
  material and mate rules) are listed below.
- **Bugs found and fixed** (all in classify.ts): (1) after an opponent capture that cannot be answered (42.Kxe3
  taking a queen) the material baseline kept the pre-capture balance, so the next moves "threw away" 8 pawns;
  (2) in already-lost positions the material rule compared two arbitrary winning lines of the opponent
  (promotion races 12 plies deep) — it now needs a piece the move itself leaves hanging; (3) `hung` named pieces
  that were not on the board yet (Opera 10...cxb5 "knight on d7"); (4) allowed mates were invisible in lost
  positions (Opera 15...Nxd7 "Best"; lmnbpO0B 28...Nf4?? Re8# "Good") — new mate rules.
- **Material rule** changes 43 labels in 60 games; by hand 34 are clearly right, 9 debatable (loss deep in the
  line or position nearly lost), **0 wrong**.
- **Mate rules** change 14 labels (12 allowed mates, 2 missed mates); all 14 verified.
- **Great / Miss**: after excluding obvious only-moves, 1.3 Greats and 1.45 Misses per side per game; hand review of
  52 Greats / 22 Misses: none wrong, about a third of the Greats "only move but not hard to find" (section 5).
- **Stability**: an independent re-analysis changes the severity class of 4.9 % of moves (3/4 of them borderline,
  within ±1 win% of a bound). A deeper re-search near the bounds barely helps (4.4 %, +13 % time) and is off by
  default; single-threaded searches are exactly reproducible (0 of 261 labels changed) — available as an option
  (section 6).
- **Depth**: d16 is as close to a d22 reference as d18 and as close to Lichess, at half the cost (1.6 vs 3.0 s/ply
  here; ≈ 3 vs 5 min per 80-ply game with explanations) — **recommend deep depth 16** (section 7).
- Opera game with the M3 rules: 15...Nxd7 is now "Blunder ?? — this allows a forced mate in 2. Black was already
  losing, but Qxd7 would have avoided it — watch for mating threats."; 10...cxb5 no longer claims a hanging knight.

<!-- ANALYSIS:validation -->
**Analysis of the disagreements** (every case is listed in labels-details.md):

- *engine: evals differ* (325) and *engine: near a threshold* (126) — Lichess' own rules applied to our evals disagree
  with Lichess as well, so the difference is the evaluation. Lichess' server analysis (fishnet) evaluates each
  position on its own with a fixed node budget; its evals are noisier: on the first 15 games the mover "gains" > 2 win% by
  moving (impossible with exact evals) after 28 Lichess evals vs 9 of ours, and the mean |difference| between the two
  engines' evals in undecided positions is 46 cp. Neither engine is systematically stricter (ours stricter on 180,
  Lichess on 145 of these). This also explains the low Inaccuracy recall (40 %): Inaccuracy is the
  narrowest band (5 win%), so eval noise moves moves in and out of it most.
- *engine/method: decided position* (34 + 16, almost all "Lichess stricter") — Lichess uses raw cp beyond ±10 and its
  mate rules ("Checkmate is now unavoidable" / "Lost forced checkmate"); we clamp at ±1000 cp as SPEC says, so moves
  between −8 and −20 are "Best" by win chance. Deliberate; the user-facing gaps of the clamp are covered by the
  material and mate rules (an allowed mate in ≤ 3 is now a Blunder at any eval).
- *method: near a threshold* (51) and *one-search winLoss* (7) — we compare the best and the played move inside
  one search (SPEC), Lichess compares the evals of consecutive positions; the two measures differ by a few win%.
- *book move* (13) — SPEC: book moves are Book even when the engine dislikes them (2.f4, the Ross Gambit 1.Nf3 e5 …).
- *rule: material* (28), *allowed mate* (9), *missed mate* (1) — our deliberate extra rules (sections 3–4).

<!-- ANALYSIS:distribution -->
Per side and game our default thresholds give ≈ 2.4 Inaccuracies, 1.7 Mistakes, 1.5 Misses and 4.0 Blunders
(Lichess: 4.2 / 1.8 / – / 4.4). Our Blunder band starts at 20 win% (Lichess 15), so moves Lichess calls Blunder are
often our Mistake (80) — and Miss (chess.com's "failed to punish") absorbs Inaccuracies/Mistakes after an opponent's
error. Book, Forced, Best, Great, Excellent and Good together are 76 % of all moves.

<!-- ANALYSIS:material -->
Review (verdicts in `bench/labels.eyeball.json`, full table above): typical true positives are pieces left en prise
(Qxc1+, Bxa1 after a careless castle), forks walked into (…Rc1?? Qb2+), pins (Rf2? Bd4), trapped queens (…Qxb2? Re2)
and desperado "spite checks" that give pieces away. The 9 debatable ones are real material losses in the engine line
but not "thrown away" in an obvious way: the loss appears only 8–12 plies deep, or the position was already nearly
lost (−7…−10) and the line is a mating attack in which the engine's PV gives material back. Wrong (no real material
loss) after the fixes: none. Before the fixes, 12 further firings in games 1–40 were wrong or debatable (promotion
races in dead-lost pawn endings such as QmYnd7UG 45.Kc2 / DOPXJmpt 46...Ke4, already-hanging pieces in lost
positions, and the 1ciG1v60 42...Kf6 baseline bug).

`hung` is now only claimed for a piece that is en prise right after the move: 228 of the 708 moves with a material
loss name such a piece; for 457 the loss happens later in the line (`lostInLine`), and the label text no longer calls
those pieces "hanging".

<!-- ANALYSIS:mate -->
Every label-changing firing was checked against the engine line (all end in mate within 3 moves). Typical: a king
move into a mating net or a back-rank mate allowed at −6…−13, where win% is already ~2–5 % and the move was "Best"
or "Good" before. A mate in 4+ is left to win chance (e.g. w6ueCJMc 24...Qxa6, mate in 4: Excellent; Lichess
Blunder) — a deliberate limit (setting `mate.allowedMaxMoves`).

<!-- ANALYSIS:great -->
**Great — what was changed.** The first runs gave ~2 Greats per side and game, mostly obvious only-moves. Now excluded
(classify.ts `isGreat`, documented in SPEC/ARCHITECTURE): check evasions with ≤ 3 legal moves (11...g6 blocking
Qh5+), captures that win material by static exchange alone (taking a hanging piece or free pawn, e.g. the rook on the
7th eating pawns), the move after an opponent's only legal reply (24.Qe8+ after 23.Rxd8+ Rxd8 forced) and — settings
change `great.maxWinAfterBest` 97 → 70 — moves in already-winning positions where the 2nd best keeps the win too
(24.Rg3+ at 94 % with Rg8+ still +3.8).

**Great — result.** 161 Greats = 1.3 per side per game (3.3 % of moves). Hand review of 52: 35 clearly "the only good
move and not obvious" (tactics, only drawing/winning king moves in pawn endings, mates in 2–3, perpetual checks), 17
debatable, 0 wrong. The debatable ones are natural moves whose alternatives happen to lose 10–15 % (developing moves,
natural trades such as …Bxf3, en-passant captures, castling), best defence in an already losing position, and one
repetition (the same move in the same position twice). Most of these sit just above the 10 % bound: raising
`great.secondBestMinLoss` to 15 would give 0.94 per side per game, 20 → 0.85 (games 1–39). Not changed — SPEC ties
Great to the Mistake threshold; the user can tighten it if Great still feels too frequent.

**Miss.** 174 = 1.45 per side per game. Review of 22: 18 clear (a free rook not taken, Bxe5! fxe5 Qh5+ missed, …),
4 debatable: when even the best move leaves the mover losing (≤ 30 %), "would have punished it" is a strong word,
and an inaccuracy-sized miss (−5.2 %) ranks above a Mistake by SPEC's severity order. Missed mates (≤ 3) are Miss by
the new rule (2 changed labels).

<!-- ANALYSIS:stability -->
**What changes.** Re-analysing 10 games (757 plies) from scratch changes 15 % of the labels, but almost all of that is
Best ↔ Excellent ↔ Good (the 0.5 / 2 / 5 bounds are a fraction of the engine's run-to-run noise). The severity class
(ok / ?! / ? or Miss / ??) changes on **4.9 %** of moves, and 3 in 4 of those have a winLoss within ±1 win% of the
5 / 10 / 20 bound in one of the runs — moves that are genuinely borderline, where both labels are defensible. The engine
even picks a different #1 move on 23 % of plies (mostly equivalent moves). Greats flip once in 757 plies, Miss 6 times.

**Where it comes from.** Multi-threaded Stockfish is not deterministic (the threads share the hash table), and the
5-second cap stops 14 % of the deep searches before depth 18 on this (shared) CPU. The cap is a minor source: moves
with a capped search in either run change class 6.2 % of the time vs 4.7 % for uncapped ones, so a node budget instead
of the time cap would not remove the noise either.

**Mitigation tried.** Hysteresis is not allowed (it would hide real mistakes), so I implemented a *deeper re-search
near the bounds* (`settings.budget.verify`, label.ts `verifyNearThreshold`): when winLoss is within ±1 of a bound (or
the 2nd best's loss within ±1 of Great's), the two moves are searched again together (MultiPV 2, depth + 2) and the
label comes from that search. On the same 10 games, run twice independently (`d18v` / `coldv`, each with its own
verification searches), it verified 18 % of plies, cost +13 % engine time (≈ +0.4 s/ply) and reduced class flips only
from 4.9 % to 4.4 % (Miss flips even rose 6 → 10): the deeper search is just as noisy at the bound. It is therefore
**off by default** (margin 0) and stays available as a setting. What does keep labels stable for the user is the
search cache: a game, once analysed, always shows the same labels (searches are cached across restarts and
ANALYSIS_VERSION bumps).

**Deterministic option.** Single-threaded fixed-depth search *is* reproducible: two fresh d16 runs with Threads = 1
and no time cap (`d16-1t` vs `d16-1t-b`, 4 games, 261 plies) gave **identical** scores, best moves and labels on every
ply — and on this busy CPU single-threaded d16 cost 1.8 s/ply vs 1.6 s/ply with 4 threads (at a fixed depth extra
threads mostly widen the search). For a guaranteed-reproducible analysis: `ENGINE_THREADS=1`, depth-only deep search
with the new optional node cap `budget.deep.maxNodes` as the safety stop instead of the (load-dependent) time cap.
Not the default: on the user's idle 12-thread PC more threads should finish a fixed depth faster, and the cache
already gives stability in normal use.

<!-- ANALYSIS:depth -->
**Quality.** Against the d22 reference (no time cap; 4 threads), d16 and d18 disagree on about as many severity
classes as two d18 runs disagree with each other (the noise floor): d16 5.6 %, d18 5.9 %, single-threaded d16 6.8 % of
339 plies vs 4.9 % between two d18 runs (d22 itself is not the truth either; some of its searches hit the 120-s
timeout and those plies are left out). Lichess agreement is the same
(d16 87.7 %, d18 87.4 %). In other words, going from d16 to d18 does not make the labels measurably more correct — the
label differences between depths are the same borderline moves that flip between two runs at one depth. (A d14 MultiPV
search did miss Opera's 16.Qb8+ mate in 2 in a unit test, so depth 16 is the floor I would go to.)

**Cost.** On this CPU (4 threads, shared with another engine) the label searches take 3.0 s/ply at d18 (4.0 min per
80 plies, 14 % of the deep searches stopped by the 5-s cap) and 1.6 s/ply at d16 (2.1 min). The explanation searches
add ≈ 0.5–1 s/ply (the full pipeline on the Opera game: 3.1 s/ply at d18), so d18 lands at ≈ 5 min for an 80-ply game
and d16 at ≈ 3 min. More threads help less than expected at a fixed depth (d16: 1 thread 1.8 s/ply vs 4 threads
1.6 s/ply here); the user's idle 12-thread PC will be somewhat faster than these numbers.

**Recommendation: deep depth 16** (keep MultiPV 5 and the 5-s cap as a safety net): labels as good as d18 by every
measure here, half the engine time, and the 80-ply / 4-minute target is met with margin. Not changed in this
milestone because the deep search also feeds the explanations (M5) and the timing work (M4): it is one number,
`DEFAULT_SETTINGS.budget.deep.depth`.

<!-- ANALYSIS:end -->
