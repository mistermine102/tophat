# Build plan & status

Coordinator keeps this updated. Each milestone is done by a subagent; its report summary goes under the milestone.

- [x] **M0 Scaffold** — workspaces, shared types/settings/winchance, setup-engine script, Engine (UCI) + scheduler, tests.
  - npm workspaces (`shared`, `server`, `client`), TS 6.0 strict ESM (TS 7 can't run vue-tsc), no build step;
    `@chess-coach/shared` is imported as TS source everywhere. Express 5 + tsx, Vue 3.5 + Vite 8 + Tailwind 4, Vitest 5.
  - shared: `types.ts` (verbatim), `settings.ts` (`DEFAULT_SETTINGS`, `ANALYSIS_VERSION=1`, `settingsHash`),
    `winchance.ts` (Lichess win%/accuracy, faithful port of `AccuracyPercent.gameAccuracy`).
  - server: `Engine` (uci.ts; serialised, timeouts, crash→restart, `bestmove (none)`), `Scheduler` (priorities,
    dedupe, bump, FIFO), `/api/health`. `npm run setup:engine` is idempotent.
  - 58 tests (engine integration tests auto-skip without the binary). Deep d18 MultiPV5 ≈ 1.4–6.8 s/move
    (Threads 10) — ≥95 % of per-move cost; see ARCHITECTURE.md "Analysis budget".
- [x] **M1a Classification** — material/SEE helpers, classify.ts (all labels + material rule + Miss + Great + Forced), book.ts, tests.
  - material.ts (lineMaterial to quiet point), classify.ts (ClassifyInput/classifyMove/materialCheck, mover-POV scores), book.ts (Lichess TSVs vendored, 0.3 s load).
  - Interpretations: material reference capped at current/pre-opponent-move material (so missed free pieces are Miss, not material Blunder); mating best line never flags a still-mating move; recapture on last-move square is never Great; book traps (Fool's mate) keep Miss/Blunder.
  - Material guard uses unclamped cp (mate = ±(100000−100n)) so hanging a queen at +17.8→+8.5 is a Blunder. 153 server tests.
- [x] **M1b Facts** — immediate.ts, positional.ts (+ deltas), tests.
  - chess/attacks.ts, chess/see.ts (legal-capture SEE), facts/immediate.ts (fork/skewer only if mover wins vs every reply), facts/positional.ts (~0.05 ms/pos).
  - Puzzle benchmark (bench/reports/puzzle-facts.md): any-move recall fork 92%, skewer 89%, discovered 87%, double check 100%, mateIn1 100%, pin 35% (weak: Lichess pin = exploiting existing pins). 20/20 eyeballed non-theme firings genuine.
  - Merged total: 254 tests passing.
- [x] **M1c Client UI** — full v1 screen against fixture data (no server dependency), component tests.
  - api/ (ApiClient: real + mock via ?mock=1), lib/ (move tree, formatting, labels, summary), stores/session.ts, components/ (Board/chessground, EvalBar, EvalGraph, MoveList, ExplanationPanel, Summary, dialogs). 49 vitest + 3 Playwright (mock).
  - Coordinator review of screenshot: clean layout. To fix in M2-client: label-reason sentence uses mover POV (+6.7) next to White-POV eval row (-6.7) — make POV explicit/consistent.
- [~] **M2 Integration** — line.ts (short-term narration + forcedness), suggest.ts, explain.ts, analyzeMove.ts, games/cache/routes/SSE, client wired to API.
  - M2-server merged: pipeline (~5 s/ply cold, searchCache reuses deep search of next position), explain.ts templates, cache/games/routes/SSE, analyze-pgn CLI. 348 tests. Coordinator review of Opera report found: a false mid-exchange material claim, wrong hung-piece square, mistakes not explained by the refutation, over-long lines, long-term noise, a pick bug (Qb3 "hard to explain"), allowed-mate labelled Best.
  - Running in parallel: M5a (explanation fixes + review loop on amateur games), M3 (label benchmark vs Lichess, allowed/missed-mate rules, hung-piece fix, stability, depth), M2-client (real API wiring, POV fix, real-server E2E).
  - bench/games/lichess: 60 Lichess games (1500–1600, ≥5 min) with server analysis, fetched via puzzle GameUrls.
  - M2-client merged: real wiring verified (streaming, focus reprioritisation, side lines, reload via ?game=id), POV labelled everywhere, env ENGINE_THREADS/ENGINE_HASH_MB/ANALYSIS_PROFILE=fast/LOG_ANALYSIS, 11 E2E (3 mock + 8 real incl. engine kill, FEN start, stalemate, 160-ply). Legend, square hover highlight, Play-it.
- [x] **M3 Benchmarks** — Lichess puzzles vs facts; Lichess annotated games vs labels; fix & tune; reports in bench/reports.
  - M3 merged: Lichess thresholds are 5/10/15 win% (lila winningChances 0.1/0.2/0.3); lichess-profile agreement 87.4% on 4826 plies (Lichess rules on our evals 86.5% → gap = engine eval). Fixed material baseline after unanswerable captures, lost-position false firings, hung-piece naming. Mate rules (allowed mate ≤3 → Blunder, missed mate ≤3 → Miss). Precision: material 34/43 correct + 9 debatable + 0 wrong; mate 14/14; Great 1.3/side/game (0 wrong); Miss 1.45. Stability 4.9% severity changes run-to-run (threshold-adjacent); deterministic mode via maxNodes + 1 thread. Depth: d16 ≈ d18 vs d22 reference, 2× faster → recommend d16. ANALYSIS_VERSION 2. 450 tests on main.
- [x] **M4 E2E + performance** — Playwright flows, screenshots reviewed, timing per game measured and tuned.
  - M4 merged: deep d16; 5 Stockfish processes × 2 threads (at fixed depth more threads = wider not faster); preemption via Engine.abort() for focus/side lines. 84-ply game 429–492 s → 68–74 s; first label ~2 s; side line ~1.2–1.9 s; focused ply 3.8–9.1 s. Label quality within noise (Lichess agreement 88.2–88.5%). npm start (single port 5174), setup:engine hint. 12 E2E. 463 tests.
- [~] **M5 Explanation review loop** — independent reviewer agents grade explanations on sample games; fix; repeat.
  - M5a merged: payoff-bounded short lines (no mid-exchange claims), refutation fact `allows` leads bad moves, claims cross-checked with the PV (no "for free"), long-term ≤2 facts, pick concreteness fixed, verdictText. Review rounds with reviewer agents (FALSE/misleading): r2 22/75 → r3 5/52 → r4 4/26 (r4 FALSE root cause fixed after). Log: bench/reports/explanation-review.md. Remaining: king displacement/castling rights, prophylaxis, positional mistakes read "Nothing special".
- [ ] **M6 Final** — README, final report, known limitations.
