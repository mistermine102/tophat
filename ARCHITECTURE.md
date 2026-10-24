# Chess Coach — Architecture

Read `SPEC.md` first. This file defines module boundaries and contracts so several people/agents can build in
parallel. If you need to change a contract, update this file in the same commit and say so in your report.

## Stack

- **npm workspaces** monorepo, TypeScript everywhere, ESM, Node 24.
- `shared/` — types + pure chess helpers used by both sides (no Node/browser-specific APIs).
- `server/` — Express 5 + TypeScript (run with `tsx`), native Stockfish 19 via UCI, `node:sqlite` cache,
  Server-Sent Events.
- `client/` — Vue 3 + Vite + Tailwind 4 + TypeScript, `chessground` (board), `chessops` (rules/SAN/FEN/PGN).
- Chess logic library on both sides: **`chessops`** (Lichess, GPL-3). Do not add chess.js.
- Tests: **Vitest** (unit/integration), **Playwright** (e2e). Benchmarks are scripts under `bench/`.
- Engine binary: `engine/stockfish.exe` (gitignored; `npm run setup:engine` downloads Stockfish 19 from the
  official GitHub release `sf_19`, asset `stockfish-windows-x86-64-universal.zip`). Path override via env
  `STOCKFISH_PATH`.
- **TypeScript 6.0.x** (not 7.x): TS 7 is the native Go port without the JS compiler API, and `vue-tsc` cannot
  run on it. One TS version for the whole repo (root devDependency). No build step: `noEmit`, `moduleResolution:
  bundler`, extensionless relative imports; `tsx` runs the server, Vite/Vitest transform TS directly.
- **`@chess-coach/shared`** is consumed as TS source: its `package.json` `exports` map `.` → `src/index.ts` and
  `./*` → `src/*.ts`. Import `from '@chess-coach/shared'` (or `'@chess-coach/shared/winchance'`) in server, client
  and tests alike. Do not add Node/browser APIs to shared.
- Root `npm test` runs Vitest projects `shared`, `server`, `client` (root `vitest.config.ts`); `npm run typecheck`
  runs `tsc` (shared, server) and `vue-tsc` (client).

## Layout

```
chess-coach/
  SPEC.md  ARCHITECTURE.md  PLAN.md  README.md
  package.json            # workspaces: shared, server, client; root scripts: dev, test, e2e, bench:*, setup:engine
  scripts/setup-engine.mjs
  engine/                 # gitignored
  data/                   # gitignored: cache sqlite, downloaded benchmark data
  shared/src/
    types.ts              # API + analysis types (below)
    settings.ts           # default thresholds/settings (below)
    winchance.ts          # cp/mate -> win%, move accuracy, game accuracy (Lichess formulas)
  server/src/
    index.ts              # starts Engine + Scheduler, Express on PORT (default 5174)
    app.ts                # createApp(ctx: AppContext) -- Express app factory (testable without engine/listen)
    engine/uci.ts         # Engine: UCI process wrapper
    engine/scheduler.ts   # priority queue in front of the Engine (single engine process)
    chess/                # pure position helpers on chessops: material, see.ts (static exchange), attacks
    facts/immediate.ts    # Immediate facts: (posBefore, move) -> Fact[]
    facts/positional.ts   # positional features + deltas
    facts/line.ts         # Short-term narration of a PV
    analysis/classify.ts  # label rules incl. material rule, Miss, Great, Forced, Book
    analysis/book.ts      # opening book lookup (Lichess chess-openings TSV, vendored in server/data/openings/)
    analysis/suggest.ts   # explainable pick
    analysis/explain.ts   # Fact -> text templates (the ONLY place that produces prose)
    analysis/analyzeMove.ts  # orchestrates engine calls for one (fenBefore, move) -> MoveAnalysis
    games.ts              # PGN import -> Game; per-game queue state; summary
    cache.ts              # node:sqlite cache
    routes.ts             # REST + SSE
  server/test/            # vitest; engine-dependent tests use describe.skipIf(!engineAvailable())
  server/scripts/engine-timing.ts  # `npm run bench:engine -w server`: times the analysis budget searches
  client/src/ ...
  client/e2e/             # playwright
  bench/                  # puzzle + annotated-games benchmarks, reports written to bench/reports/*.md
```

## Conventions

- Squares/moves in UCI internally (`e2e4`, `e7e8q`, castling as king-to-square `e1g1`). SAN only for display.
- **Score POV:** `Score` from UCI is side-to-move POV. In `MoveAnalysis` every eval exposed for display is
  **White POV** (`evalBefore`, `evalAfter`, candidate `score`), while win%/winLoss are **mover POV**. Name
  fields accordingly; never mix silently.
