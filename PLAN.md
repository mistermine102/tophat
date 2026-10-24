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
- [ ] **M1c Client UI** — full v1 screen against fixture data (no server dependency), component tests.
- [ ] **M2 Integration** — line.ts (short-term narration + forcedness), suggest.ts, explain.ts, analyzeMove.ts, games/cache/routes/SSE, client wired to API.
- [ ] **M3 Benchmarks** — Lichess puzzles vs facts; Lichess annotated games vs labels; fix & tune; reports in bench/reports.
- [ ] **M4 E2E + performance** — Playwright flows, screenshots reviewed, timing per game measured and tuned.
- [ ] **M5 Explanation review loop** — independent reviewer agents grade explanations on sample games; fix; repeat.
- [ ] **M6 Final** — README, final report, known limitations.
