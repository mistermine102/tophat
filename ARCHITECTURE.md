# Chess Coach — Architecture

Read `SPEC.md` first. This file defines module boundaries and contracts so several people/agents can build in
parallel. If you need to change a contract, update this file in the same commit and say so in your report.

## Stack

- **npm workspaces** monorepo, TypeScript everywhere, ESM, Node 24 (for tooling only).
- **No server (C1):** the whole analysis runs in the browser — see "In-browser analysis" below. A static build
  (`client/dist`) can be hosted anywhere.
- `shared/` — types + pure chess helpers (no Node/browser-specific APIs).
- `core/` (was `server/`) — the analysis pipeline: engine wrapper (pluggable UCI transport), scheduler, search cache,
  facts, labels, explanations, GameManager. Environment-neutral TypeScript: runs in the browser's analysis worker and
  in Node (tests, `core/scripts/*`, `bench/*`; `core/src/node.ts` sets up the Node environment). Node-only files:
  `src/node.ts`, `src/engine/node.ts`, `src/cache.ts` (sqlite, scripts/benchmarks only).
- `client/` — Vue 3 + Vite + Tailwind 4 + TypeScript, `chessground` (board), `chessops` (rules/SAN/FEN/PGN);
  `client/src/worker/` hosts `core` in a Web Worker.
- Chess logic library everywhere: **`chessops`** (Lichess, GPL-3). Do not add chess.js.
- Tests: **Vitest** (unit/integration), **Playwright** (e2e). Benchmarks are scripts under `bench/`.
- Engine: **Stockfish.js 19** (npm `stockfish` 19.0.1, by Nathan Rugg / Chess.com, GPL-3.0 — compatible with this
  repo's GPL-3.0-or-later): Stockfish 19 with its full NNUE network compiled to WebAssembly. Browser: the files are
  served from `node_modules/stockfish/bin` at `/engine/` (Vite plugin in `client/vite.config.ts`; copied to
  `dist/engine/` with the licence). Node: the same build run by `node` as a child process; env `STOCKFISH_PATH` may
  point at a native binary instead (≈ 2.3× faster per thread, identical search at 1 thread).
- **TypeScript 6.0.x** (not 7.x): TS 7 is the native Go port without the JS compiler API, and `vue-tsc` cannot
  run on it. One TS version for the whole repo (root devDependency). No build step: `noEmit`, `moduleResolution:
  bundler`, extensionless relative imports; `tsx` runs the server, Vite/Vitest transform TS directly.
- **`@chess-coach/shared`** is consumed as TS source: its `package.json` `exports` map `.` → `src/index.ts` and
  `./*` → `src/*.ts`. Import `from '@chess-coach/shared'` (or `'@chess-coach/shared/winchance'`) in server, client
  and tests alike. Do not add Node/browser APIs to shared.
- **`@chess-coach/core`** likewise: `exports` `./*` → `src/*.ts` (`'@chess-coach/core/games'`, …).
- Root `npm test` runs Vitest projects `shared`, `core`, `client` (root `vitest.config.ts`); `npm run typecheck`
  runs `tsc` (shared, core) and `vue-tsc` (client, which also checks the core modules the worker imports).

## Layout

```
chess-coach/
  SPEC.md  ARCHITECTURE.md  PLAN.md  README.md  BACKLOG.md
  package.json            # workspaces: shared, core, client; root scripts: start, dev, test, e2e, build, bench:*
  data/                   # gitignored: sqlite cache of the Node scripts/benchmarks, downloaded benchmark data
  shared/src/
    types.ts              # API + analysis types (below)
    settings.ts           # default thresholds/settings (below)
    winchance.ts          # cp/mate -> win%, move accuracy, game accuracy (Lichess formulas)
  core/src/               # environment-neutral analysis pipeline (browser worker + Node)
    engine/uci.ts         # Engine: UCI wrapper over a pluggable transport (UciSpawn)
    engine/node.ts        # Node transport (child process: Stockfish WASM via node, or STOCKFISH_PATH); Node-only
    engine/pool.ts        # N engines started together (Node scripts)
    engine/scheduler.ts   # priority queue in front of the engines: one job per engine, preemption, addEngine
    chess/                # pure position helpers on chessops: material (PIECE_VALUES, positionFromFen, lineMaterial),
                          # see.ts (static exchange), attacks, notation.ts (UCI normalisation, SAN of PVs, FEN after moves)
    facts/immediate.ts    # Immediate facts: (posBefore, move) -> Fact[]
    facts/positional.ts   # positional features + deltas
    facts/line.ts         # Short-term narration of a PV, forcedness, null-move threat
    facts/longterm.ts     # Long-term level: filtered positional deltas, positional-gain, deep-payoff, necessary
    analysis/classify.ts  # label rules incl. material rule, Miss, Great, Forced, Book
    analysis/book.ts      # opening book lookup (Lichess chess-openings TSV, vendored in core/data/openings/; source registered)
    analysis/searchCache.ts  # memoised engine searches (memory + CacheStore), keyed by position + search params
    analysis/suggest.ts   # explainable pick
    analysis/explain.ts   # Fact -> text templates (the ONLY place that produces prose)
    analysis/analyzeMove.ts  # orchestrates engine calls for one (fenBefore, move) -> MoveAnalysis
    games.ts              # PGN import -> Game; per-game queue state; summary (GameManager, async store)
    store.ts              # CacheStore interface + MemoryStore
    hash.ts               # pure-JS sha1 (game ids, cache keys)
    profiles.ts           # analysis profiles (default / fast)
    cache.ts              # node:sqlite CacheStore (Node scripts/benchmarks only)
    node.ts               # Node environment: engine transport + book from disk (tests' setup file, scripts, bench)
  core/test/              # vitest; engine tests run Stockfish WASM in Node (STOCKFISH_PATH: native)
  core/scripts/engine-timing.ts  # `npm run bench:engine`: times the analysis budget searches
  core/scripts/analyze-pgn.ts    # full pipeline on a PGN -> markdown report (+ JSON)
  core/scripts/profile-game.ts   # cold-cache timing of a whole game per search type + focus / side-line latency (Node)
  client/src/worker/      # in-browser analysis: analysis.worker.ts, stockfish.ts, idbStore.ts, protocol.ts, config.ts
  client/src/api/         # ApiClient: local.ts (worker), mock.ts (?mock=1), chesscom.ts (direct chess.com API)
  client/scripts/browser-profile.ts  # `npm run bench:browser`: in-browser timing with Playwright Chromium
  scripts/start.mjs       # `npm start`: build if stale, `vite preview` on 5174 (COOP/COEP), open the browser
  bench/games/            # sample PGNs (Opera game, Kasparov–Topalov 1999, Deep Blue–Kasparov g6, 60 Lichess games)
  client/e2e/             # playwright (e2e/acceptance = beginner walk-through vs a running `npm start`, `npm run acceptance`)
  bench/                  # puzzle + annotated-games benchmarks, reports written to bench/reports/*.md
```

## Conventions

- Squares/moves in UCI internally (`e2e4`, `e7e8q`, castling as king-to-square `e1g1`). SAN only for display.
- **Score POV:** `Score` from UCI is side-to-move POV. In `MoveAnalysis` every eval exposed for display is
  **White POV** (`evalBefore`, `evalAfter`, candidate `score`), while win%/winLoss are **mover POV**. Name
  fields accordingly; never mix silently.
  **UI (M2-client):** every *signed* eval number on screen (eval row "Eval (White)", eval bar, graph, candidate
  "eval +1.2") is White POV, with a tooltip explaining the sign; mover-POV quantities are always labelled with the
  side ("Black's win chance 38% → 22%", "You're still winning (eval for Black: M9 → +6.7)"). The eval row also
  says it in words ("White is winning", "Black mates in 2", "draw by stalemate").
- Piece values for material: P=1, N=3, B=3, R=5, Q=9, K=0.
- All prose comes from `explain.ts`. Facts carry data only (`type` + fields). Text is attached as `text` when
  rendered.
- Settings are passed explicitly (no globals) so the cache key can include a settings hash.
- `ANALYSIS_VERSION` constant in `shared/src/settings.ts`; bump it when output semantics change (invalidates cache).

## Engine (`core/src/engine/uci.ts`; transports: see "In-browser analysis")

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

**M4: several engines + preemption** (`engine/pool.ts`, `scheduler.ts`; the single-engine API above still works):
- `createEnginePool({ threads, processes, hashMb })` starts `processes` Stockfish processes with `threads / processes`
  threads each (server env `ENGINE_PROCESSES`, default threads / 2; `ENGINE_THREADS` is the total, default cpus − 2 =
  10, so **5 × 2**; `ENGINE_HASH_MB` per process, default 256; see "Performance (M4)").
  `new Scheduler(engines[], { preempt })`: one job per engine, so several plies
  are analysed at once. Jobs share searches through `SearchCache` (an identical search already running for another
  job is awaited, not repeated — e.g. ply N's `deepAfter` is ply N+1's `deep`).
- `Engine.abort()`: stops the running search (`stop`) and rejects every search requested before the call with
  `SearchAbortedError` (not an `EngineError`, never retried as one; partial results are never cached). Later
  searches run normally.
- Preemption (default on): when a job is queued, every engine is busy and a running job has a strictly lower
  priority, the lowest-priority running job (most recently started among equals) is preempted — its engine is
  aborted and handed to the new job immediately; the old job's engine handle is a revoked lease (its further searches
  reject with `SearchAbortedError`). If it then fails with that error it is re-queued with its old priority and FIFO
  position; if it finishes anyway its result is used. A re-run is cheap: all its finished searches are cached, only
  the interrupted one is repeated. A `SearchCache` waiter whose shared search was aborted runs it on its own engine.
  A running job that is bumped (dedupe / `bump`) gets the higher priority and is no longer preemptable by it.
  Effect: a side-line move or a focused ply never waits behind background jobs.