- Piece values for material: P=1, N=3, B=3, R=5, Q=9, K=0.
- All prose comes from `explain.ts`. Facts carry data only (`type` + fields). Text is attached as `text` when
  rendered.
- Settings are passed explicitly (no globals) so the cache key can include a settings hash.
- `ANALYSIS_VERSION` constant in `shared/src/settings.ts`; bump it when output semantics change (invalidates cache).

## Engine (`server/src/engine/uci.ts`)

```ts
export interface EngineOptions { path?: string; threads?: number; hashMb?: number }
export interface SearchRequest {
  fen: string;
  multipv?: number;          // default 1
  depth?: number;            // stop condition (one of depth/movetimeMs/nodes required)
  movetimeMs?: number;
  nodes?: number;
  searchmoves?: string[];    // UCI moves to restrict to
}
export interface PvLine {
  multipv: number;           // 1-based rank
  move: string;              // first move UCI
  score: Score;              // side-to-move POV
  depth: number;
  pv: string[];              // UCI
}
export interface SearchResult { lines: PvLine[]; bestmove: string | null; depth: number; nodes: number; timeMs: number }
export class Engine {
  static start(opts?: EngineOptions): Promise<Engine>;
  search(req: SearchRequest): Promise<SearchResult>;   // serialised internally; safe to call concurrently
  newGame(): Promise<void>;
  quit(): Promise<void>;
}
```
- Keep only the final info line per multipv (highest depth, not `lowerbound`/`upperbound` if a full one exists).
- Positions with no legal moves: return `{ lines: [], bestmove: null }` without hanging (engine prints
  `bestmove (none)`).
- Defaults: Threads = max(1, cpus-2), Hash = 512.
- Additions made in M0 (all optional / additive): `SearchRequest.timeoutMs` (default 120 s; movetime-only
  searches: movetime + 10 s), `EngineOptions.searchTimeoutMs`; `engine.name` (from `id name`, e.g.
  `"Stockfish 19"`), `engine.alive`, `engine.restart()`; error classes `EngineError`, `EngineTimeoutError`,
  `EngineCrashedError`; helpers `defaultEnginePath()`, `engineAvailable()`, `parseInfoLine()`, `PvCollector`.
- The FEN is validated (and normalised) with chessops before it is sent (invalid FENs can crash Stockfish);
  illegal `searchmoves` reject with `EngineError`. King-takes-rook castling (`e1h1`) in searchmoves is converted
  to `e1g1`.
- Timeout → `stop`; if the engine doesn't answer it is killed. Crash → the pending search rejects with
  `EngineCrashedError`; the next call transparently starts a new process. After `quit()` calls reject.

`scheduler.ts` wraps an Engine with a priority queue: `new Scheduler(engine)`, `run(key, priority, job)` where
`job: (engine) => Promise<T>`; priorities `Priority.SIDELINE=0` (highest), `FOCUS=1`, `BACKGROUND=2`. A move
analysis is a job composed of several searches; priority applies per job. One job runs at a time (not
preemptive); FIFO within a priority. Same key while queued/running → the same promise (job runs once) and the
queued job is upgraded to the higher priority (never downgraded). `bump(key, priority)` re-prioritises a queued
job; a job that changes priority joins the back of its new priority class. Finished keys are forgotten (results
are cached elsewhere). Also `has(key)`, `priorityOf(key)`, `size`, `busy`, `onIdle()`.

## Analysis budget (defaults in settings, tune with measurements)

Per analysed move `(fenBefore, move)`:
1. **Deep** search at `fenBefore`, MultiPV 5, depth 18 → candidates, best line, 2nd best (Great).
   If the played move isn't among the 5, an extra deep search with `searchmoves=[move]`.
2. **Shallow** search at `fenBefore`, MultiPV 5, depth 8 → explainability test.
3. **Threat** search for the played move and for the pick: position after the move with the side to move
   flipped (null move; skip if the move gives check), MultiPV 1, depth 12.
4. **Forcedness** checks along the short line: at each opponent reply in the first N plies, MultiPV 2 depth 12.
5. The deep line of the played move (from 1 or the searchmoves search) gives the material-rule line.

All values live in `DEFAULT_SETTINGS.budget` (`shared/src/settings.ts`).

