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
    chess/                # pure position helpers on chessops: material (PIECE_VALUES, positionFromFen, lineMaterial),
                          # see.ts (static exchange), attacks, notation.ts (UCI normalisation, SAN of PVs, FEN after moves)
    facts/immediate.ts    # Immediate facts: (posBefore, move) -> Fact[]
    facts/positional.ts   # positional features + deltas
    facts/line.ts         # Short-term narration of a PV, forcedness, null-move threat
    facts/longterm.ts     # Long-term level: filtered positional deltas, positional-gain, deep-payoff, necessary
    analysis/classify.ts  # label rules incl. material rule, Miss, Great, Forced, Book
    analysis/book.ts      # opening book lookup (Lichess chess-openings TSV, vendored in server/data/openings/)
    analysis/searchCache.ts  # memoised engine searches (memory + sqlite), keyed by position + search params
    analysis/suggest.ts   # explainable pick
    analysis/explain.ts   # Fact -> text templates (the ONLY place that produces prose)
    analysis/analyzeMove.ts  # orchestrates engine calls for one (fenBefore, move) -> MoveAnalysis
    games.ts              # PGN import -> Game; per-game queue state; summary
    cache.ts              # node:sqlite cache
    routes.ts             # REST + SSE
  server/test/            # vitest; engine-dependent tests use describe.skipIf(!engineAvailable())
  server/scripts/engine-timing.ts  # `npm run bench:engine -w server`: times the analysis budget searches
  server/scripts/analyze-pgn.ts    # full pipeline on a PGN (no HTTP) -> markdown report (+ JSON)
  bench/games/            # sample PGNs for analyze-pgn (Opera game, Kasparov–Topalov 1999, Deep Blue–Kasparov g6)
  client/src/ ...
  client/e2e/             # playwright
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
  | { type: 'checkmate'; double?: boolean; discovered?: boolean }
  | { type: 'stalemate' }                                            // the move stalemates the opponent (draw)
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
  | { type: 'hangs'; piece: PieceRef; loss: number; already?: boolean }  // negative: leaves material en prise; already = was en prise before the move and still is
  | { type: 'allows-mate'; inMoves: number }                         // negative
  | { type: 'threat'; move: string; san: string; gain: number; mateIn?: number; facts: Fact[] }
  | { type: 'defends-threat'; move: string; san: string; gain: number; mateIn?: number; facts: Fact[] }  // the opponent's threat (as in 'threat', opponent POV) no longer works after the move
  | { type: 'line'; steps: LineStep[]; materialDelta: number; mateIn?: number; result: 'wins-material' | 'loses-material' | 'mate' | 'mated' | 'trade' | 'quiet' | 'unclear'; won?: PieceRole[]; lost?: PieceRole[]; measuredAt?: number; balance?: number; owed?: number }  // won/lost: net pieces gained/lost by the mover; measuredAt: material measured after this many plies (> steps.length); 'unclear' = material still changing where the line ends (no result is claimed); balance: mover's material balance (points) at the line end (material results only); owed: material the opponent's previous move captured, which the line may be winning back
  | { type: 'allows'; reply: { san: string; uci: string }; facts: Fact[]; targets?: PieceRef[]; gain?: number; mateIn?: number; already?: boolean }  // negative (bad moves): the opponent's best reply from the move's PV and what it does — its board facts / verified threat, mover pieces it newly puts en prise, material the opponent gains in the line (pawns), mate against the mover; already: the reply worked before the move too (the move just doesn't deal with it)
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

export interface Level { facts: Fact[]; text: string[] }        // text[i] renders facts (not necessarily 1:1)
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
  labelReason: { winChance: Label; material?: MaterialCheck; miss?: boolean; great?: { secondBestLoss: number }; book?: { eco: string; name: string }; allowedMate?: AllowedMate; missedMate?: MissedMate };
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