- `/api/test/kill-engine` kills every engine process.

## Analysis budget (defaults in settings, tune with measurements)

Per analysed move `(fenBefore, move)`:
1. **Deep** search at `fenBefore`, MultiPV 5, depth **14** (was 16 in M4, 18 before; on a 57-ply game d14 took 17.9 s vs 33.9 s and differed from d16 on 5–6 labels, while two d16 runs differed on 7 — within run-to-run noise; the M4 tables below were measured at d16) → candidates, best line, 2nd best (Great).
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

**As built in M2** (`analysis/analyzeMove.ts`; every search goes through `SearchCache`, so a position/params pair
is searched once — across plies, games and side lines, and across restarts via sqlite):
1. deep at `fenBefore` (MultiPV 5) — + `searchmoves=[played]` at deep depth only if the played move isn't in it;
2. deep at `fenAfter` (MultiPV 5) → `evalAfter`. This *is* the next ply's deep search, so a game costs
   ≈ plies + 1 deep searches (the last ply's `fenAfter`; none after mate/stalemate);
3. shallow at `fenBefore` (+ shallow `searchmoves` for candidates outside its top 5);
4. threat (null move) after each candidate and the played move, plus once at `fenBefore` (the opponent's threat;
   each candidate is checked with a threat-depth `searchmoves=[threat move]` search → `defends-threat`);
5. forcedness at the opponent replies of the narrated lines of the played move, the best move and the pick;
6. without a supplied previous result: deep (+searchmoves) at `prev.fenBefore` — the previous ply's own searches.

**Time caps** (`SearchBudget.maxMs`, M2 addition): Stockfish can take minutes for a fixed depth in sharp positions
with mates around (Opera game, measured: d12 MultiPV 2 = 68 s, d18 MultiPV 1 > 120 s, d18 MultiPV 5 = 20 s), so
every search is `go depth D movetime maxMs` (whichever first): deep 5000 ms, shallow / threat / forcedness 500 ms.
Measured per ply (cold cache, Threads 10): 4–7 s, ≈ 5.5 s on average (the capped deep search dominates).

### Performance (M4)

`npx tsx core/scripts/profile-game.ts <pgn> [--threads N] [--processes N] [--depth N] [--no-preempt] --probe`:
cold cache (temp sqlite, fresh engines), the GameManager pipeline; probes = at 15 s focus the ply at 2/3 of the game,
then a side-line move from the next position and a reply to it. Game: Lichess YMOxEowk (84 plies, sharp). Ryzen 5
3600; another agent's Stockfish (≤ 4 threads) ran part of the time, so absolute numbers carry ±15 % noise; configs were
run in palindrome order (A B C C B A) to cancel drift.

| config | wall (84 plies) | first label | 10 plies | focused ply | side line / reply |
|---|---|---|---|---|---|
| before: d18, 1 × 10 threads, no preemption | 429–492 s | 3.1–4.6 s | 45–61 s | 14.6–18.8 s | 4.5–6.1 s / 6.5–10.8 s |
| d16, 1 × 10, no preemption | 331–400 s | 2.0–2.8 s | 31–37 s | 12.8–17.1 s | 1.3–6.3 s / 1.3–5.0 s |
| d16, 2 × 5, preemption | 232–264 s | 2.1 s | 20–26 s | 4.7–9.9 s | 1.3–2.3 s / 1.6–2.8 s |
| d16, 3 × 3 | 127–140 s | 1.5–2.0 s | 10 s | 5.6–9.1 s | 1.5–2.1 s / 1.7–2.8 s |
| **d16, 5 × 2 (default)** | **68–74 s** | **1.8–2.1 s** | **6–8 s** | **3.8–9.1 s** | **1.2–1.9 s / 1.9–2.5 s** |
| d16, 10 × 1 | 29–31 s | 1.9 s | 5 s | 2.0–7.1 s | 1.9–2.0 s / 2.4–2.8 s |

Default on two more games: Kasparov–Topalov 1999 (87 plies) 80 s, Lichess EtpbYGOw (64 plies) 48 s; focused ply
3.2 / 7.9 s, side line 4.1 / 5.4 s.

**Why many small processes win:** at a fixed depth, Stockfish's extra (Lazy SMP) threads widen the search rather than
finish it sooner — the same deep d16 MultiPV-5 search took 1.8 s on 1 thread, 2.2 s on 2, 2.3–2.7 s on 3 and
2.8–3.4 s on 10 threads under the same load (M3: median 0.8 M nodes on 1 thread vs 3.5 M on 4). So N processes with
fewer threads give ≈ N× throughput. 1-thread searches are a little less accurate (M3: `d16-1t` vs the d22 reference
6.8 % severity changes, vs 5.6 % at 4 threads); 2 threads measured as good as the old default (below), so 5 × 2.

**Where the time goes** (default, YMOxEowk, engine time): deep MultiPV-5 searches 85 % (87 searches, ≈ 2.2 s each;
6 stopped by the 5 s cap), deep `searchmoves` for a played move outside the top 5 5 %, threat + threat-`searchmoves`
5 % (≈ 5.6 per ply, ≈ 30 ms each), forcedness 4 % (≈ 1.3 per ply, ≈ 100 ms), shallow < 1 %, board facts/explanations
(JS) ≈ 20 ms per ply. The small searches were left as they are: together ≤ 10 % of engine time, and reusing other
searches for them (e.g. answering forcedness from the deeper `deepAfter` result) would change explanation inputs
depending on job timing. Book plies keep the full deep search (their evals feed the graph and the next ply's label;
opening positions are fast anyway). Hash 256 MB per process (a d16 search visits a few million nodes).

**Quality check** (`npx tsx bench/label-benchmark.ts run --depth 16 --threads 2 --parallel 5` on M3's 10 stability
games, twice: `m4-d16-5x2`, `m4-d16-5x2-b`; compare with `npx tsx bench/label-compare.ts`): severity class (ok / ?! /
? or Miss / ??) differs from the old default `d18base` on 6.1 % / 5.7 % of 757 plies, where two independent old-default
runs differ on 4.9 % and two new-default runs on 4.4 %; against the d22 reference (339 plies) 4.4 % / 5.9 % (old
default 5.9 %); agreement with Lichess' judgements 88.5 % / 88.2 % (old default 89.0 % / 88.0 %). I.e. within
run-to-run noise.

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
  | 'forced' | 'book' | 'brilliant' | 'best' | 'great' | 'excellent' | 'good'
  | 'inaccuracy' | 'mistake' | 'miss' | 'blunder';
export interface Score { cp?: number; mate?: number }   // exactly one set; mate>0 = side to move mates

export type PieceRole = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';
export interface PieceRef { role: PieceRole; square: string; color: Color }

// Facts: discriminated union. Data only; `explain.ts` renders text.
export type Fact =
  | { type: 'check'; double?: boolean; discovered?: boolean }
  | { type: 'checkmate'; double?: boolean; discovered?: boolean }
  | { type: 'stalemate' }                                            // the move stalemates the opponent (draw)
  | { type: 'capture'; captured: PieceRef; outcome: 'wins-material' | 'even-trade' | 'recapture' | 'loses-material'; net: number; desperado?: boolean }  // desperado (M5b): the capturing piece was en prise with no safe square anyway
  | { type: 'promotion'; to: PieceRole }
  | { type: 'castle'; side: 'king' | 'queen' }
  | { type: 'develop'; piece: PieceRef }
  | { type: 'attack'; attacker: PieceRef; target: PieceRef; reason: 'undefended' | 'higher-value' | 'king' | 'outnumbered'; offered?: boolean }  // outnumbered (M5b): the move adds the attacker that makes the piece winnable; offered (M5b): the target could take the attacker (kept only when the engine line doesn't)
  | { type: 'fork'; attacker: PieceRef; targets: PieceRef[]; followUp?: { reply: string; capture: string; kingMustMove?: boolean } }  // followUp (M5b): a checking fork shown by the engine line — the reply (SAN), then the forking piece's capture (SAN); kingMustMove: every legal reply is a king move
  | { type: 'pin'; pinner: PieceRef; pinned: PieceRef; behind: PieceRef; absolute: boolean }
  | { type: 'skewer'; attacker: PieceRef; front: PieceRef; behind: PieceRef }
  | { type: 'discovered-attack'; moved: PieceRef; attacker: PieceRef; target: PieceRef }
  | { type: 'escape'; piece: PieceRef; from: string }               // piece was en prise, now safe
  | { type: 'defend'; defender: PieceRef; piece: PieceRef }          // newly defends an attacked piece
  | { type: 'block-check' } | { type: 'escape-check' }
  | { type: 'hangs'; piece: PieceRef; loss: number; already?: boolean }  // negative: leaves material en prise; already = was en prise before the move and still is
  | { type: 'allows-mate'; inMoves: number; line?: string[] }        // negative; line (M5b): the mating sequence from the opponent's reply (SAN, ends in checkmate on the board)
  | { type: 'misses-mate'; mateIn: number; best: string; line: string[] }  // negative (M5b): the mover had a forced mate (the best move's line, SAN from the best move, ends in checkmate) and the move doesn't mate
  | { type: 'misses'; san: string; uci: string; facts: Fact[]; partial?: boolean; free?: PieceRef; alsoStops?: string }       // free / alsoStops (B1): the move wins this piece for free / also stops this threat (SAN). M5b, bad moves whose Immediate level says nothing else: the engine's best move and its verified facts this move doesn't share (empty facts = no reason in words was found)
  | { type: 'castling-lost'; color: Color; sides: ('king' | 'queen')[]; at?: 'line-end' }  // M5b: `color` loses its last castling rights (king or rook moved; at 'line-end': its king was driven out during the short line)
  | { type: 'attack-pinned'; attacker: PieceRef; pinned: PieceRef; pinner: PieceRef; behind: PieceRef; absolute: boolean }  // M5b: the move adds an attacker to an enemy piece that was already pinned, and the piece can now be won
  | { type: 'trapped'; piece: PieceRef; attacker: PieceRef }       // M5b: an enemy piece is attacked, can be won, and every square it can move to loses it too (confirmed by the engine line winning it)
  | { type: 'prevents'; move: string; san: string; square: string; reason: 'occupied' | 'blocked' | 'covered'; by?: PieceRef }  // M5b prophylaxis: the opponent's best idea (null-move search: what they'd play if the mover passed, worth >= 1.5 pawns more than their best reply now) is no longer playable (square occupied / line blocked) or now loses material on `square` (covered by `by`)
  | { type: 'threat'; move: string; san: string; gain: number; mateIn?: number; facts: Fact[] }
  | { type: 'defends-threat'; move: string; san: string; gain: number; mateIn?: number; facts: Fact[] }  // the opponent's threat (as in 'threat', opponent POV) no longer works after the move
  | { type: 'line'; steps: LineStep[]; materialDelta: number; mateIn?: number; result: 'wins-material' | 'loses-material' | 'mate' | 'mated' | 'trade' | 'quiet' | 'unclear'; won?: PieceRole[]; lost?: PieceRole[]; measuredAt?: number; balance?: number; owed?: number; nextForcing?: string; recapture?: string }  // recapture (M5b): SAN of the PV's next move, a recapture already counted in the material result; nextForcing (M5b): SAN of the PV moves right after the narrated steps up to the first check or capture within 3 plies; won/lost: net pieces gained/lost by the mover; measuredAt: material measured after this many plies (> steps.length); 'unclear' = material still changing where the line ends (no result is claimed); balance: mover's material balance (points) at the line end (material results only); owed: material the opponent's previous move captured, which the line may be winning back
  | { type: 'allows'; reply: { san: string; uci: string }; facts: Fact[]; targets?: PieceRef[]; gain?: number; mateIn?: number; already?: boolean; mateLine?: string[]; keepsThreat?: boolean }  // keepsThreat (M5b): the reply's threat is the opponent's threat from before the move, playable right after it ("Doesn't deal with …"). mateLine (M5b): SAN from the reply to the checkmate, verified on the board. negative (bad moves): the opponent's best reply from the move's PV and what it does — its board facts / verified threat, mover pieces it newly puts en prise, material the opponent gains in the line (pawns), mate against the mover; already: the reply worked before the move too (the move just doesn't deal with it)
  | { type: 'forced-reply'; san: string; alternatives: number }      // opponent's reply was (nearly) the only move
  | { type: 'positional'; feature: PositionalFeature; delta: number; detail?: string; side?: 'own' | 'opponent'; squares?: string[]; at?: 'line-end' }  // delta: + = good for mover; side: whose pieces changed; at: 'line-end' = change measured at the end of the short line, not right after the move
  | { type: 'positional-gain'; cp: number }                          // eval gain not explained by material
  | { type: 'deep-payoff' }                                          // only deep search likes it
  | { type: 'necessary'; onlyMove?: boolean }                        // all alternatives much worse (onlyMove: the only legal move)
  | { type: 'nothing-notable' };

export type PositionalFeature =
  | 'king-safety' | 'passed-pawn' | 'isolated-pawn' | 'doubled-pawn' | 'mobility'
  | 'centre-control' | 'development' | 'open-file-rook' | 'bishop-pair' | 'space';

export interface LineStep { ply: number; san: string; uci: string; color: Color; facts: Fact[]; forced?: boolean }

export interface Level { facts: Fact[]; text: string[]; tones?: Tone[]; story?: StoryPart[] }  // text[i] renders facts (not necessarily 1:1); tones / story: UI round, below
export interface Explanation { immediate: Level; short: Level; long: Level }

export interface Candidate {
  uci: string; san: string;
  rank: number;                       // 1-based engine rank (deep); 0 = the played move when it isn't among the deep lines
  score: Score;                       // White POV
  winLoss: number;                    // mover POV, vs best
  pv: string[];                       // SAN
  pvUci: string[];
  explainable: boolean;
  notExplainableReasons?: string[];   // machine-readable codes, 'too-much-loss','material-rule','hangs-material','loses-result','shallow-disagrees','no-concrete-fact'
  explanation?: Explanation;          // present for played move, pick and best
}

export interface LostPiece extends PieceRef { ply: number }     // M3
export interface MaterialCheck { playedLine: number; bestLine: number; loss: number; evalDropCp: number; label?: Label; hung?: PieceRef; hungLoss?: number; hungAlready?: boolean; lostInLine?: LostPiece[] }
export interface AllowedMate { matedIn: number; bestMatedIn?: number }   // M3
export interface MissedMate { mateIn: number }                          // M3
export interface MissedMaterial { gain: number; piece: PieceRef; free?: boolean }   // B1
export interface BrilliantSacrifice { sacrifice: number; piece: PieceRef }        // B2

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
  labelReason: { winChance: Label; material?: MaterialCheck; miss?: boolean; great?: { secondBestLoss: number }; book?: { eco: string; name: string }; allowedMate?: AllowedMate; missedMate?: MissedMate; missedMaterial?: MissedMaterial; brilliant?: BrilliantSacrifice };
  played: Candidate;                   // the played move as a candidate, with explanation
  best: Candidate;
  pick: Candidate | null;              // explainable pick; null if none
  pickIsBest: boolean;
  deepOnly: boolean;                   // no explainable candidate -> "deep engine move, hard to explain"
  candidates: Candidate[];             // top-5 summary (explanation may be omitted)
  arrows: Arrow[];
  timings?: Record<string, number>;
  labelText?: string;                  // rendered label + reason (explain.ts), mover-neutral
  verdictText?: string;                // caption for confirmed moves (Book/Forced/Best/Great), e.g. "Opening theory."
  points?: { played: MoveIdea; best?: MoveIdea };  // (Points) what the played move (and the best one, when it wasn't played) does
}
export interface Arrow { from: string; to: string; kind: 'pick' | 'best' | 'threat' | 'played' }
// (Points) analysis/movePoints.ts — see "Points: what a move does"
export interface MovePoint { key: string; text: string; tone: Tone; squares?: string[] }
export interface MoveIdea { uci: string; san: string; points: MovePoint[]; like?: number; plus?: MovePoint[]; minus?: MovePoint[]; plan?: string[] }
export interface TopIdeasResult { fen: string; moves: MoveIdea[] }