**Measured in M0** (Stockfish 19, Ryzen 5 3600, Threads=10, Hash=512; 3 middlegames: QGD / Najdorf / closed Ruy;
cold = after `ucinewgame`; multi-threaded timings are noisy, ±50 %):

| search | time per search |
|---|---|
| deep d18 MultiPV 5 | 1.4–6.8 s (typ. 2–5 s); warm hash 1.3–4.2 s |
| deep d16 / d14 / d20 MultiPV 5 | 1.1–2.3 s / 0.45–1.0 s / 3–13 s |
| d18 MultiPV 1 | 0.24–1.9 s |
| shallow d8 MultiPV 5 | 12–34 ms |
| threat d12 MultiPV 1 | 17–53 ms |
| forcedness d12 MultiPV 2 | 40–280 ms |

So the deep search is ≥ 95 % of the cost: ≈ 3–4 s per move, i.e. ≈ 4–6 min for an 80-ply game at d18.

## Win chance / accuracy (`shared/src/winchance.ts`)

`scoreToCp`, `winningChances`, `winPercent(cp)`, `winPercentFromScore`, `winPercentForColor(whiteScore, color)`,
`flipScore`, `toWhitePov(score, sideToMove)`, `fromWhitePov(whiteScore, color)`, `moveAccuracy(winBefore,
winAfter)`, `gameAccuracy(whiteCps[], startColor)` / `gameAccuracyFromScores(whiteScores[], startColor)` (input
includes the initial position's eval; `null` = unknown), plus `standardDeviation`, `weightedMean`,
`harmonicMean`. Notes:
- `moveAccuracy` is Lichess' exact `fromWinPercents`: 100 when win% doesn't drop, else
  `103.1668100711649·e^(−0.04354415386753951·Δ) − 3.166924740191411` **+ 1** ("uncertainty bonus"), clamped to
  [0, 100]. SPEC.md quotes the rounded formula without the +1; we follow Lichess.
- `mate: 0` = the POV side is checkmated (−1000 cp). `flipScore({mate: 0})` = `{cp: 1000}` (a delivered mate has no
  signed UCI mate value) — detect checkmate on the board to display "#".

## Shared types (`shared/src/types.ts`)

```ts
export type Color = 'white' | 'black';
export type Label =
  | 'forced' | 'book' | 'best' | 'great' | 'excellent' | 'good'
  | 'inaccuracy' | 'mistake' | 'miss' | 'blunder';
export interface Score { cp?: number; mate?: number }   // exactly one set; mate>0 = side to move mates

export type PieceRole = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';
export interface PieceRef { role: PieceRole; square: string; color: Color }

// Facts: discriminated union. Data only; `explain.ts` renders text.
export type Fact =
  | { type: 'check'; double?: boolean; discovered?: boolean }
  | { type: 'checkmate' }
  | { type: 'capture'; captured: PieceRef; outcome: 'wins-material' | 'even-trade' | 'recapture' | 'loses-material'; net: number }
  | { type: 'promotion'; to: PieceRole }
  | { type: 'castle'; side: 'king' | 'queen' }
  | { type: 'develop'; piece: PieceRef }
  | { type: 'attack'; attacker: PieceRef; target: PieceRef; reason: 'undefended' | 'higher-value' | 'king' }
  | { type: 'fork'; attacker: PieceRef; targets: PieceRef[] }
  | { type: 'pin'; pinner: PieceRef; pinned: PieceRef; behind: PieceRef; absolute: boolean }
  | { type: 'skewer'; attacker: PieceRef; front: PieceRef; behind: PieceRef }
  | { type: 'discovered-attack'; moved: PieceRef; attacker: PieceRef; target: PieceRef }
  | { type: 'escape'; piece: PieceRef; from: string }               // piece was en prise, now safe
  | { type: 'defend'; defender: PieceRef; piece: PieceRef }          // newly defends an attacked piece
  | { type: 'block-check' } | { type: 'escape-check' }
  | { type: 'hangs'; piece: PieceRef; loss: number }                 // negative: leaves material en prise
  | { type: 'allows-mate'; inMoves: number }                         // negative
  | { type: 'threat'; move: string; san: string; gain: number; mateIn?: number; facts: Fact[] }
  | { type: 'line'; steps: LineStep[]; materialDelta: number; mateIn?: number; result: 'wins-material' | 'loses-material' | 'mate' | 'mated' | 'trade' | 'quiet' }
  | { type: 'forced-reply'; san: string; alternatives: number }      // opponent's reply was (nearly) the only move
  | { type: 'positional'; feature: PositionalFeature; delta: number; detail?: string }
  | { type: 'positional-gain'; cp: number }                          // eval gain not explained by material
  | { type: 'deep-payoff' }                                          // only deep search likes it
  | { type: 'necessary' }                                            // all alternatives much worse
  | { type: 'nothing-notable' };

export type PositionalFeature =
  | 'king-safety' | 'passed-pawn' | 'isolated-pawn' | 'doubled-pawn' | 'mobility'
  | 'centre-control' | 'development' | 'open-file-rook' | 'bishop-pair' | 'space';

export interface LineStep { ply: number; san: string; uci: string; color: Color; facts: Fact[]; forced?: boolean }

export interface Level { facts: Fact[]; text: string[] }        // text[i] renders facts (not necessarily 1:1)
export interface Explanation { immediate: Level; short: Level; long: Level }

export interface Candidate {
  uci: string; san: string;
  rank: number;                       // 1-based engine rank (deep)
  score: Score;                       // White POV
  winLoss: number;                    // mover POV, vs best
  pv: string[];                       // SAN
  pvUci: string[];
  explainable: boolean;
  notExplainableReasons?: string[];   // machine-readable codes, e.g. 'too-much-loss','shallow-disagrees','no-concrete-fact','loses-result','material-rule'
  explanation?: Explanation;          // present for played move, pick and best
}

export interface MaterialCheck { playedLine: number; bestLine: number; loss: number; evalDropCp: number; label?: Label; hung?: PieceRef }

export interface MoveAnalysis {
  version: number;
  fenBefore: string; fenAfter: string;
  uci: string; san: string;
  color: Color;                        // mover
  evalBefore: Score; evalAfter: Score; // White POV
  winBefore: number; winAfter: number; // mover POV, %
  winLoss: number;
  accuracy: number;                    // per-move accuracy %
  label: Label;
  labelReason: { winChance: Label; material?: MaterialCheck; miss?: boolean; great?: { secondBestLoss: number }; book?: { eco: string; name: string } };
  played: Candidate;                   // the played move as a candidate, with explanation
  best: Candidate;
  pick: Candidate | null;              // explainable pick; null if none
  pickIsBest: boolean;
  deepOnly: boolean;                   // no explainable candidate -> "deep engine move, hard to explain"
  candidates: Candidate[];             // top-5 summary (explanation may be omitted)
  arrows: Arrow[];
  timings?: Record<string, number>;
}
export interface Arrow { from: string; to: string; kind: 'pick' | 'best' | 'threat' | 'played' }

export interface GameMove { ply: number; san: string; uci: string; color: Color; fenBefore: string; fenAfter: string }
export interface GameInfo {
  id: string; headers: Record<string, string>; startFen: string; moves: GameMove[];
  you: Color; orientation: Color;
}
export interface SideSummary { accuracy: number | null; counts: Partial<Record<Label, number>> }
export interface GameSummary { white: SideSummary; black: SideSummary; done: number; total: number }

export interface Settings { username: string | null }
```

## HTTP API (server, prefix `/api`; Vite dev proxies `/api` to the server)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/games` | `{ pgn }` | `GameInfo` (enqueues all plies, background priority). 400 `{error}` on bad PGN |
| GET | `/api/games/:id` | — | `{ game: GameInfo, analyses: Record<ply, MoveAnalysis>, summary: GameSummary }` |
| GET | `/api/games/:id/stream` | — | SSE: `event: analysis` data `{ ply, analysis }`; `event: progress` `{ done, total }`; `event: summary` `GameSummary`; `event: error` `{ ply, message }`. On connect, replays already-finished analyses. |
| POST | `/api/games/:id/focus` | `{ ply }` | 204; bumps that ply (and ply+1) to FOCUS priority |
| POST | `/api/analyse` | `{ fenBefore, uci, prev?: { fenBefore, uci } }` | `MoveAnalysis` (SIDELINE priority; `prev` enables Miss detection) |
| GET/PUT | `/api/settings` | `Settings` | `Settings` (persisted in sqlite) |
| GET | `/api/health` | — | `{ ok: true, engine: 'Stockfish 19' }`; 503 `{ ok: false, engine: null, error }` if the engine isn't running |

`ply` is 1-based index into `moves` (ply 1 = White's first move).

## Cache

Key = sha1(`ANALYSIS_VERSION | settingsHash | fenBefore | uci | prevKey`). Value = MoveAnalysis JSON.
`data/cache.sqlite` via `node:sqlite` (`DatabaseSync`). Games are also persisted (id = sha1 of normalised move
list + start FEN) so reopening the same PGN returns the same id.
