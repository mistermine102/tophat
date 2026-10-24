# Paul Morphy vs Duke Karl / Count Isouard — 1-0

Paris Opera · Paris FRA · 1858.??.??

Engine Stockfish 19, 10 threads; deep d18 MultiPV 5, shallow d8, threat d12, forcedness d12.
Wall time 170.3 s for 33 plies (5.16 s/ply); engine searches run 373 (169.2 s engine time), served from cache 85.

## Summary

| | White (Paul Morphy) | Black (Duke Karl / Count Isouard) |
|---|---|---|
| Accuracy | 95.9 | 77.8 |
| Forced | 0 | 1 |
| Book | 4 | 3 |
| Best | 9 | 7 |
| Great ! | 2 | 0 |
| Excellent | 0 | 1 |
| Good | 1 | 0 |
| Inaccuracy ?! | 1 | 1 |
| Mistake ? | 0 | 3 |

## Moves

### 1. e4 — Book

Book — a known opening move (King's Pawn Game, B00).

Eval +0.2 → +0.2 · White's win% 52 → 52 · winLoss 0.0 · accuracy 99

- *Immediate:* Nothing special happens right away.
- *Short term:* No forcing follow-up; material stays level (engine line: e4 e5 Nf3 Nc6).
- *Long term:* White gains control of the centre.

Good — this was the move.

<sub>Candidates: e4 +0.2 ✗(no-concrete-fact) · Nf3 +0.2 ✗(no-concrete-fact) · d4 +0.2 ✗(no-concrete-fact) · c4 +0.2 ✗(no-concrete-fact) · e3 +0.1 ✗(no-concrete-fact)</sub>
<sub>Timings: total 3.80s, deep 1.78s, deepAfter 1.69s, shallow 0.01s, threat 0.17s, forcedness 0.12s, facts 0.01s; cached searches 0</sub>

### 1... e5 — Book

Book — a known opening move (King's Pawn Game, C20).

Eval +0.2 → +0.2 · Black's win% 48 → 48 · winLoss 0.0 · accuracy 100

- *Immediate:* Nothing special happens right away.
- *Short term:* No forcing follow-up; material stays level (engine line: e5 Nf3 Nc6 Bb5).
- *Long term:* Black gains control of the centre.

Good — this was the move.

<sub>Candidates: e5 +0.2 ✗(no-concrete-fact) · c6 +0.3 ✗(no-concrete-fact) · c5 +0.3 ✗(no-concrete-fact) · e6 +0.5 ✗(no-concrete-fact) · d6 +0.5 ✗(no-concrete-fact)</sub>
<sub>Timings: total 1.74s, deepAfter 1.52s, shallow 0.01s, threat 0.15s, forcedness 0.05s, facts 0.01s; cached searches 2</sub>

### 2. Nf3 — Book

Book — a known opening move (King's Knight Opening, C40).

Eval +0.2 → +0.3 · White's win% 52 → 52 · winLoss 0.0 · accuracy 100

- *Immediate:* Threatens Nxe5, winning a pawn (+1). Develops the knight to f3.
- *Short term:* Nf3 → Nc6 → Bb5 → Nf6 → O-O → Nxe4 wins the pawn → Re1 attacks the knight → Nd6 attacks the bishop → a few moves later, White loses a knight (−3).
- *Long term:* After the line, White's king is safer (it is tucked away behind its pawns). White gains control of the centre.

Good — this was the move.

<sub>Candidates: Nf3 +0.2 ✓ · Nc3 +0.1 ✗(no-concrete-fact) · Bc4 +0.0 ✗(no-concrete-fact) · Ne2 −0.0 ✗(no-concrete-fact) · Be2 −0.0 ✗(no-concrete-fact)</sub>
<sub>Timings: total 3.08s, deepAfter 2.75s, shallow 0.02s, threat 0.16s, forcedness 0.14s, facts 0.01s; cached searches 3</sub>

### 2... d6 — Book

Book — a known opening move (Philidor Defense, C41).

Eval +0.3 → +0.6 · Black's win% 48 → 44 · winLoss 2.7 · accuracy 88

- *Immediate:* Stops White's threat Nxe5, which would win a pawn (+1 for White). Defends the pawn on e5, which was under attack.
- *Short term:* d6 → d4 → exd4 takes the pawn → Nxd4 takes back → Nf6 → Nc3 → material stays level.
- *Long term:* No notable long-term change.

Good — this was the move.

<sub>Candidates: Nc6 +0.3 ✓ · Nf6 +0.3 ✗(no-concrete-fact) · d6 +0.5 ✓ · d5 +1.0 ✗(too-much-loss,shallow-disagrees,no-concrete-fact) · Bd6 +1.0 ✗(too-much-loss,shallow-disagrees)</sub>
<sub>Timings: total 1.58s, deepAfter 1.01s, shallow 0.02s, threat 0.28s, forcedness 0.26s, facts 0.01s; cached searches 3</sub>

### 3. d4 — Book

Book — a known opening move (Philidor Defense, C41).

Eval +0.6 → +0.7 · White's win% 56 → 56 · winLoss 0.0 · accuracy 100

- *Immediate:* Nothing special happens right away.
- *Short term:* d4 → exd4 takes the pawn → Nxd4 takes back → Nf6 → Nc3 → material stays level.
- *Long term:* White gains control of the centre.

Good — this was the move.

<sub>Candidates: d4 +0.6 ✗(no-concrete-fact) · Bc4 +0.3 ✗(no-concrete-fact) · Nc3 +0.3 ✗(no-concrete-fact) · a4 +0.2 ✗(no-concrete-fact) · h3 +0.1 ✗(no-concrete-fact)</sub>
<sub>Timings: total 2.04s, deepAfter 1.81s, shallow 0.01s, threat 0.13s, forcedness 0.09s, facts 0.01s; cached searches 2</sub>

### 3... Bg4 — Book

Book — a known opening move (Philidor Defense, C41).

Eval +0.7 → +1.1 · Black's win% 44 → 40 · winLoss 3.3 · accuracy 85

- *Immediate:* Pins White's knight on f3 to the queen on d1. Develops the bishop to g4.
- *Short term:* Bg4 pins the knight to the queen → dxe5 wins the pawn → Nc6 → exd6 takes the pawn → Bxd6 takes back → Nc3 → Black loses a pawn (−1).
- *Long term:* No notable long-term change.

Good — this was the move.

<sub>Candidates: exd4 +0.7 ✗(no-concrete-fact) · Nd7 +0.7 ✓ · Nc6 +0.8 ✓ · Nf6 +0.8 ✓ · Bg4 +1.0 ✓</sub>
<sub>Timings: total 3.49s, deepAfter 2.86s, shallow 0.02s, threat 0.25s, forcedness 0.34s, facts 0.01s; cached searches 4</sub>

### 4. dxe5 — Book

Book — a known opening move (Philidor Defense, C41).

Eval +1.1 → +1.2 · White's win% 60 → 61 · winLoss 0.0 · accuracy 100

- *Immediate:* Wins Black's pawn on e5 for free (+1).
- *Short term:* dxe5 wins the pawn → Nc6 → exd6 takes the pawn → Bxd6 takes back → h3 attacks the bishop → Bh5 → White wins a pawn (+1).
- *Long term:* White gets doubled pawns on the e-file. White gains control of the centre.

Good — this was the move.

<sub>Candidates: dxe5 +1.1 ✓ · Nc3 +1.1 ✓ · Be3 +1.0 ✓ · h3 +0.9 ✓ · Qd3 +0.7 ✗(no-concrete-fact)</sub>
<sub>Timings: total 3.19s, deepAfter 2.82s, shallow 0.01s, threat 0.11s, forcedness 0.24s, facts 0.01s; cached searches 2</sub>

### 4... Bxf3 — Inaccuracy ?!

Inaccuracy ?! — Nc6 was better (−7% winning chances).

Eval +1.2 → +2.0 · Black's win% 39 → 32 · winLoss 7.4 · accuracy 75

- *Immediate:* Takes White's knight on f3 — an even trade.
- *Short term:* Bxf3 takes the knight → Qxf3 takes back → dxe5 wins the pawn → Qb3 → Nd7 → Be3 → Bc5 → Bxc5 takes the bishop → a few moves later, material stays level.
- *Long term:* Black gains control of the centre.

**Engine's top:** Nc6 (Nc6 exd6 Qxd6 Qxd6 Bxd6 Be3)
  - *Immediate:* Threatens dxe5, winning a pawn (+1). Develops the knight to c6.
  - *Short term:* Nc6 → exd6 takes the pawn → Qxd6 takes back → Qxd6 takes back → Bxd6 takes back → Be3 → material stays level.
  - *Long term:* Black gains control of the centre.

<sub>Candidates: Nc6 +1.2 ✓ · Nd7 +1.3 ✓ · Qe7 +1.6 ✗(no-concrete-fact) · a6 +1.6 ✗(no-concrete-fact) · Qd7 +1.7 ✗(no-concrete-fact)</sub>
<sub>Timings: total 6.49s, deepAfter 5.00s, searchmoves 0.60s, shallow 0.02s, threat 0.26s, forcedness 0.57s, facts 0.03s; cached searches 3</sub>

### 5. Qxf3 — Best

Best — the engine's top choice.

Eval +2.0 → +2.0 · White's win% 68 → 67 · winLoss 0.0 · accuracy 100

- *Immediate:* Recaptures: takes Black's bishop on f3. Defends the pawn on e4, which was under attack.
- *Short term:* Qxf3 takes back → Nd7 → exd6 takes the pawn → Bxd6 takes back → Nc3 → White wins back a bishop (+3).
- *Long term:* Black loses the bishop pair. After the line, White's doubled pawns on the e-file are gone.

Good — this was the move.

<sub>Candidates: Qxf3 +2.0 ✓ · gxf3 +1.1 ✗(too-much-loss,shallow-disagrees) · Qd3 −4.5 ✗(too-much-loss,material-rule,loses-result,shallow-disagrees) · Bb5+ −4.5 ✗(too-much-loss,material-rule,loses-result,shallow-disagrees) · Qd5 −4.7 ✗(too-much-loss,material-rule,loses-result,shallow-disagrees)</sub>
<sub>Timings: total 5.19s, deepAfter 4.63s, shallow 0.01s, threat 0.15s, forcedness 0.37s, facts 0.02s; cached searches 2</sub>

### 5... dxe5 — Best

Best — the engine's top choice.

Eval +2.0 → +2.2 · Black's win% 33 → 31 · winLoss 0.0 · accuracy 95

- *Immediate:* Wins White's pawn on e5 for free (+1).
- *Short term:* dxe5 wins the pawn → Qb3 → Nd7 → Be3 → Bc5 → Bxc5 takes the bishop (forced) → Nxc5 takes back → Qb5+ forks the king and knight → a few moves later, material stays level.
- *Long term:* White's doubled pawns on the e-file are gone. After the line, White's king is more exposed (more enemy pieces aim at it).

Good — this was the move.

<sub>Candidates: dxe5 +2.0 ✓ · Nd7 +2.5 ✗(loses-result) · Nc6 +3.1 ✗(too-much-loss,loses-result,shallow-disagrees) · Qd7 +4.8 ✗(too-much-loss,loses-result,shallow-disagrees) · c6 +4.9 ✗(too-much-loss,loses-result,shallow-disagrees)</sub>
<sub>Timings: total 4.76s, deepAfter 4.41s, shallow 0.03s, threat 0.18s, forcedness 0.12s, facts 0.02s; cached searches 4</sub>

### 6. Bc4 — Inaccuracy ?!

Inaccuracy ?! — Qb3 was better (−6% winning chances).

Eval +2.2 → +1.5 · White's win% 69 → 64 · winLoss 6.3 · accuracy 80

- *Immediate:* Threatens checkmate with Qxf7#. Develops the bishop to c4.
- *Short term:* Bc4 → Qf6 → Qb3 → Nd7 (forced) → Qxb7 wins the pawn → Rb8 attacks the queen (forced) → Qa6 → Qxa6 takes the queen → a few moves later, White wins a knight and a pawn for a bishop (+1).
- *Long term:* After the line, Black gets isolated pawns on a7 and c7.

**Engine's top:** Qb3 — deep engine move — hard to explain (Qb3 Nd7 Be3 Bc5 Bxc5 Nxc5)
  - *Immediate:* Attacks Black's pawn on b7, which is undefended.
  - *Short term:* Qb3 → Nd7 → Be3 → Bc5 → Bxc5 takes the bishop → Nxc5 takes back (forced) → Qb5+ forks the king and knight → Nd7 → a few moves later, White wins a pawn (+1).
  - *Long term:* No notable long-term change.

<sub>Candidates: Qb3 +2.2 ✗(no-concrete-fact) · Bc4 +1.4 ✗(too-much-loss,shallow-disagrees) · Nc3 +1.1 ✗(too-much-loss,shallow-disagrees,no-concrete-fact) · Bb5+ +1.1 ✗(too-much-loss,shallow-disagrees) · Nd2 +1.0 ✗(too-much-loss,shallow-disagrees,no-concrete-fact)</sub>
<sub>Timings: total 4.63s, deepAfter 3.70s, shallow 0.04s, threat 0.27s, forcedness 0.60s, facts 0.02s; cached searches 2</sub>

### 6... Nf6 — Mistake ?

Mistake ? — Qf6 was much better. Black's winning chances go from 36% to 25%.

Eval +1.5 → +3.1 · Black's win% 36 → 24 · winLoss 11.4 · accuracy 58

- *Immediate:* Stops White's threat of checkmate with Qxf7#. Develops the knight to f6.
- *Short term:* Nf6 → Qb3 (forced) → Qe7 → Qxb7 wins the pawn → Qb4+ attacks the queen → Qxb4 takes the queen (forced) → Bxb4+ takes back → Bd2 attacks the bishop → a few moves later, Black loses a pawn (−1).
- *Long term:* After the line, Black gets isolated pawns on a7 and c7. Black gains control of the centre.

**Engine's top:** Qf6 (Qf6 Qb3 Nd7 Qxb7 Rb8 Qa6)
  - *Immediate:* Stops White's threat of checkmate with Qxf7#. Defends the pawn on f7, which was under attack.
  - *Short term:* Qf6 → Qb3 → Nd7 → Qxb7 wins the pawn → Rb8 attacks the queen → Qa6 → Qxa6 takes the queen → Bxa6 takes back → a few moves later, Black loses a pawn (−1).
  - *Long term:* After the line, Black's king is safer (fewer enemy pieces aim at it). After the line, Black gets isolated pawns on a7 and c7.

<sub>Candidates: Qf6 +1.5 ✓ · Qd7 +2.0 ✓ · Qe7 +2.6 ✗(too-much-loss,loses-result,shallow-disagrees) · Nf6 +3.0 ✗(too-much-loss,loses-result,shallow-disagrees) · Qd6 +6.5 ✗(too-much-loss,loses-result,shallow-disagrees)</sub>
<sub>Timings: total 6.38s, deepAfter 5.00s, shallow 0.01s, threat 0.29s, forcedness 1.05s, facts 0.01s; cached searches 2</sub>

### 7. Qb3 — Great !

Great ! — the only good move here: the next best loses 16% winning chances.

Eval +3.1 → +3.1 · White's win% 76 → 76 · winLoss 0.0 · accuracy 100

- *Immediate:* Threatens a forced mate in 2, starting with Bxf7+. Attacks Black's pawn on b7, which is undefended.
- *Short term:* Qb3 → Qe7 → Qxb7 wins the pawn → Qb4+ attacks the queen (forced) → Qxb4 takes the queen → Bxb4+ takes back (forced) → Bd2 attacks the bishop → a5 → a few moves later, White wins a pawn (+1).
- *Long term:* After the line, Black gets isolated pawns on a5 and c7.

Good — this was the move.

<sub>Candidates: Qb3 +3.1 ✓ · Be3 +1.1 ✗(too-much-loss,loses-result,shallow-disagrees,no-concrete-fact) · Nc3 +1.1 ✗(too-much-loss,loses-result,shallow-disagrees,no-concrete-fact) · Nd2 +1.1 ✗(too-much-loss,loses-result,shallow-disagrees,no-concrete-fact) · Bg5 +1.0 ✗(too-much-loss,loses-result,shallow-disagrees)</sub>
<sub>Timings: total 5.57s, deepAfter 5.00s, shallow 0.01s, threat 0.11s, forcedness 0.44s, facts 0.01s; cached searches 2</sub>

### 7... Qe7 — Best

Best — the engine's top choice.

Eval +3.1 → +3.2 · Black's win% 24 → 24 · winLoss 0.0 · accuracy 100

- *Immediate:* Stops White's mating attack (it would start with Bxf7+). Defends the pawn on f7, which was under attack.
- *Short term:* Qe7 → Qxb7 wins the pawn → Qb4+ attacks the queen → Qxb4 takes the queen (forced) → Bxb4+ takes back → Bd2 attacks the bishop → a5 → Nc3 → Black loses a pawn (−1).
- *Long term:* After the line, Black gets isolated pawns on a5 and c7.

Good — this was the move.

<sub>Candidates: Qe7 +3.1 ✓ · Bc5 +3.6 ✓ · Bd6 +4.6 ✗(too-much-loss) · Qd6 +4.6 ✗(too-much-loss,shallow-disagrees) · Be7 +4.8 ✗(too-much-loss,shallow-disagrees)</sub>
<sub>Timings: total 5.54s, deepAfter 4.99s, shallow 0.02s, threat 0.44s, forcedness 0.06s, facts 0.01s; cached searches 4</sub>

### 8. Nc3 — Good

Good — a little weaker than Qxb7 (−3% winning chances).

Eval +3.2 → +3.0 · White's win% 76 → 75 · winLoss 2.9 · accuracy 97

- *Immediate:* Threatens Qxb7, winning material (+6). Defends the pawn on e4, which was under attack. Develops the knight to c3.
- *Short term:* Nc3 → c6 → Bg5 pins the knight to the queen → Kd8 → Bxf7 wins the pawn → Kc7 → White wins a pawn (+1).
- *Long term:* After the line, Black's king is more exposed (more enemy pieces aim at it). After the line, Black gets an isolated pawn on e5.

**Engine's top:** Qxb7 (Qxb7 Qb4+ Qxb4 Bxb4+ Bd2 a5)
  - *Immediate:* Wins Black's pawn on b7 for free (+1). Attacks Black's rook on a8, which is undefended. Defends the pawn on e4, which was under attack.
  - *Short term:* Qxb7 wins the pawn → Qb4+ attacks the queen (forced) → Qxb4 takes the queen → Bxb4+ takes back (forced) → Bd2 attacks the bishop → a5 → Nc3 → White wins a pawn (+1).
  - *Long term:* Black gets isolated pawns on a7 and c7. White gains control of the centre.

<sub>Candidates: Qxb7 +3.2 ✓ · Nc3 +2.8 ✓ · O-O +1.6 ✗(too-much-loss,loses-result,shallow-disagrees) · Nd2 +1.3 ✗(too-much-loss,loses-result,shallow-disagrees) · Bd2 +1.1 ✗(too-much-loss,loses-result,shallow-disagrees)</sub>
<sub>Timings: total 5.46s, deepAfter 5.00s, shallow 0.01s, threat 0.09s, forcedness 0.33s, facts 0.01s; cached searches 4</sub>

### 8... c6 — Best

Best — the engine's top choice.

Eval +3.0 → +3.1 · Black's win% 25 → 24 · winLoss 0.0 · accuracy 98

- *Immediate:* Stops White's threat Qxb7, which would win material (+6 for White).
- *Short term:* c6 → Bg5 pins the knight to the queen → Kd8 → O-O-O+ → Kc7 → Bxf7 wins the pawn → Nbd7 → Black loses a pawn (−1).
- *Long term:* After the line, Black's king is more exposed (more enemy pieces aim at it). After the line, Black gets an isolated pawn on e5.

Good — this was the move.

<sub>Candidates: c6 +3.0 ✓ · Qb4 +4.1 ✗(too-much-loss,hangs-material,shallow-disagrees) · Nbd7 +4.2 ✗(too-much-loss,shallow-disagrees,no-concrete-fact) · b5 +4.8 ✗(too-much-loss,hangs-material) · b6 +5.2 ✗(too-much-loss,shallow-disagrees)</sub>
<sub>Timings: total 4.43s, deepAfter 3.21s, shallow 0.01s, threat 0.93s, forcedness 0.27s, facts 0.01s; cached searches 2</sub>

### 9. Bg5 — Best

Best — the engine's top choice.

Eval +3.1 → +3.0 · White's win% 76 → 75 · winLoss 0.0 · accuracy 95

- *Immediate:* Pins Black's knight on f6 to the queen on e7. Develops the bishop to g5.
- *Short term:* Bg5 pins the knight to the queen → Kd8 → O-O-O+ → Kc7 → Bxf7 wins the pawn → Nbd7 → White wins a pawn (+1).
- *Long term:* After the line, White's king is safer (it is tucked away behind its pawns). After the line, Black's king is more exposed (more enemy pieces aim at it). After the line, Black gets an isolated pawn on e5.

Good — this was the move.

<sub>Candidates: Bg5 +3.1 ✓ · Be3 +2.8 ✗(no-concrete-fact) · f4 +1.9 ✗(too-much-loss,loses-result,shallow-disagrees,no-concrete-fact) · a4 +1.8 ✗(too-much-loss,loses-result,shallow-disagrees,no-concrete-fact) · O-O +1.5 ✗(too-much-loss,loses-result,shallow-disagrees,no-concrete-fact)</sub>
<sub>Timings: total 5.50s, deepAfter 5.00s, shallow 0.03s, threat 0.34s, forcedness 0.12s, facts 0.01s; cached searches 3</sub>

### 9... b5 — Mistake ?

Mistake ? — Kd8 was much better. Black's winning chances go from 25% to 11%.

Eval +3.0 → +5.8 · Black's win% 25 → 10 · winLoss 14.2 · accuracy 52

- *Immediate:* Attacks White's bishop on c4 with a pawn.
- *Short term:* b5 attacks the bishop → Nxb5 takes the pawn (forced) → Qb4+ → Qxb4 takes the queen → Bxb4+ takes back → c3 attacks the bishop (forced) → cxb5 takes the knight → Bxb5+ takes back → a few moves later, Black ends up behind in material (−2).
- *Long term:* After the line, Black gets an isolated pawn on a7.

**Engine's top:** Kd8 — deep engine move — hard to explain (Kd8 O-O-O+ Kc7 Bxf7 Nbd7 a4)
  - *Immediate:* Leaves the pawn on f7 hanging (−1).
  - *Short term:* Kd8 → O-O-O+ → Kc7 → Bxf7 wins the pawn → Nbd7 → Black loses a pawn (−1).
  - *Long term:* After the line, Black's king is more exposed (more enemy pieces aim at it). After the line, Black gets an isolated pawn on e5. Black gives up material, but the engine sees about 1.0 pawns of compensation in the position.

<sub>Candidates: Kd8 +3.0 ✗(hangs-material,no-concrete-fact) · Na6 +3.1 ✗(no-concrete-fact) · a6 +4.1 ✗(too-much-loss,shallow-disagrees,no-concrete-fact) · Qb4 +4.1 ✗(too-much-loss,hangs-material,shallow-disagrees) · h6 +4.4 ✗(too-much-loss)</sub>
<sub>Timings: total 11.08s, deepAfter 5.00s, searchmoves 5.00s, shallow 0.02s, threat 0.28s, forcedness 0.76s, facts 0.01s; cached searches 4</sub>

### 10. Nxb5 — Best

Best — the engine's top choice.

Eval +5.8 → +5.9 · White's win% 90 → 90 · winLoss 0.0 · accuracy 100

- *Immediate:* Takes Black's pawn on b5 as a sacrifice (−1) — the follow-up wins it back with interest.
- *Short term:* Nxb5 takes the pawn → Qb4+ → Qxb4 takes the queen → Bxb4+ takes back → c3 attacks the bishop → cxb5 takes the knight → Bxb5+ takes back → Ke7 → a few moves later, White comes out ahead in material (+2).
- *Long term:* Black gets isolated pawns on c6 and a7. After the line, White gets a passed pawn on c3.

Good — this was the move.

<sub>Candidates: Nxb5 +5.8 ✗(no-concrete-fact) · Bxf6 +1.8 ✗(too-much-loss,loses-result,shallow-disagrees,no-concrete-fact) · Bxb5 +1.0 ✗(too-much-loss,hangs-material,loses-result,shallow-disagrees,no-concrete-fact) · Bd5 +0.8 ✗(too-much-loss,hangs-material,loses-result,shallow-disagrees) · Be2 +0.4 ✗(too-much-loss,loses-result,shallow-disagrees)</sub>
<sub>Timings: total 6.19s, deepAfter 5.00s, shallow 0.01s, threat 0.13s, forcedness 1.03s, facts 0.01s; cached searches 2</sub>

### 10... cxb5 — Mistake ?

Mistake ? — leaves the knight on d7 hanging (−4). Black's winning chances go from 10% to 5%.

Eval +5.9 → +8.8 · Black's win% 10 → 4 · winLoss 5.7 · accuracy 75

- *Immediate:* Recaptures: takes White's knight on b5.
- *Short term:* cxb5 takes back → Bxb5+ takes back (forced) → Nbd7 → O-O-O (forced) → Rb8 pins the bishop to the queen → Rxd7 takes the knight → Qxd7 takes the rook → Bxd7+ uncovers an attack on the rook → a few moves later, Black gives a queen and a pawn for a rook (−5).
- *Long term:* Black's pawns on c6 and a7 are no longer isolated.

**Engine's top:** Qb4+ (Qb4+ Qxb4 Bxb4+ c3 cxb5 Bxb5+)
  - *Immediate:* Gives check.
  - *Short term:* Qb4+ → Qxb4 takes the queen → Bxb4+ takes back → c3 attacks the bishop (forced) → cxb5 takes the knight → Bxb5+ takes back (forced) → Ke7 → cxb4 wins the bishop → a few moves later, Black gives a bishop and a pawn for a knight (−1).
  - *Long term:* After the line, Black's pawn on c6 is no longer isolated. After the line, White gets doubled pawns on the b-file.

<sub>Candidates: Qb4+ +5.9 ✓ · Na6 +7.0 ✗(no-concrete-fact) · a6 +7.5 ✓ · h6 +7.7 ✗(material-rule) · Kd8 +7.9 ✗(too-much-loss,no-concrete-fact)</sub>
<sub>Timings: total 10.98s, deepAfter 5.00s, searchmoves 5.00s, shallow 0.04s, threat 0.28s, forcedness 0.63s, facts 0.02s; cached searches 4</sub>

### 11. Bxb5+ — Best

Best — the engine's top choice.

Eval +8.8 → +8.7 · White's win% 96 → 96 · winLoss 0.0 · accuracy 100

- *Immediate:* Recaptures: takes Black's pawn on b5, with check.
- *Short term:* Bxb5+ takes back → Kd8 → O-O-O+ → Kc7 → Rd3 → Qb4 → Qxf7+ wins the pawn → Qe7 attacks the queen → a few moves later, White wins back two pawns (+2).
- *Long term:* White gets a passed pawn on c2. Black gets an isolated pawn on a7. After the line, White's king is safer (it is tucked away behind its pawns).

Good — this was the move.

<sub>Candidates: Bxb5+ +8.8 ✓ · Qxb5+ +0.4 ✗(too-much-loss,loses-result,shallow-disagrees) · Bxf6 −1.8 ✗(too-much-loss,loses-result,shallow-disagrees) · Be2 −2.9 ✗(too-much-loss,material-rule,loses-result,shallow-disagrees) · Bf1 −3.0 ✗(too-much-loss,material-rule,loses-result,shallow-disagrees)</sub>
<sub>Timings: total 7.15s, deepAfter 5.00s, shallow 0.04s, threat 0.58s, forcedness 1.50s, facts 0.01s; cached searches 2</sub>

### 11... Nbd7 — Best

Best — the engine's top choice.

Eval +8.7 → +9.0 · Black's win% 4 → 4 · winLoss 0.0 · accuracy 100

- *Immediate:* Defends the knight on f6, which was under attack. Blocks the check. Develops the knight to d7.
- *Short term:* Nbd7 → O-O-O (forced) → Rb8 pins the bishop to the queen → Rxd7 takes the knight → Qxd7 takes the rook → Bxd7+ uncovers an attack on the rook (forced) → Nxd7 takes back → Qa4 pins the knight → a few moves later, Black gives a queen and a knight for a rook and a bishop (−4).
- *Long term:* No notable long-term change.

Good — this was the move.

<sub>Candidates: Nbd7 +8.7 ✗(no-concrete-fact) · Kd8 +8.9 ✗(no-concrete-fact) · Qd7 +8.9 ✗(hangs-material,no-concrete-fact) · Nfd7 +9.9 ✗(hangs-material) · Nc6 +10.9 ✗(material-rule,hangs-material,no-concrete-fact)</sub>
<sub>Timings: total 6.15s, deepAfter 5.00s, shallow 0.07s, threat 0.56s, forcedness 0.50s, facts 0.01s; cached searches 3</sub>

### 12. O-O-O — Best

Best — the engine's top choice.

Eval +9.0 → +8.7 · White's win% 96 → 96 · winLoss 0.0 · accuracy 99

- *Immediate:* Castles queenside.
- *Short term:* O-O-O → Rb8 pins the bishop to the queen → Rxd7 takes the knight → Qxd7 takes the rook → Bxd7+ uncovers an attack on the rook → Nxd7 takes back → Qa4 pins the knight → Bc5 → a few moves later, White wins a queen and a knight for a rook and a bishop (+4).
- *Long term:* White's king is safer (it is tucked away behind its pawns). White's rook on d1 gets an open file.

Good — this was the move.

<sub>Candidates: O-O-O +9.0 ✗(no-concrete-fact) · Bxf6 +5.4 ✗(too-much-loss,shallow-disagrees) · Rd1 +4.0 ✗(too-much-loss,shallow-disagrees,no-concrete-fact) · O-O +1.7 ✗(too-much-loss,loses-result,shallow-disagrees,no-concrete-fact) · c3 +1.0 ✗(too-much-loss,loses-result,shallow-disagrees)</sub>
<sub>Timings: total 6.33s, deepAfter 5.00s, shallow 0.01s, threat 0.23s, forcedness 1.08s, facts 0.01s; cached searches 2</sub>

### 12... Rd8 — Best

Best — the engine's top choice.

Eval +8.7 → +8.9 · Black's win% 4 → 4 · winLoss 0.0 · accuracy 100

- *Immediate:* Nothing special happens right away.
- *Short term:* Rd8 → Rxd7 takes the knight → Rxd7 takes back → Rd1 (forced) → Qe6 → Bxf6 takes the knight → gxf6 takes back → Bxd7+ forks the king and queen → a few moves later, Black ends up behind in material (−4).
- *Long term:* Black's rook on d8 gets an open file. After the line, Black gets an isolated pawn on h7. After the line, Black gets doubled pawns on the f-file.

Good — this was the move.

<sub>Candidates: Rd8 +8.7 ✗(no-concrete-fact) · Qc5 +8.9 ✗(no-concrete-fact) · Rb8 +9.0 ✓ · a6 +9.3 ✓ · g6 +9.4 ✗(no-concrete-fact)</sub>
<sub>Timings: total 6.03s, deepAfter 3.93s, shallow 0.02s, threat 0.93s, forcedness 1.13s, facts 0.02s; cached searches 4</sub>

### 13. Rxd7 — Best

Best — the engine's top choice.

Eval +8.9 → +8.9 · White's win% 96 → 96 · winLoss 0.0 · accuracy 100

- *Immediate:* Takes Black's knight on d7 as a sacrifice (−2) — the follow-up wins it back with interest.
- *Short term:* Rxd7 takes the knight → Nxd7 uncovers an attack on the bishop → Bxe7 takes the queen → Bxe7 takes back → Rd1 → White wins a queen and a knight for a rook and a bishop (+4).
- *Long term:* White gains space.

Good — this was the move.

<sub>Candidates: Rxd7 +8.9 ✓ · Rd5 +6.4 ✗(shallow-disagrees,no-concrete-fact) · Rd3 +5.8 ✗(too-much-loss,shallow-disagrees,no-concrete-fact) · Rd2 +5.5 ✗(too-much-loss,shallow-disagrees) · Bxf6 +5.1 ✗(too-much-loss,shallow-disagrees,no-concrete-fact)</sub>
<sub>Timings: total 5.64s, deepAfter 5.00s, shallow 0.01s, threat 0.07s, forcedness 0.55s, facts 0.01s; cached searches 2</sub>

### 13... Rxd7 — Best

Best — as good as the engine's top move (Nxd7).

Eval +8.9 → +8.9 · Black's win% 4 → 4 · winLoss 0.1 · accuracy 100

- *Immediate:* Recaptures: takes White's rook on d7. Defends the queen on e7, which was under attack. Defends the pawn on a7, which was under attack.
- *Short term:* Rxd7 takes back → Rd1 (forced) → Qb4 → Bxf6 takes the knight → Bc5 → Qxb4 takes the queen → Bxb4 takes back → Bxe5 wins the pawn → a few moves later, Black loses a knight and a pawn (−4).
- *Long term:* After the line, White's king is more exposed (more enemy pieces aim at it). Black gains control of the centre.

Good — this was the move.

<sub>Candidates: Nxd7 +8.9 ✓ · Rxd7 +8.9 ✓ · Qxd7 +10.3 ✗(hangs-material,no-concrete-fact) · Qe6 +20.1 ✗(material-rule) · g6 +20.6 ✗(material-rule)</sub>
<sub>Timings: total 5.90s, deepAfter 5.00s, shallow 0.01s, threat 0.21s, forcedness 0.66s, facts 0.01s; cached searches 3</sub>

### 14. Rd1 — Great !

Great ! — the only good move here: the next best loses 17% winning chances.

Eval +8.9 → +9.2 · White's win% 96 → 97 · winLoss 0.0 · accuracy 100

- *Immediate:* Threatens Bxd7+, winning material (+8).
- *Short term:* Rd1 → Qb4 → Bxf6 takes the knight → Bc5 → Bxd7+ wins the rook → Kf8 (forced) → Qd5 → gxf6 wins the bishop → a few moves later, White wins a rook and a knight (+8).
- *Long term:* White's rook on d1 gets an open file. After the line, Black gets an isolated pawn on h7. After the line, Black gets doubled pawns on the f-file.

Good — this was the move.

<sub>Candidates: Rd1 +8.9 ✓ · Bxf6 +3.6 ✗(too-much-loss,material-rule,shallow-disagrees,no-concrete-fact) · Qc4 +3.6 ✗(too-much-loss,material-rule,shallow-disagrees,no-concrete-fact) · Qc3 +3.1 ✗(too-much-loss,material-rule,shallow-disagrees,no-concrete-fact) · c3 +2.9 ✗(too-much-loss,material-rule,shallow-disagrees,no-concrete-fact)</sub>
<sub>Timings: total 5.30s, deepAfter 5.00s, shallow 0.03s, threat 0.18s, forcedness 0.08s, facts 0.01s; cached searches 2</sub>

### 14... Qe6 — Excellent

Excellent — almost as good as the best move Qb4 (−1% winning chances).

Eval +9.2 → +12.1 · Black's win% 3 → 2 · winLoss 0.8 · accuracy 97

- *Immediate:* Leaves the rook on d7 hanging — it was already attacked and White can still win it (−2).
- *Short term:* Qe6 → Bxd7+ takes the rook → Qxd7 takes the bishop → Qb8+ → Ke7 → Qxe5+ wins the pawn → Kd8 → Qb8+ → a few moves later, Black gives a queen and a pawn for a bishop (−7).
- *Long term:* After the line, Black's king is more exposed (more open files next to it). Black's pieces get more room to move than White's.

**Try this:** a6 (a6 Bxd7+ Nxd7 Bxe7 Bxe7 Qb7; −0.5% winning chances vs the engine's top)
  - *Immediate:* Leaves the rook on d7 hanging — it was already attacked and White can still win it (−2). Threatens axb5, winning material (+2).
  - *Short term:* a6 attacks the bishop → Bxd7+ takes the rook → Nxd7 uncovers an attack on the bishop → Bxe7 takes the queen (forced) → Bxe7 takes back → Qb7 → O-O → Rxd7 wins the knight → a few moves later, Black ends up behind in material (−11).
  - *Long term:* After the line, Black's king is safer (fewer open files next to it and fewer enemy pieces aim at it).
**Engine's top:** Qb4 (Qb4 Bxf6 Bc5 Bxd7+ Kf8 Qd5)
  - *Immediate:* Leaves the rook on d7 hanging — it was already attacked and White can still win it (−2). Attacks White's pawn on e4, which is undefended.
  - *Short term:* Qb4 → Bxf6 takes the knight → Bc5 → Bxd7+ wins the rook → Kf8 → Qd5 → gxf6 wins the bishop → Be8 → a few moves later, Black loses a rook and a knight (−8).
  - *Long term:* After the line, Black's king is safer (fewer enemy pieces aim at it). After the line, Black gets an isolated pawn on h7. After the line, Black gets doubled pawns on the f-file.

<sub>Candidates: Qb4 +9.2 ✗(no-concrete-fact) · Qd6 +9.3 ✗(hangs-material) · a6 +9.7 ✓ · g6 +9.7 ✗(no-concrete-fact) · Kd8 +9.6 ✗(no-concrete-fact)</sub>
<sub>Timings: total 8.29s, deepAfter 5.00s, searchmoves 0.04s, shallow 0.01s, threat 1.11s, forcedness 2.11s, facts 0.02s; cached searches 5</sub>

### 15. Bxd7+ — Best

Best — the engine's top choice.

Eval +12.1 → +6.0 · White's win% 98 → 90 · winLoss 0.0 · accuracy 72

- *Immediate:* Takes Black's rook on d7 and comes out ahead in the exchange (+2), with check.
- *Short term:* Bxd7+ takes the rook → Qxd7 takes the bishop → Qb8+ → Ke7 → Qxe5+ wins the pawn → Kd8 → Bxf6+ takes the knight → gxf6 takes back → a few moves later, White comes out ahead in material (+13).
- *Long term:* After the line, Black's king is more exposed (more open files next to it). After the line, Black gets isolated pawns on f6, f7 and h7. After the line, Black gets doubled pawns on the f-file.

Good — this was the move.

<sub>Candidates: Bxd7+ +12.1 ✓ · Bxf6 +8.8 ✓ · Qc3 +7.9 ✗(shallow-disagrees) · Qxe6+ +5.9 ✗(too-much-loss,shallow-disagrees) · Ba4 +5.2 ✗(too-much-loss,shallow-disagrees)</sub>
<sub>Timings: total 6.41s, deepAfter 5.00s, shallow 0.01s, threat 0.38s, forcedness 1.01s, facts 0.01s; cached searches 2</sub>

### 15... Nxd7 — Best

Best — the engine's top choice.

Eval +6.0 → #2 · Black's win% 10 → 2 · winLoss 0.0 · accuracy 72

- *Immediate:* Recaptures: takes White's bishop on d7.
- *Short term:* Nxd7 takes back → Qb7 → f6 attacks the bishop → Qc8+ pins the knight to the queen → Ke7 → Be3 (forced) → a5 → c4 → Black wins back a bishop (+3).
- *Long term:* White loses the bishop pair. After the line, Black's king is safer (fewer enemy pieces aim at it). After the line, White's king is more exposed (fewer pawns in front of it).

Good — this was the move.

<sub>Candidates: Nxd7 +6.0 ✓ · Qxd7 +12.9 ✗(too-much-loss,material-rule,hangs-material,shallow-disagrees,no-concrete-fact) · Ke7 #4 ✗(too-much-loss,material-rule,hangs-material,loses-result,shallow-disagrees,no-concrete-fact) · Kd8 #2 ✗(too-much-loss,material-rule,hangs-material,loses-result,shallow-disagrees,no-concrete-fact)</sub>
<sub>Timings: total 6.51s, deepAfter 5.00s, shallow 0.00s, threat 0.27s, forcedness 1.23s, facts 0.01s; cached searches 1</sub>

### 16. Qb8+ — Best

Best — the engine's top choice.

Eval #2 → #1 · White's win% 98 → 98 · winLoss 0.0 · accuracy 100

- *Immediate:* Sacrifices the queen on b8 (−9) — it leads to mate. Gives check.
- *Short term:* Qb8+ → Nxb8 wins the queen (forced) → Rd8# is checkmate.
- *Long term:* White gains space.

Good — this was the move.

<sub>Candidates: Qb8+ #2 ✓ · Qc3 +6.3 ✗(too-much-loss,material-rule,hangs-material,shallow-disagrees) · Qb7 +6.3 ✗(too-much-loss,material-rule,shallow-disagrees) · Rd5 +0.5 ✗(too-much-loss,material-rule,loses-result,shallow-disagrees) · Qb5 +0.2 ✗(too-much-loss,material-rule,loses-result,shallow-disagrees)</sub>
<sub>Timings: total 0.02s, deepAfter 0.00s, shallow 0.00s, threat 0.01s, facts 0.01s; cached searches 2</sub>

### 16... Nxb8 — Forced

Forced — the only legal move.

Eval #1 → #1 · Black's win% 2 → 2 · winLoss 0.0 · accuracy 100

- *Immediate:* Allows checkmate: White can mate next move. Wins White's queen on b8 for free (+9).
- *Short term:* Nxb8 wins the queen → Rd8# is checkmate.
- *Long term:* It was the only legal move. Black's pieces get more room to move than White's.

Good — this was the move.

<sub>Candidates: Nxb8 #1 ✗(hangs-material)</sub>
<sub>Timings: total 5.04s, deepAfter 5.00s, shallow 0.00s, threat 0.03s, forcedness 0.01s, facts 0.00s; cached searches 1</sub>

### 17. Rd8# — Best

Best — checkmate!

Eval #1 → checkmate · White's win% 98 → 98 · winLoss 0.0 · accuracy 100

- *Immediate:* Checkmate — White wins.
- *Short term:* Rd8# is checkmate.
- *Long term:* White just had to play this — every other move is much worse.

Good — this was the move.

<sub>Candidates: Rd8# #1 ✓ · Kb1 −9.1 ✗(too-much-loss,material-rule,loses-result,shallow-disagrees) · Rd5 −9.4 ✗(too-much-loss,material-rule,loses-result,shallow-disagrees) · b3 −9.4 ✗(too-much-loss,material-rule,loses-result,shallow-disagrees) · a3 −9.2 ✗(too-much-loss,material-rule,loses-result,shallow-disagrees)</sub>
<sub>Timings: total 0.02s, shallow 0.01s, threat 0.00s, facts 0.01s; cached searches 2</sub>
