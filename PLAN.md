# Build plan & status

Coordinator keeps this updated. Each milestone is done by a subagent; its report summary goes under the milestone.

- [ ] **M0 Scaffold** — workspaces, shared types/settings/winchance, setup-engine script, Engine (UCI) + scheduler, tests.
- [ ] **M1a Classification** — material/SEE helpers, classify.ts (all labels + material rule + Miss + Great + Forced), book.ts, tests.
- [ ] **M1b Facts** — immediate.ts, positional.ts (+ deltas), tests.
- [ ] **M1c Client UI** — full v1 screen against fixture data (no server dependency), component tests.
- [ ] **M2 Integration** — line.ts (short-term narration + forcedness), suggest.ts, explain.ts, analyzeMove.ts, games/cache/routes/SSE, client wired to API.
- [ ] **M3 Benchmarks** — Lichess puzzles vs facts; Lichess annotated games vs labels; fix & tune; reports in bench/reports.
- [ ] **M4 E2E + performance** — Playwright flows, screenshots reviewed, timing per game measured and tuned.
- [ ] **M5 Explanation review loop** — independent reviewer agents grade explanations on sample games; fix; repeat.
- [ ] **M6 Final** — README, final report, known limitations.
