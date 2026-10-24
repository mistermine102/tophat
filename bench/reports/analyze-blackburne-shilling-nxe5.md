# White vs Black — *

Regression: 4.Nxe5? Qg5 (Blackburne Shilling trap) · ? · ????.??.??

Engine Stockfish 19, 5 threads; deep d18 MultiPV 5, shallow d8, threat d12, forcedness d12.
Wall time 0.6 s for 8 plies (0.08 s/ply); engine searches run 0 (0.0 s engine time), served from cache 95.

## Summary

| | White (White) | Black (Black) |
|---|---|---|
| Accuracy | 63.9 | 80.5 |
| Book | 3 | 3 |
| Great ! | 0 | 1 |
| Mistake ? | 1 | 0 |

## Moves

### 1. e4 — Book

Book — a known opening move (King's Pawn Game, B00).

Eval +0.3 → +0.3 · White's win% 53 → 53 · winLoss 0.0 · accuracy 99

- *Immediate:* Nothing special happens right away.
- *Short term:* No forcing follow-up.
- *Long term:* No notable long-term change.

Opening theory.

<sub>Candidates: e4 +0.3 ✗(no-concrete-fact) · d4 +0.2 ✗(no-concrete-fact) · Nf3 +0.2 ✗(no-concrete-fact) · e3 +0.1 ✗(no-concrete-fact) · c4 +0.1 ✗(no-concrete-fact)</sub>
<sub>Timings: total 0.04s, facts 0.03s; cached searches 9</sub>

### 1... e5 — Book

Book — a known opening move (King's Pawn Game, C20).

Eval +0.3 → +0.3 · Black's win% 47 → 47 · winLoss 0.0 · accuracy 100

- *Immediate:* Nothing special happens right away.
- *Short term:* No forcing follow-up.
- *Long term:* Black gains control of the centre.

Opening theory.

<sub>Candidates: e5 +0.3 ✗(no-concrete-fact) · e6 +0.3 ✗(no-concrete-fact) · c5 +0.4 ✗(no-concrete-fact) · c6 +0.4 ✗(no-concrete-fact) · Nc6 +0.5 ✗(no-concrete-fact)</sub>
<sub>Timings: total 0.03s, facts 0.02s; cached searches 9</sub>

### 2. Nf3 — Book

Book — a known opening move (King's Knight Opening, C40).

Eval +0.3 → +0.3 · White's win% 53 → 52 · winLoss 0.0 · accuracy 99

- *Immediate:* Threatens Nxe5, winning a pawn (+1 point). Develops the knight to f3.
- *Short term:* No forcing follow-up.
- *Long term:* No notable long-term change.

Opening theory.

<sub>Candidates: Nf3 +0.3 ✓ · Nc3 +0.1 ✗(no-concrete-fact) · a3 −0.0 ✗(no-concrete-fact) · Bc4 −0.1 ✗(no-concrete-fact) · d4 −0.1 ✗(no-concrete-fact)</sub>
<sub>Timings: total 0.03s, facts 0.02s; cached searches 11</sub>

### 2... Nc6 — Book

Book — a known opening move (King's Knight Opening: Normal Variation, C44).

Eval +0.3 → +0.2 · Black's win% 48 → 48 · winLoss 0.0 · accuracy 100

- *Immediate:* Stops White's threat Nxe5, which would win a pawn (+1 point for White). Develops the knight to c6.
- *Short term:* No forcing follow-up.
- *Long term:* No notable long-term change.

Opening theory.

<sub>Candidates: Nc6 +0.3 ✓ · Nf6 +0.4 ✓ · d6 +0.7 ✓ · Bd6 +1.0 ✗(too-much-loss,shallow-disagrees) · d5 +1.1 ✗(too-much-loss,shallow-disagrees,no-concrete-fact)</sub>
<sub>Timings: total 0.03s, facts 0.02s; cached searches 14</sub>

### 3. Bc4 — Book

Book — a known opening move (Italian Game, C50).

Eval +0.2 → +0.2 · White's win% 52 → 52 · winLoss 0.6 · accuracy 99

- *Immediate:* Develops the bishop to c4.
- *Short term:* No forcing follow-up.
- *Long term:* No notable long-term change.

Opening theory.

<sub>Candidates: Bb5 +0.2 ✗(no-concrete-fact) · Bc4 +0.2 ✗(no-concrete-fact) · Nc3 +0.1 ✗(no-concrete-fact) · d4 +0.0 ✗(no-concrete-fact) · h3 +0.0 ✗(no-concrete-fact)</sub>
<sub>Timings: total 0.04s, facts 0.03s; cached searches 10</sub>

### 3... Nd4 — Book

Book — a known opening move (Italian Game: Blackburne-Kostić Gambit, C50).

Eval +0.2 → +1.3 · Black's win% 48 → 39 · winLoss 10.0 · accuracy 65

- *Immediate:* Nothing special happens right away.
- *Short term:* No forcing follow-up.
- *Long term:* No notable long-term change.

Opening theory.

<sub>Candidates: Nf6 +0.2 ✓ · Bc5 +0.2 ✗(no-concrete-fact) · d6 +0.4 ✗(no-concrete-fact) · Be7 +0.5 ✗(no-concrete-fact) · h6 +0.6 ✗(no-concrete-fact)</sub>
<sub>Timings: total 0.04s, facts 0.03s; cached searches 13</sub>

### 4. Nxe5 — Mistake ?

Mistake ? — Nxd4 was much better. White's winning chances go from 61% to 45%.

Eval +1.3 → −0.7 · White's win% 61 → 43 · winLoss 16.5 · accuracy 44

- *Immediate:* Takes Black's pawn on e5, but allows Qg5: then White's knight on e5 and pawn on g2 are both under attack.
- *Short term:* Nxe5 takes the pawn → Qg5 attacks the knight → … → Qxe5 wins the knight → c3 attacks the knight → … → d4 attacks the queen → Qxe4 wins the pawn → White loses a knight (−3 points).
- *Long term:* No notable long-term change.

**Engine's top:** Nxd4 — deep engine move — hard to explain (Nxd4 exd4 O-O c6 Re1 d6)
  - *Immediate:* Takes Black's knight on d4 — an even trade.
  - *Short term:* Nxd4 takes the knight → exd4 takes back → material stays level.
  - *Long term:* No notable long-term change.

<sub>Candidates: Nxd4 +1.3 ✗(no-concrete-fact) · O-O +1.0 ✗(no-concrete-fact) · Nc3 +0.7 ✗(too-much-loss,shallow-disagrees,no-concrete-fact) · a4 +0.5 ✗(too-much-loss,shallow-disagrees,no-concrete-fact) · c3 +0.4 ✗(too-much-loss,shallow-disagrees)</sub>
<sub>Timings: total 0.04s, facts 0.03s; cached searches 16</sub>

### 4... Qg5 — Great !

Great ! — the only good move here: the next best loses 12% winning chances.

Eval −0.7 → −0.5 · Black's win% 57 → 54 · winLoss 0.0 · accuracy 91

- *Immediate:* Threatens Qxg2, winning a pawn (+1 point). Attacks White's knight on e5, which is undefended.
- *Short term:* Qg5 attacks the knight → O-O → Qxe5 wins the knight → Black wins a knight (+3 points); Black is 2 points up.
- *Long term:* No notable long-term change.

Great find — the only good move here.

<sub>Candidates: Qg5 −0.7 ✓ · Qe7 +0.6 ✗(too-much-loss,shallow-disagrees) · d5 +0.8 ✗(too-much-loss,hangs-material,shallow-disagrees) · Ne6 +3.1 ✗(too-much-loss,hangs-material,loses-result,shallow-disagrees) · Qf6 +3.6 ✗(too-much-loss,material-rule,hangs-material,loses-result,shallow-disagrees)</sub>
<sub>Timings: total 0.03s, facts 0.02s; cached searches 13</sub>
