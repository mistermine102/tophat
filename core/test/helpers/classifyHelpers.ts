// Test helpers for classification tests.
//  - Unit tests: `cpForWin`, `line`, `mkInput` build synthetic ClassifyInputs.
//  - Engine-backed tests: `analyseMove` runs the real engine the way M2's analyzeMove will (deep MultiPV search at
//    fenBefore + `searchmoves=[played]` if the played move isn't among the lines) and builds a ClassifyInput.

import type { Score } from '@chess-coach/shared';
import { DEFAULT_SETTINGS, type AnalysisSettings } from '@chess-coach/shared';
import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSanAndPlay } from 'chessops/san';
import { parseUci } from 'chessops/util';
import { bookInfo } from '../../src/analysis/book';
import {
  type BookInput,
  type ClassifyInput,
  type ClassifyResult,
  type EngineMoveLine,
  type PrevMoveContext,
  classifyMove,
  countLegalMoves,
  sameMoveUci,
} from '../../src/analysis/classify';
import type { Engine, PvLine } from '../../src/engine/uci';

const K = 0.00368208;

/** Centipawns (mover POV) whose Lichess win% is exactly `win` (0 < win < 100), ignoring the +-1000 clamp. */
export function cpForWin(win: number): number {
  return -Math.log(100 / win - 1) / K;
}

/** Score with the given win% (mover POV). */
export function scoreForWin(win: number): Score {
  return { cp: cpForWin(win) };
}

export function line(uci: string, score: Score, pv: string[] = [uci]): EngineMoveLine {
  return { uci, score, pv };
}

/** Synthetic input with sensible defaults (start position, e2e4 played, 20 legal moves). */
export function mkInput(over: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    legalMoveCount: 20,
    played: line('e2e4', { cp: 30 }),
    playedIsBest: false,
    best: line('d2d4', { cp: 30 }),
    second: null,
    ...over,
  };
}

/** Assert a FEN is a legal standard chess position; returns the normalised FEN. */
export function legalFen(fen: string): string {
  const setup = parseFen(fen).unwrap();
  const pos = Chess.fromSetup(setup).unwrap();
  return makeFen(pos.toSetup());
}

/** Play UCI moves from `fen`; throws on an illegal move. */
export function playUci(fen: string, moves: readonly string[]): string {
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  for (const u of moves) {
    const m = parseUci(u);
    if (!m || !pos.isLegal(m)) throw new Error(`illegal move ${u} in ${makeFen(pos.toSetup())}`);
    pos.play(m);
  }
  return makeFen(pos.toSetup());
}

/** SAN of a UCI PV (for readable assertion messages). */
export function pvSan(fen: string, pv: readonly string[]): string {
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  const out: string[] = [];
  for (const u of pv) {
    const m = parseUci(u);
    if (!m || !pos.isLegal(m)) break;
    out.push(makeSanAndPlay(pos, m));
  }
  return out.join(' ');
}

export interface AnalyseOptions {
  depth?: number;
  multipv?: number;
  prev?: PrevMoveContext | null;
  /** Include book info (bookInfo(fenBefore, fenAfter)); default true. */
  book?: boolean;
  earlierMovesAllBook?: boolean;
  settings?: AnalysisSettings;
}

export interface Analysed {
  input: ClassifyInput;
  result: ClassifyResult;
  lines: PvLine[];
  /** Played move's line came from a separate searchmoves search. */
  searched: boolean;
}

const toLine = (l: PvLine): EngineMoveLine => ({ uci: l.move, score: l.score, pv: l.pv });

/** Deep MultiPV search + searchmoves for the played move -> ClassifyInput -> classifyMove. */
export async function analyseMove(engine: Engine, fenBefore: string, uci: string, opts: AnalyseOptions = {}): Promise<Analysed> {
  const settings = opts.settings ?? DEFAULT_SETTINGS;
  // Scenario premises (forced mates etc.) need a stable search: never go below d18 even if the product default is lower.
  const depth = opts.depth ?? Math.max(settings.budget.deep.depth, 18);
  const multipv = opts.multipv ?? settings.budget.deep.multipv;
  const fen = legalFen(fenBefore);
  const res = await engine.search({ fen, depth, multipv });
  if (res.lines.length === 0) throw new Error(`no legal moves in ${fen}`);
  const lines = res.lines;
  let playedLine = lines.find((l) => sameMoveUci(fen, l.move, uci));
  let searched = false;
  if (!playedLine) {
    const r = await engine.search({ fen, depth, searchmoves: [uci] });
    playedLine = r.lines[0];
    searched = true;
    if (!playedLine) throw new Error(`searchmoves ${uci} returned nothing`);
  }
  const best = lines[0]!;
  let book: BookInput | null = null;
  if (opts.book !== false) {
    const info = bookInfo(fen, playUci(fen, [uci]));
    book = { ...info, ...(opts.earlierMovesAllBook !== undefined ? { earlierMovesAllBook: opts.earlierMovesAllBook } : {}) };
  }
  const input: ClassifyInput = {
    fenBefore: fen,
    legalMoveCount: countLegalMoves(fen),
    played: toLine(playedLine),
    playedIsBest: sameMoveUci(fen, best.move, uci),
    best: toLine(best),
    second: lines[1] ? toLine(lines[1]) : null,
    book,
    prev: opts.prev ?? null,
  };
  return { input, result: classifyMove(input, settings), lines, searched };
}

/** Classify the opponent's previous move and turn it into the PrevMoveContext for the next move. */
export async function prevContext(engine: Engine, prevFen: string, prevUci: string, opts: AnalyseOptions = {}): Promise<{ ctx: PrevMoveContext; analysed: Analysed }> {
  const analysed = await analyseMove(engine, prevFen, prevUci, { ...opts, prev: null });
  const r = analysed.result;
  return {
    ctx: { winLoss: r.winLoss, winBefore: r.winBest, winAfter: r.winPlayed, fenBefore: analysed.input.fenBefore, uci: prevUci },
    analysed,
  };
}

/** Human-readable dump of an analysis (for assertion messages). */
export function describe(a: Analysed): string {
  const f = a.input.fenBefore;
  const ls = a.lines.map((l) => `#${l.multipv} ${JSON.stringify(l.score)} ${pvSan(f, l.pv.slice(0, 8))}`).join('\n  ');
  return `${f}\n  played ${a.input.played.uci} ${JSON.stringify(a.input.played.score)} ${pvSan(f, a.input.played.pv.slice(0, 10))}\n  ${ls}\n  -> ${JSON.stringify(a.result)}`;
}