Additions made in M3 (label quality; all additive, `ANALYSIS_VERSION` 2):
- `labelReason.allowedMate?: AllowedMate` = `{ matedIn, bestMatedIn? }`: the played move allows a forced mate in
  `matedIn` ≤ `settings.mate.allowedMaxMoves` (3) moves that the best move avoids (or only allows `bestMatedIn` ≥
  matedIn + `allowedMuchLongerBy` (3) moves later) → label at least Blunder, even when win% was already ~0 (the
  clamp makes −10 and "mated" equal). `labelReason.missedMate?: MissedMate` = `{ mateIn }`: the best move mated in
  ≤ `settings.mate.missedMaxMoves` (3) and the played move doesn't force mate → at least Miss (a Blunder stays).
  Neither applies to the engine's #1 move, a checkmating move or a single legal move. `labelReason.miss` keeps its
  meaning (the "punish the opponent's mistake" rule only).
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

## Board facts (M1b: `server/src/chess/*`, `server/src/facts/*`; pure, no engine)

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
- Benchmark: `npx tsx bench/puzzle-facts.ts [--theme fork] [--n 500] [--report]` → `bench/reports/puzzle-facts.md`.

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

`ply` is 1-based index into `moves` (ply 1 = the game's first move — Black's for a SetUp/FEN game with Black to
move; use `GameMove.color` / the FEN for move numbers, never `ply` parity).

M2 details: `POST /api/games` returns the same id for a re-imported game (only `GameInfo`; finished analyses come
from `GET /api/games/:id` or the stream replay);
GameInfo `you`/`orientation` follow the *current* username setting. SSE: subscribe-then-replay (an analysis can
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
- URL: the open game is `?game=<id>` (history.replaceState); a reload or a shared URL reopens it from the cache.
- Server env (`server/src/index.ts`): `PORT`, `CHESS_COACH_DB`, `STOCKFISH_PATH`, `ENGINE_THREADS` (default
  cpus − 2), `ENGINE_HASH_MB` (512), `ANALYSIS_PROFILE` (`default` | `fast`: deep d10/1 s, shallow d6, threat /
  forcedness d8, 300 ms caps — own settings hash, so its cache entries never mix with full-depth ones),
  `LOG_ANALYSIS=1` (per-ply timing + focus bumps on stdout), `CHESS_COACH_TEST_HOOKS=1` (mounts
  `POST /api/test/kill-engine` → kills the Stockfish process; `POST /api/test/fail-next {n}` → the next n analysis
  attempts throw an EngineError; each ply is attempted twice). Vite: `CLIENT_PORT` (5173), `API_PORT` (5174).
- E2E (`npm run e2e`): Playwright projects `mock` (`e2e/*.spec.ts`, `?mock=1`, port 5183) and `real`
  (`e2e/real/*.spec.ts`: own server on 5194 with a fresh temp sqlite, `ANALYSIS_PROFILE=fast`, `ENGINE_THREADS=2`,
  test hooks; client on 5193; skipped without Stockfish). `E2E_REAL=0` runs only the mock project. Screenshots of
  real data: `client/e2e/screenshots/real-<size>-*.png`.

## Cache

Key = sha1(`ANALYSIS_VERSION | settingsHash | fenBefore | uci | prevKey | bookChain`) (`games.ts analysisKey`;
prevKey = prev fenBefore + uci, bookChain = 1/0/u). Value = MoveAnalysis JSON.
`data/cache.sqlite` via `node:sqlite` (`DatabaseSync`; path override env `CHESS_COACH_DB`, `':memory:'` in
tests). Tables (key → JSON): `analyses`, `searches` (SearchCache: EPD + depth + maxMs + MultiPV + searchmoves →
SearchResult; independent of ANALYSIS_VERSION, so changing facts/explain code re-uses all engine work), `games`
(id = sha1 of start FEN + UCI move list), `settings`. A restart reloads a game by id and re-queues only missing plies.

`npx tsx server/scripts/analyze-pgn.ts game.pgn --out report.md [--json out.json] [--db path] [--fresh]` runs the
same GameManager pipeline without HTTP (`--fresh` ignores cached analyses but keeps cached searches).