export interface GameMove { ply: number; san: string; uci: string; color: Color; fenBefore: string; fenAfter: string }
export interface GameInfo {
  id: string; headers: Record<string, string>; startFen: string; moves: GameMove[];
  you: Color; orientation: Color;
}
export interface SideSummary { accuracy: number | null; counts: Partial<Record<Label, number>> }
export interface GameSummary { white: SideSummary; black: SideSummary; done: number; total: number }

export interface Settings { username: string | null }
```

Additions made in M1b (all optional / additive): `checkmate.double/discovered`, `hangs.already` (piece was en prise
before the move and still is), `positional.side` (`'own' | 'opponent'`: whose structure changed) and
`positional.squares`.

Additions made in M2 (all additive; the client renders `Level.text`, so new fact types need no client change):
- Facts: `stalemate` (the move stalemates the opponent); `defends-threat` (the opponent's verified null-move threat —
  same fields as `threat`, opponent POV — no longer works after the move); `line.won/lost` (net pieces the mover
  gains/loses in the line, equal roles cancelled) and `line.measuredAt` (material measured further along the PV
  than the narrated steps, when the narration was capped mid-exchange); `positional.at: 'line-end'`;
  `necessary.onlyMove`.
- `MoveAnalysis.labelText` — rendered label + reason (explain.ts), e.g. "Blunder ?? — leaves the queen on g5
  hanging (−8). White is still winning (+17.8 → +8.5), but this is the habit to fix."
- `Candidate.rank = 0` for the played move when it isn't among the deep lines; reason code `hangs-material`.
- Evals: `evalBefore` = deep best at fenBefore (White POV); `evalAfter` = deep best at fenAfter (White POV) — the
  same search as the next ply's `evalBefore`, so the eval graph is continuous. After checkmate `evalAfter` is
  `toWhitePov({ mate: 0 }, sideMated)` (i.e. `{cp: 1000}` when White mates, `{mate: 0}` when Black mates — detect
  mate on the board for display); stalemate `{cp: 0}`. `winLoss`/label come from the fenBefore search only.
- `SearchBudget.maxMs` (settings): per-search time cap, see "Analysis budget".

Additions made in the explanation-quality pass (M5 prep; additive):
- Fact `allows` (the refutation of a bad move, see `facts/line.ts refutationFact`) and `line.result: 'unclear'`;
  `line.measuredAt` is no longer emitted (material is only claimed where the narrated line ends).
- `MoveAnalysis.verdictText` — caption for confirmed moves: Book "Opening theory.", Forced "The only legal move.",
  Best "This was the best move." / "As good as the engine's top move.", Great "Great find — the only good move
  here." (replaces the old "Good — this was the move."; the client should show it instead of its hard-coded text).
- Settings: `explain.shortLineMinPlies` 4 → 2 (a story stops at its payoff; see below).
- Analysis budget: one extra threat search (budget.threat) per bad played move, at the null-move position after
  the opponent's PV reply (for the `allows` fact); forcedness searches only run for replies under pressure.

Additions made in Session B (labels; additive, `ANALYSIS_VERSION` 9):
- `labelReason.missedMaterial?: MissedMaterial` = `{ gain, piece, free? }`: the best move captures `piece` with a
  static exchange >= `settings.miss.freeMaterialMinGain` (3), its line keeps >= 3 points more than both the
  material baseline and the played line (quiet point, as the material rule), and the eval drops >= 200 cp → at
  least **Miss**, whatever the win% (7.O-O at +10 instead of 7.Nxh4 winning the queen). `free`: the capture loses
  nothing back. The played move's 'misses' fact then carries `free` and `alsoStops`.
- Label `brilliant` (`!!`, ranked above Great) with `labelReason.brilliant?: BrilliantSacrifice` = `{ sacrifice,
  piece }`: a best or near-best (≤ `brilliant.maxWinLoss` 2 win%) move whose line ends ≥ `brilliant.minSacrifice`
  (2) points down vs the baseline and vs the alternative move's line, with a non-pawn piece en prise right after the
  move, and win% after ≥ `brilliant.minWinAfter` (50). Not when the alternative also keeps ≥
  `brilliant.maxWinOther` (90) win%, take-backs, check evasions with ≤ 3 moves, the continuation of a combination.
  `verdictText` "Brilliant — a sound sacrifice.". Settings: new `brilliant: BrilliantRule`.

Additions made in M3 (label quality; all additive, `ANALYSIS_VERSION` 2):
- `labelReason.allowedMate?: AllowedMate` = `{ matedIn, bestMatedIn? }`: the played move allows a forced mate in
  `matedIn` ≤ `settings.mate.allowedMaxMoves` (3) moves that the best move avoids (or only allows `bestMatedIn` ≥
  matedIn + `allowedMuchLongerBy` (3) moves later) → label at least Blunder, even when win% was already ~0 (the
  clamp makes −10 and "mated" equal). `labelReason.missedMate?: MissedMate` = `{ mateIn }`: the best move mated in
  ≤ `settings.mate.missedMaxMoves` (3) and the played move doesn't force mate → at least Miss (a Blunder stays).
  Neither applies to the engine's #1 move, a checkmating move or a single legal move. `labelReason.miss` keeps its
  meaning (the "punish the opponent's mistake" rule only).
- (Feedback round 3) `labelReason.missedChance?: true`: `missedChanceMiss` (classify.ts) turned a win-chance Blunder
  into a Miss — the best move was a concrete chance (missed mate / free material / a tactic on the board) and the
  played move throws nothing away itself (no material-rule label, no piece ≥ 2 left en prise, no allowed mate).
- `MaterialCheck.hung` now names only a piece that is en prise **right after the move** (on its square, untouched by
  the line until captured, opponent SEE > 0) and `MaterialCheck.hungLoss` is its static-exchange loss (the same number
  as the Immediate `hangs` fact; `loss` stays the line-based comparison); `MaterialCheck.lostInLine?: LostPiece[]` (`PieceRef & { ply }`, ply 1 =
  the move, 2 = the reply, …) lists the mover's pieces lost in losing exchanges of the line, first lost first (when
  `hung` is absent the loss happens in the follow-up; labelText names a hanging piece only from the verified
  Immediate `hangs` fact, see the M5 pass below).
- `labelText` (explain.ts, minimal M3 change): "Blunder ?? — this allows a forced mate in 2. Black was already losing,
  but Qxd7 would have avoided it — watch for mating threats." / "Miss — Qh5 was a forced mate in 2, and this move
  doesn't force mate (−3% winning chances)."
- Great exclusions (classify.ts `isGreat`; settings `great.maxLegalMovesInCheck` (3), `great.freeCaptureMinGain`
  (1)): besides take-backs, no Great for a check evasion with ≤ 3 legal moves, a capture whose SEE alone wins ≥ 1,
  or the move right after an opponent move that was their only legal move (continuation of a combination).
  Settings change: `great.maxWinAfterBest` 97 → 70 (with `throwsAwayWinBelow` 70): when already winning, Great only
  if the 2nd best throws the win away.
- `analysis/label.ts`: `labelMove(settings, search, input)` = searches 1/1b/6 + `classifyMove` (moved out of
  analyzeMove, which calls it first); the label benchmark (`bench/label-benchmark.ts`) calls the same function.
  Optional search 7 (`settings.budget.verify`, **off by default**, `margin` 0): when winLoss is within `margin` win% of
  a label bound, re-search `[best, played]` (or `[best, 2nd]` for Great) with MultiPV 2 at deep depth + 2 and label from
  that. Measured: it barely reduces run-to-run flips (see bench/reports/labels.md), so it stays off.
- Material rule (M3 fixes): the baseline after an opponent capture is raised only by what the exchange on that
  square can win back (`materialBaseline`); when the best move is already ≤ −`material.lostPositionCp` (900) or mated,
  only a piece the move itself leaves hanging fires the rule (`hung` and not `hungAlready`). New settings
  `material.lostPositionCp`, `mate.*`, `great.maxLegalMovesInCheck`, `great.freeCaptureMinGain`, `budget.verify`.
- Label benchmark: `npx tsx bench/label-benchmark.ts run|report` → bench/reports/labels.md (+ labels-details.md);
  hand verdicts in bench/labels.eyeball.json, hand-written analysis in bench/labels.analysis.md.

Additions made in M5b (explanation quality round 2; all additive — the client renders `Level.text`):
- Facts (exact rules in the file headers of `facts/immediate.ts` / `facts/line.ts`): `castling-lost` (the mover's
  last castling right goes — king or rook move — while the opponent has ≥ 9 non-pawn material; `at: 'line-end'` in
  the Long-term level when a king is driven out during the short line, e.g. Bxf7+ Kxf7), `attack-pinned` (a piece
  pinned before the move gets a new attacker and can now be won), `trapped` (attacked, winnable, every move of it
  loses it too; kept only when the engine line wins it — Immediate via `analyzeMove.moverWins`, story steps likewise),
  `capture.desperado` (the capturing piece was en prise with no safe square), `fork.followUp` (a checking fork the
  engine line carries out — `line.pvFork`; also for steps and when the board-only fork test can't confirm it),
  `prevents` (prophylaxis: the opponent's null-move best move, worth ≥ 150 cp over their best reply now, becomes
  impossible or loses material on its square; not in decided positions), `misses-mate` (missed-mate rule: the best
  line's moves, verified to end in checkmate), `allows.mateLine` / `allows-mate.line` (an allowed mate ≤ 3 told with
  its moves: "Allows a forced mate in 2: Qb8+ Nxb8 Rd8#."), `misses` (a bad move whose Immediate level says nothing
  else: the best move + the verified facts behind `betterReasonFacts`, told as its one biggest reason; no facts →
  just "X was better." / "X was much better." (round 10: no "hard to put into words" filler)).
- `betterReasons` also gives quiet reasons when no tactical one exists: develops, castles, prevents, traps, attacks a
  pinned piece, and the best move's own long-term facts (passed pawn, rook on an open file, king safety, …).
- `allows`: the reply's own threat is kept only when it mates or the line carries it out; `allows.keepsThreat` = that
  threat is the opponent's pre-move threat and playable right after the move ("Doesn't deal with White's threat
  Rxa7, winning a pawn"); the best move's refutation (for the "same refutation" drop) is built with its own reply threat.
- `refutationFact` input `bestLineDelta`: a quiet reply whose line costs ≥ 2 points more than the best line is named
  ("After c4, the engine line costs White 3 points of material (see the short term).").
- Story: a piece offered and won back (or mating) reads "Qe8 sacrifices the queen"; a quiet last step after hidden
  steps is dropped ("… → White wins a pawn"); `NarrationOptions.minPlies`: for a bad move, when only one of the
  played / best lines reaches a material result at its own length, the other is told on to that length (kept only
  if it then reaches a result too).
- `line.nextForcing` (SAN of the PV moves after the narrated steps up to the first check or capture, within 3 plies): a story without
  facts then reads "Re3 → Rgh2 → Kf7; the engine line then goes on with Rh7+." instead of "No forcing follow-up.".
- `attack.offered` (the target could take the attacker: quiet moves only, dropped when the PV reply takes it),
  `attack.reason: 'outnumbered'` (the move adds the attacker that makes a non-pawn piece winnable), `line.recapture`
  (the PV's next move, a recapture the material result already counts, shown before the result).
- Review-loop rules (rounds 5–10, details in bench/reports/explanation-review.md): threat gains by SEE (forks: the
  second target's net), refutations need a material / mate / threat / target payoff, pins the reply ignores and
  escapes the reply attacks again are dropped, story tactics (forks, discovered attacks, traps) only when the line
  converts them, pieces cancel trade-first then by role then by value, a story runs on to settled material (later
  material that fits the deep eval better or holds to the PV end), long-term pawn / rook facts must survive the line.
- `suggest.concreteFacts`: `trapped`, `prevents`, and `attack-pinned` when the line wins that piece.
- Analysis budget: unchanged (the prophylaxis fact reuses the existing opponent null-move search at fenBefore).

Additions made in M5c (explanation quality round 3; all additive optional fields, `ANALYSIS_VERSION` 4 — the client
renders `Level.text`, so no client change is needed):
- Suggestions: rule 3's shallow test is waived when the candidate's own short line shows the payoff
  (`suggest.storyPaysOff`: mate, material won beyond what the opponent's last move took, a perpetual check by the
  mover) — `deepOnly` ("deep engine move — hard to explain") never sits over a story that explains the move.
  `explain.contrastWithPlayed`: the pick's / best move's Immediate sentences that equal the played move's are folded
  into one "Like Ba4, it also stops …" sentence after its own ones; shared Long-term sentences end "— as after Ba4."
  (`Level.facts` unchanged).
- Stories (`line.narrationPlies`): a stop point whose material is far off the deep eval (> 2 pawns) or whose claimed
  change goes against it ("Black wins a pawn" at eval −0.5) runs on to a later stop point within
  `PAYOFF_HORIZON_PLIES` (20) that fits the eval a pawn better and changes material decisively (a piece, or the claim
  turned around). A bad move's story also accepts such a later point when it ends level (a pawn lost and regained).
- `fork.byLine`: a pawn fork the board test can't confirm (the pawn may be taken) — kept in the Immediate level only
  when the PV wins material within 6 plies, in story steps when the forking side comes out ahead from there, in a
  refutation when the line costs the mover material ("Pawn fork: …, and the engine line wins material after it").
- `attack.through`: a battery — the moved slider lines up behind its own slider, which attacks an enemy piece that
  can now be won by the exchange (and couldn't before): "Lines up behind the rook on d8: together they attack …".
- `line.draw` / `line.drawBy` (`line.repetitionInLine`): the PV repeats a position within 16 plies and the deep
  score is |cp| ≤ 10 → the story ends there with "White keeps giving check: a draw by perpetual check" (every move
  of `drawBy` in the cycle is a check) or "the position repeats: a draw by repetition". A perpetual by the mover is a
  concrete fact for picks and a better-move reason ("forces a draw by perpetual check"); `allows.perpetual` for one
  by the opponent.
- Refutations: `allows.threatParried` — the reply's verified threat is not played because the mover pays right away
  (its answer and the next opponent move lose ≥ 1 point) and the threat is worth more than the line's cost: "Allows
  Nd4: then Black threatens Nxc6, winning a queen (+9 points for Black) — in the engine line White avoids that but
  loses 3 points." `allows.follow` — for a quiet reply whose line costs material, the opponent's first forcing move
  of the line: "After O-O, Black goes on with Nf3+: in the engine line this costs White 2 points (see the short term)."
- Better-move reasons (`betterReasonFacts` → `BetterReason.magnitude`): ranked by verified size — mate > material
  won (by its count) > threats / defences (a defence counts only what the played move actually loses) > quiet
  reasons; the two biggest are told (a capture by the move first). `misses.partial` / `LabelTextInput.betterPartial`
  (`reasonsArePartial`): the told reasons are worth less than half of the eval drop (≥ 2 pawns), or a Mistake /
  Blunder / Miss has only quiet reasons → "— but the engine sees more than this".

Additions made in the UI round (tones; all additive optional fields, `ANALYSIS_VERSION` 5):
- `Level.tones?: Tone[]` (`Tone = 'good' | 'bad' | 'neutral'`), parallel to `Level.text`: whether each sentence helps
  or hurts **the mover**. The base mapping is `factTone(fact, mover)` in `shared/src/tones.ts` (pure data, also used by
  the client's mock fixtures): bad = hangs, allows, allows-mate, misses-mate, misses, a capture that loses material
  (not a desperado), the mover's own `castling-lost`, a positional change against the mover; good = checkmate, a
  winning capture / recapture, promotion, castling, development, attacks and tactics (fork, pin, skewer, discovered
  attack, trapped, attack-pinned), threat, defends-threat, defend, escape, prevents, the opponent's castling-lost, a
  positional change for the mover, positional-gain; neutral = everything else (check, even trades, check evasions,
  deep-payoff, necessary, nothing-notable). A `line` fact's tone comes from its result (`lineTone`: mate /
  wins-material good, mated / loses-material bad, trade / quiet / unclear / a draw neutral). explain.ts overrides the
  base tone where a sentence words the fact otherwise (a hang told as a sound sacrifice = good, a book gambit pawn or
  a capture whose gain the line gives back = neutral, a merged "takes …, but allows …" = bad, the honest hedge "the
  engine sees more than this" = bad). For Inaccuracy / Mistake / Blunder / Miss the Immediate sentences are ordered
  bad → neutral → good (stable) **before** the 4-sentence cap.
- `Level.story?: StoryPart[]` (Short-term level of a narrated line only): `text[0]` split at its ` → ` arrows,
  `{ text, tone, plies?: [from, to] }` per part (`plies` = indexes into the line fact's `steps`; absent for `…`, the
  counted recapture and the result). A step that does something is good for its side (the mover's tactic / capture
  = good, the opponent's = bad), a plain move, a trade unit or a blocked check is neutral, the opponent's forced
  reply is good; the result part has the line's tone. Invariant: `parts.map(p => p.text).join(' → ') + '.' === text[0]`.
- Balance wording (`balanceAfter`): when a line's material change wipes out (or turns around) a side's lead, both ends
  are named — "White gives a knight for two pawns (−1 point); White was a pawn up before, so material is now level"
  (was "…(−1 point); material is level", which read as a contradiction). Fork steps of one role read "forks both
  knights"; same-role targets are grouped ("White's knights on c3 and e3").
- Client: layouts `?ui=classic|a|b|c` (see "Client layouts" below).

## Facts → text, suggestions (M2)

- `facts/line.ts`: narration = the story of the move up to its payoff: the first quiet point (no piece of either
  side can be won by SEE, not check) after ≥ `shortLineMinPlies` plies whose next ply isn't forcing, else the first
  "settled" capture (the side to move can't win anything back), within `material.quietHorizonPlies`; for a played
  move flagged by the material rule it runs on until that loss is shown. Material is claimed only there (a pending
  recapture at a PV end is resolved with SEE, otherwise `result: 'unclear'`). Step facts (no negative facts);
  forced replies only for replies under pressure (check, an attacked piece, a mate-in-1 threat) with a MultiPV-2
  gap ≥ `forcedReplyMinGap` (so the opponent's punishing move is never "forced"); null-move threat: mate in ≤ 3 or
  a material gain ≥ 1 whose first move is itself a winning capture or a fork/skewer/discovered attack; `allows`:
  the opponent's PV reply with its board facts, the mover's pieces it newly puts en prise (two or more = a double
  attack, one only if the line wins it), its own verified null-move threat, the line's material/mate result.
- `facts/longterm.ts`: at most 2 facts; positional deltas of the move with noise filters, line-end changes only
  when big (passed pawn, king shelter destroyed, bishop pair lost, a doubled+isolated pawn), `positional-gain`
  only for moves that give material up, `deep-payoff`, `necessary`, `nothing-notable`. Exact rules in the file
  headers.
- `analysis/suggest.ts`: SPEC rules + `hangs-material` (no new hanging piece / losing capture / allowed mate unless
  the candidate's own short line wins material or mates). Concrete facts: check, checkmate, winning capture or
  recapture, promotion, fork, pin, skewer, discovered attack, escape, `defends-threat`, threat with gain/mate,
  line that wins material or mates, an attack whose target the line wins, a double attack.
- `analysis/explain.ts`: templates, mover-neutral with colour names, material in points ("+3 points"), short
  hints for jargon; for Inaccuracy/Mistake/Blunder/Miss the `allows` sentence leads the Immediate level ("Allows
  Qb3, attacking Black's pawns on b7 and f7 at once."; a reply that takes a hung piece is merged with the hang);
  level dedupe (check implied by a fork/skewer of the king, attacks covered by tactics, attacks merged per
  attacker, escape dropped when capturing); a hang / losing capture whose short line wins material or mates is
  worded as a sacrifice; ≤ 4 sentences per level; short line ≤ 6 shown steps (uneventful middle steps → "…"),
  no result claim for quiet/unclear lines, Book lines without a forcing move → "No forcing follow-up."; long ≤ 2
  sentences; `labelText` (for bad moves with a comparison from the best move's own facts: "Qf6 was much better.
  Qf6 defends the pawn on f7."); `verdictText`; `SUGGESTION_TEXT.deepOnly`.
- `analyzeMove` drops a move's threat (and, for captures, its new attacks) when the engine's expected reply simply
  takes the moved piece. Board claims are checked against the move's PV (first 6 plies): a `hangs` piece must be
  captured there (else dropped; `already` when it could be won just as well before the move), `defends-threat` of a
  material threat is dropped when the PV plays the threat anyway, a null-move threat that already existed before the
  move or whose target can capture the threatening piece is dropped. The played move's `allows` is dropped when the
  best move allows the same reply with the same effect, and marked `already` when it equals the opponent's pre-move
  threat and hits nothing new. `ExplainContext` carries `label` and `uci` (uncovered pins are credited to the pinner).

## Board facts (M1b: `core/src/chess/*`, `core/src/facts/*`; pure, no engine)

- `chess/material.ts` (M2: the single home of `PIECE_VALUES` and `positionFromFen`; attacks.ts no longer exports them).
- `chess/attacks.ts`: `toPieceRef`, `attackersOf(board, sq, color, {occupied?, xray?})`,
  `defendersOf`, `attackedPieces`, `attacksFrom`, `lineBehind`, `pinsAgainst(board, color, {relative?})`,
  `absolutelyPinned`, `legalMobility`, `legalMoveCount`, `withTurn`.
- `chess/see.ts` (pawn units): `see(pos, sq, by = turn)` ≥ 0 (best exchange `by` can start on `sq`; legal captures only
  — pins, check, king captures; promotion +8; en passant), `seeCaptureWith(pos, from, sq)` (forced first capturer),
  `seeMove(pos, uci)` (net material of a move incl. the opponent's best exchange on the destination), `isHanging`,
  `hangingLoss`, `capturedBy`.
- `facts/immediate.ts`: `immediateFacts(fenBefore, uci, {prev?: {fenBefore, uci}}): Fact[]` sorted by the exported
  `FACT_IMPORTANCE`; exact definitions in the file header. Pass `prev` (the opponent's last move) to get
  `capture.outcome = 'recapture'`. Also `immediateFactsFromPosition`, `hasMateInOne`, `sortFacts`.
- `facts/positional.ts`: `positionalFeatures(fen | pos)` per colour; `positionalDelta(fenBefore, fenAfter, mover)` →
  `positional` facts (thresholds in `POSITIONAL_THRESHOLDS`); works for any two positions (e.g. before the move vs
  end of the short line).
- `facts/cause.ts` (Why round, feedback round 3): why a bad move is bad when no tactic explains it, read from the
  move's own engine line — `loosensFact` (a piece it leaves loose that the line goes after; not when the attacker
  arrives by capturing a piece), `tradesDownFact` (a trade into a lost / drawn ending), `chasedFact` (the moved piece
  is hit by cheaper pieces and steps away again: 3.Qf3 Bg4 Qg3 Bd6 Qh4; a king is no chaser), `passerFact` (an
  opponent passed pawn reaches the 7th within `PASSER_PLIES`, which the best line doesn't allow), `undevelopedFact`
  (an opening move that develops nothing while ≥ 2 minors are at home and better moves develop one), and
  `fineAlternatives`. analyzeMove picks trades-down → a loosened piece the line wins → passer → chased → loosens →
  undeveloped (Inaccuracy / Mistake only).
- Benchmark: `npx tsx bench/puzzle-facts.ts [--theme fork] [--n 500] [--report]` → `bench/reports/puzzle-facts.md`.

## In-browser analysis (C1: no server)

```
page (Vue app)
  api/local.ts  LocalApiClient  ── postMessage ──►  worker/analysis.worker.ts (module worker)
  (same ApiClient interface)                          GameManager + Scheduler(preempt) + SearchCache
  chess.com: direct fetch                             IdbStore (IndexedDB 'chess-coach') · opening book (fetched TSVs)
                                                      └─ N × Stockfish WASM worker (worker/stockfish.ts), 1 job each
```

- **Engine transport** (`core/src/engine/uci.ts`): `Engine` speaks UCI through a `UciSpawn` (`write(line)`, `kill()`,
  handlers `onLine` / `onExit` / `onStderr`). Browser: `workerSpawn(url)` — the stockfish.js file *is* the worker
  (UCI strings in and out via postMessage; it loads the `.wasm` with the same name; `quit` terminates the worker).
  Node: `engine/node.ts` (child process). `Engine.killInstance()` simulates a crash (test hook); the next search
  starts a new instance.
- **Engines** (`worker/config.ts`): default `min(cores − 2, 6, ⌊0.75 × navigator.deviceMemory⌋)` instances of the
  **single-threaded full-network build** (`stockfish-19-single.js`; works without cross-origin isolation), Hash 32 MB
  each. URL overrides: `engines`, `threads` (per instance; > 1 only when `crossOriginIsolated`, uses the
  multi-threaded `stockfish-19.js`), `hash`, `engine=lite` (`stockfish-19-lite-single.js`, 2 MB network),
  `profile=fast`, `testhooks=1`; `VITE_ANALYSIS_DEFAULTS` bakes defaults into a dev server/build (E2E). The first
  instance starts alone (fills the HTTP/code cache), its scheduler slot is a stand-in whose searches wait for it, so
  games open and jobs queue at once; the others start in parallel afterwards and join with `Scheduler.addEngine`.
- **Cross-origin isolation:** Vite dev and preview send `COOP: same-origin`, `COEP: require-corp`, `CORP:
  same-origin`. Needed only for `threads > 1` (SharedArrayBuffer). chess.com's API sends `Access-Control-Allow-Origin:
  *`, so it works from the isolated page (verified in Chromium); requests use only CORS-safelisted headers.
- **Worker protocol** (`worker/protocol.ts`, replaces the HTTP API + SSE one to one): requests `{ id, type, payload }`
  → `{ kind: 'response', id, ok, value | error: { message, status } }` (status mirrors the old HTTP codes: 400 bad
  PGN / input, 404 unknown game, 500 other). Types: `init(AnalysisConfig)`, `health`, `createGame {pgn}`, `getGame
  {id}`, `focus {id, ply}`, `analyse {fenBefore, uci, prev?}`, `subscribe {id, sub}` / `unsubscribe {sub}` (events
  `{ kind: 'event', sub, event: GameEvent }`: replay of the finished state after subscribing, then live — an
  analysis can arrive twice), test hooks `killEngines`, `failNext {n}`, `stats`. `LocalApiClient.mode` is `'real'`
  so localStorage keys (recent games, sides, chess.com name) are unchanged.
- **Cache:** `IdbStore` implements `CacheStore` with the same tables and keys as the sqlite cache (values stored as
  structured clones). Per browser profile and origin. Persisting is best-effort (a failed write doesn't fail the
  analysis); without IndexedDB a `MemoryStore` is used.
- **Book:** `core/data/openings/*.tsv` are imported with `?url` (hashed static assets) and fetched + parsed in the
  worker at startup (`loadBookAsync`).

### Fast, then final (D1)

Every ply first gets a quick, provisional analysis (`core/src/analysis/quick.ts`: `labelMove` with `QUICK_BUDGET` d10 MultiPV 2,
no verification, plus the position after the move at the same budget for evalAfter / `nextBest`; `provisional: true`,
no explanations, not persisted), queued at the scheduler's `QUICK` priority (SIDELINE 0 > FOCUS 1 > QUICK 2 >
BACKGROUND 3) ahead of the full jobs; `focus` bumps it too. Side lines: `analyseQuick` (protocol + `ApiClient`) next to
`analyse`. The client shows the provisional label at once ("Working out why…" until the full analysis arrives),
counts only full analyses as done, and never lets a provisional result replace a full one or clear a ply's error.
Sticky labels (`stickyLabel` in analyzeMove.ts): the full job gets the shown label (`provisionalLabel`, not part of the
cache key) and keeps it when the full label is a win-chance neighbour within `STICKY_MARGIN` (3 %) of the threshold
between them, or a quick Best within `BEST_STICKY_LOSS` (1 %) of the top move. Measured (YMOxEowk, 84 plies, 6 × 1,
cold): first label 0.6 s (was 2.7 s), 10 plies 1.4 s (7.7 s), every ply labelled 2.2 s; the full analyses still take
≈ 50 s. On shiniimini–mistermine102 about 4 of 30 labels change when the full analysis arrives (real differences:
Good → Miss, Best → Excellent beyond 1 %).

### "Show best move" arrows (engine arrows)

With the toggle on (B / the arrow button; off by default, remembered), the board draws the engine's good moves in the
position on the board. `GameManager.topMoves({ fen })` (protocol `topMoves`, `ApiClient.topMoves?`) answers from the
analysis's own deep search of the position (`analysis/topMoves.ts` `topParams` = `deepParams`, so an analysed position
is a cache hit; else one search at SIDELINE priority). `pickTopMoves` keeps the best `TOP_MIN` (3) whatever they lose,
then every move within `labels.excellentMaxLoss` of the best, at most `TOP_MAX` (5). Each `TopMove` carries its score
(White POV), `winLoss` against the best (side to move POV) and `gap` = max(winLoss, cp loss / `GAP_CP_PER_PCT` 30):
win% barely moves when a side is far ahead or lost, the centipawns still punish a move only the best one avoids
(feedback round 4). The session asks after a short dwell (`focusDebounceMs`) and caches by FEN; nothing is drawn until
the answer arrives, so drawn arrows never change. `client/src/lib/topArrows.ts`: gold, brightness and width (12 → 3)
by `exp(-gap / 2.5)` (brushes `top0` … `top9`), the best drawn last; with several arrows a rank label (chessground
`label`) at each arrowhead keeps arrows along the same line readable. Without `topMoves` (older API) or when it fails:
the analyses' own `nextTop` / candidates (up to 3, faded by rank).

### Points: what a move does (`analysis/movePoints.ts`)

Short checked points instead of a forced sentence ("Develops the knight", "Opens the diagonal for the bishop on c1",
"Keeps the bishop off g4"), and a coach's comparison: a move with the same idea as a better one is told only by how
it differs ("same idea as Nf3, but ✗ doesn't attack the pawn on e5"), so a list of good moves doesn't repeat itself.

- A `Point` is a verb (base form) + the rest, a tone for the mover, a weight and a `key` naming what it is about
  (`develop`, `attack:e5`, `defends:c7c4`, …): the same key on two moves is the same point. `said` / `denied` word it
  ("Develops the knight" / "Doesn't develop the knight"; lacking a drawback is good). Shared output: `MovePoint`,
  `MoveIdea`, `TopIdeasResult` (types.ts).
- Sources, all checked: the immediate facts verified with the move's engine line exactly as analyzeMove does
  (`verifyWithLine`, `pruneRefuted`, `addLineFork`, the threat / defends / prevents rules); the line's material
  result, told only when it differs by a pawn from the median of the moves compared (`baseline`) and still holds 14
  plies on (`laterMaterial`; a gambit pawn won back is no point), naming the capture that wins it and what comes back
  ("Sets up …Nxe4, winning a pawn", "Gives up a rook for a bishop"); and board rules (file header): centre, challenges, a bishop opened / blocked (squares ahead only),
  a piece in front of the unmoved d/e-pawn (c-pawn in queen's-pawn structures), prepares castling, prepares the line's
  next move (illegal or losing before, safe after — g3 → Bg2), a square taken from an enemy minor / queen, activity /
  centralisation, rooks on open files / connected, passed pawns, pawn structure and the bishop pair. One point per
  key (heaviest wins); defending / saving the piece a threat hits is that threat's key; an attack on the piece the
  move's own threat (or later capture) takes is that point; a capture that also escapes is told as the capture. With
  the previous move known (`prev`: analyzeMove's, the "Moves here" request's), a capture on its square is taking back.
- `compareIdeas`: move `a` has the same idea as an earlier (better) move `b` when they move the same kind of piece
  (pawn / minor / rook / queen / king), `b` makes `a`'s main point too, and `b` makes ≥ `SAME_IDEA_SHARE` (½) of
  `a`'s good points by weight or it is the very same piece; or `a`'s main point is a purpose `b` has too (stops the
  same threat, wins the same piece). Then `like` = index of `b`, `plus` = `a`'s own good points `b` lacks + `b`'s drawbacks it avoids,
  `minus` = its drawbacks + `b`'s good points (weight ≥ 14, not a specific follow-up) it lacks, at most 2 each. A move
  with at most one point gets `plan`: its next two moves in the line.
- Top moves ("Moves here"): `GameManager.topIdeas({ fen })` (protocol `topIdeas`, `ApiClient.topIdeas?`, SIDELINE)
  reuses the top-moves search and adds the null-move searches (budget.threat: the opponent's threat now, each move's
  own threat, "does the threat still work" per move). The session asks for it once the arrows' `topMoves` answer is
  in (the arrows never wait). `TopIdeas.vue` (layout A, under the verdict, its own scroll area while the toggle is
  on): one row per arrow, same number and colour (`topLabelFill`), points or "same idea as Nf3" + differences, or
  the plan; hovering highlights the move's squares.
- The played move: `MoveAnalysis.points` (`analyzeMove`, from the facts and searches it already has: no new search)
  = the played move's `MoveIdea` and, when it wasn't best, the best move's, the played one compared with it. Layout
  A's verdict (`lib/verdict.ts` `verdictPoints`): a good move shows its points instead of the sentence (they say the
  same, `sentenceWithPoints`; Great / Brilliant keep their own plain reason); the same idea as the best move →
  "Same idea as Nf3, the best move:" + the differences (a bad move only when one is a ✗ — "a little less precise"
  would contradict its label); another idea → a good move's points, a bad move's sentence alone (its points would
  repeat it), and "Best was Nf3:" + 2 of its ✓ points.
- Eyeball reports: `bench/move-points.ts` (top moves of real positions; 439 moves of 10 Lichess games: 59 % get a good
  point of their own, 18 % are told as the same idea as a better move, 22 % only a plan) and `bench/verdict-points.ts`
  (the verdict card per played move).

### Performance (browser)

`npm run bench:browser -- <pgn> --url <dev or preview server> --query "<params>" [--probe]` (Playwright Chromium,
fresh profile = cold IndexedDB and HTTP cache, i.e. includes loading the 100 MB engine from localhost). Game:
Lichess YMOxEowk (84 plies), default analysis settings (deep d14 MultiPV 5), Ryzen 5 3600 (12 threads, 16 GB) shared
with other agents' engines and E2E runs (CPU ≈ 60 % busy before starting), so ±20 % noise:

| config | first label | 10 plies | 84 plies | focused ply (at 15 s) |
|---|---|---|---|---|
| browser 2 × 1 thread | 1.8 s | 13.9 s | 132 s | – |
| browser 4 × 1 thread | 2.1 s | 14.6 s | 78 s | 8.1 s |
| **browser 6 × 1 thread (default here)** | 2.7 s | 7.7 s | **48.6 s** | 7.5 s |
| browser 3 × 2 threads (multi-threaded build) | 2.1 s | 9.8 s | 104 s | – |
| browser 6 × 1, `engine=lite` | 1.3 s | 4.4 s | 31.9 s | – |
| Node, native Stockfish 5 × 2 threads (old server default), same conditions | 1.0 s | 4.0 s | 37.5 s | 6.0 s |

Kasparov–Topalov 1999 (87 plies), browser 6 × 1: 44.4 s, first label 2.7 s. So the browser is ≈ 1.3× the native
server on this machine at the same depth (the M4 table's 68–74 s was measured at d16). Single-threaded WASM is ≈ 2.3×
slower than native per thread (same node counts), but 1-thread instances use the cores best (as in M4: threads widen
the search at a fixed depth) — 3 × 2 threads took twice as long as 6 × 1. Memory: ≈ 0.4 GB per full-network instance
(6 instances ≈ 2.4 GB of browser memory); hence the cap and the deviceMemory rule. The lite network is ≈ 1/3 faster
and loads 2 MB instead of 100 MB but is weaker (its label agreement was not benchmarked), so it is opt-in.

## HTTP API (historical: removed in C1)

The server is gone; the worker protocol above replaces these routes one to one (same semantics, errors and replay rules). Kept for reference:


| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/games` | `{ pgn }` | `GameInfo` (enqueues all plies, background priority). 400 `{error}` on bad PGN |
| GET | `/api/games/:id` | — | `{ game: GameInfo, analyses: Record<ply, MoveAnalysis>, summary: GameSummary }` |
| GET | `/api/games/:id/stream` | — | SSE: `event: analysis` data `{ ply, analysis }`; `event: progress` `{ done, total }`; `event: summary` `GameSummary`; `event: error` `{ ply, message }`. On connect, replays already-finished analyses. |
| POST | `/api/games/:id/focus` | `{ ply }` | 204; bumps that ply (and ply+1, then ply−1 — M4) to FOCUS priority |
| POST | `/api/analyse` | `{ fenBefore, uci, prev?: { fenBefore, uci } }` | `MoveAnalysis` (SIDELINE priority; `prev` enables Miss detection) |
| GET/PUT | `/api/settings` | `Settings` | `Settings` (persisted in sqlite). **No longer used by the client** (no username setting): the client decides "You" itself (see below); the server's `GameInfo.you` is only its first guess |
| GET | `/api/chesscom/:username/games?limit=30` | — | `ChessComGames` `{ username, games: ChessComGame[] }`, newest first (`core/src/chesscom.ts`: chess.com public API, newest monthly archives first, at most 6 archives, `rules: 'chess'` only, limit ≤ 100). 400 bad name/limit, 404 unknown player, 502 chess.com unreachable / rate-limited |
| GET | `/api/health` | — | `{ ok: true, engine: 'Stockfish 19' }`; 503 `{ ok: false, engine: null, error }` if the engine isn't running |

`ply` is 1-based index into `moves` (ply 1 = the game's first move — Black's for a SetUp/FEN game with Black to
move; use `GameMove.color` / the FEN for move numbers, never `ply` parity).

M2 details: `POST /api/games` returns the same id for a re-imported game (only `GameInfo`; finished analyses come
from `GET /api/games/:id` or the stream replay);
GameInfo `you`/`orientation` follow the *current* username setting (a first guess only — the client keeps its own:
"You" = the side at the bottom of the board, flipping switches it and is remembered per game in localStorage
(`client/src/lib/sides.ts`); a game opens on the remembered side, else the side whose player name is the chess.com
name last looked up on the Open screen (localStorage), else `GameInfo.you`). SSE: subscribe-then-replay (an analysis can
arrive twice — idempotent), `progress` + `summary` after every finished ply, heartbeat comment `: ping` every
15 s, cleanup on disconnect; the stream stays open after the game is done. `focus` → 204, 404 unknown game, 400
bad ply. `/api/analyse` → 400 for an illegal move / bad FEN / a `prev` that doesn't lead to `fenBefore`, 503
without engine. Errors are `{ error }` JSON. Main-line ply N uses ply N−1 as `prev` (and its finished result for
Miss / book chain when available); side lines pass `prev` in the body.

M2-client additions (client wired to the real server end to end):
- `focus` also **re-queues a failed ply** (one that got an `event: error`, e.g. after two engine crashes in a row)
  at FOCUS priority; the client shows the error with a "Try again" button that calls `focus` (it never re-focuses a
  failed ply automatically). A failed side-line `/api/analyse` (500 `{error}`) is retried by posting it again.
- Bad-PGN messages (400) are meant for the user: e.g. `illegal or unreadable move "Ke3" at ply 3`, `no moves found
  — paste the whole PGN …`; the dialog prefixes "Could not read this PGN:".
- Client data layer (`client/src/api`): `ApiClient.health()` (never throws; drives an "Engine offline" chip and the
  error hint), `StreamHandlers.onOpen` (EventSource `open` → clears "Connection lost" after a reconnect).
- URL: the open game is `?game=<id>` (history.replaceState); a reload or a shared URL reopens it from the cache. No
  `game` parameter = the Open screen (`client/src/lib/route.ts`, see "Client layouts").
- (C1) Server env is gone. The browser equivalents are the URL parameters in "In-browser analysis" (`profile=fast` =
  the old `ANALYSIS_PROFILE=fast`: deep d10/1 s, shallow d6, threat / forcedness d8, 300 ms caps — own settings hash),
  test hooks `?testhooks=1` → `window.__chessCoachTest.killEngines()` / `.failNext(n)` (each ply is attempted twice).
  Node scripts: `STOCKFISH_PATH`, `CHESS_COACH_DB`, `ANALYSIS_PROFILE`. Vite: `CLIENT_PORT` (dev, 5173), `PORT` (preview, 5174).
- E2E (`npm run e2e`): Playwright projects `mock` (`e2e/*.spec.ts`, `?mock=1`, port 5283) and `real`
  (`e2e/real/*.spec.ts`: the in-browser analysis on a dev server on 5293 with `VITE_ANALYSIS_DEFAULTS=profile=fast&engines=2&testhooks=1`;
  one browser context per file, so IndexedDB carries over between its tests; chess.com blocked). `E2E_REAL=0` runs only
  the mock project; `E2E_MOCK_PORT` / `E2E_REAL_PORT` change the ports. Screenshots of real data: `client/e2e/screenshots/real-<size>-*.png`.

### Phone layout

Phones (`(max-width: 767px)`, `client/src/lib/phone.ts` `isPhone`) showing a game get `layouts/MobileLayout.vue` instead
of layout A, under a slimmer header (40px, "+" for Open). One screen, no page scrolling (`#app` is `100dvh` on phones,
so Safari's toolbars don't hide anything): `PlayersCompact` (both players in one row), the board as wide as the screen
with a slim `EvalBar` beside it (no number; the board shrinks only to keep the explanation >= 130px), the explanation
filling the rest and scrolling by itself (`VerdictCard compact`: label, move name, sentence and points in one block, no
mover / eval line; `TopIdeas`; the move list), swiped left / right for the next / previous move, and `MobileToolbar`
(all controls in one row) at the bottom. `VerdictCard` is shared with layout A. Tested in `e2e/mobile.spec.ts`
(390x664 and 320x568). Chosen from four prototypes (move strip, bottom sheet, tabs, side buttons) on 2026-11-11.

## Client layouts (UI round: prototypes)

`?ui=classic|a|b|c` (`client/src/lib/uiMode.ts`; default `classic`, a switch in the header keeps the URL in sync).
`App.vue` = header + dialogs + one layout from `client/src/layouts/`; every layout uses the same session store —
only presentation differs. Shared presentation pieces:
- `BoardView` (chessground + arrows + promotion + previews) with `BoardBadge`: an absolutely positioned overlay over
  chessground's `cg-container` (ResizeObserver; position from square + orientation) showing the viewed move's label
  glyph at the top-right corner of its destination square (main line and side lines), a spinner while it is analysed,
  "!" when it failed, or a ✓ / ✗ marker given by `Preview.marker` (replays). `Preview` (session) also got optional
  `arrows` (brushes `pick|best|threat|played|good|bad|neutral`).
- `lib/tones.ts` (`levelLines`, `storyParts` — `Level.story`, else the sentence split at its arrows), `lib/verdict.ts`
  (`moveVerdict`: label name + the first bad sentence of a bad move / good sentence of a good one, else the label
  reason; `keyPoints`; `betterMove` = pick, else engine's top; `candidatePoints`), `lib/useMove.ts` (the viewed move,
  eval change, rule note, preview / play a candidate), `lib/replay.ts` (frames of a narrated line → `setPreview`).
  These only pick and join explain.ts sentences — no chess prose on the client.
- Components: `ToneList` (✓ / ✗ / • sentences, hovering a square name highlights it), `StoryChips` (the story as
  coloured chips), `ToneLevels` (three levels: "Right now / Next few moves / Long term"), `SummaryCompact`,
  `GameOverview` (start position; also used by the classic panel), `MoveList badges` (bigger glyphs, tinted errors).

Layouts: `ClassicLayout` (v1 screen, unchanged); `BoardFirstLayout` (A: verdict bubble beside the board, level with
the moved piece's rank, key points, Better, Details); `CoachLayout` (B: coach card, "Show me why" / "Show better move"
replay the line on the board — arrows + markers + caption bar under the board, ←/→/space/Esc while it runs —
consequences as a chip timeline); `GoodBadLayout` (C: label · move · eval chip, "What goes wrong ✗" / "What it does
well ✓" blocks, Better card with Play, labelled move list). E2E: `e2e/prototypes.spec.ts` (mock),
`e2e/real/prototypes-real.spec.ts` (real server).

Board marks, glyphs, Open screen (backlog session A):
- Layout A's board marks (`lib/consequences.ts` → `BoardTags`, square tints and thin arrows in `ChessBoard`) are toned
  for **you** (`session.state.you`: the remembered side, else the chess.com user's side, else the side at the bottom),
  whoever moved: every mark records the side it favours; green = good for you, red = bad for you, blue
  (`--th-neutral`) = neutral — defensive answers (`defend` → "defended", `escape` → "safe now") favour neither side.
  The played move's threat arrow is green when you made the move, red otherwise. Each tag has a `kind` and an icon
  (`TagIcon`: shield = defended, crossed-out shield = undefended, crosshair = attacked, fork, pushpin, padlock …).
  The Label guide (`LabelLegend board`, layout A) explains the colours, says who "you" are, and lists the icons.
- Decision: the ✓ / ✗ explanation sentences (`ToneList`, `StoryChips`, verdicts) stay **for the mover** — they grade
  the move, like its label (an opponent's Blunder still reads "✗ hangs the rook"); only the board is drawn for you.
  The legend says both (`lib/tones.ts` header).
- Label glyphs in round badges (`LabelGlyph`, `BoardBadge`, `ToneList` markers) are SVG (`GlyphIcon`), each symbol's
  ink box centred on the 16×16 grid — font glyphs (✕ ★ ? …) sat off-centre. A label without a shape falls back to its
  text glyph. E2E `e2e/board-marks.spec.ts` measures the drawn pixels.
- Open screen (`OpenScreen`, was the `PgnDialog` modal): its own screen, the landing page when no game is open
  (`?game=` absent). "Open game" / the logo push a history entry without `game`; Back (button, Esc, the browser's
  Back) returns to the loaded game; opening a game replaces the entry with `?game=<id>`; a `?game=` that can't be
  opened lands on the Open screen with the error. E2E `e2e/open-screen.spec.ts`.

## Cache

Key = sha1(`ANALYSIS_VERSION | settingsHash | fenBefore | uci | prevKey | bookChain`) (`games.ts analysisKey`;
prevKey = prev fenBefore + uci, bookChain = 1/0/u). Value = MoveAnalysis. The store is an async `CacheStore`
(`core/src/store.ts`): **IndexedDB in the app** (`client/src/worker/idbStore.ts`, database `chess-coach`),
`MemoryStore` in tests, and for the Node scripts/benchmarks `data/cache.sqlite` via `node:sqlite` (`core/src/cache.ts`;
path override env `CHESS_COACH_DB`). `sha1` is pure JS (`core/src/hash.ts`, same digests as node:crypto). Tables: `analyses`, `searches` (SearchCache: EPD + depth + maxMs + MultiPV + searchmoves →
SearchResult; independent of ANALYSIS_VERSION, so changing facts/explain code re-uses all engine work), `games`
(id = sha1 of start FEN + UCI move list), `settings`. A restart reloads a game by id and re-queues only missing plies.

`npx tsx core/scripts/analyze-pgn.ts game.pgn --out report.md [--json out.json] [--db path] [--fresh]` runs the
same GameManager pipeline without HTTP (`--fresh` ignores cached analyses but keeps cached searches).
