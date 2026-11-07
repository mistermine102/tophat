// Messages between the page (api/local.ts) and the analysis worker (worker/analysis.worker.ts). They replace the
// old HTTP API + SSE stream one to one: a request gets one response with the same id; a subscription streams
// GameEvents (analysis / progress / summary / error), replaying the finished state first.
import type { GameEvent } from '@chess-coach/core/games';
import type { GameInfo, GameSummary, MoveAnalysis } from '@chess-coach/shared';
import type { AnalyseRequest, Health } from '../api/types';
import type { AnalysisConfig } from './config';

export interface Requests {
  init: { req: AnalysisConfig; res: void };
  health: { req: void; res: Health };
  createGame: { req: { pgn: string }; res: GameInfo };
  getGame: { req: { id: string }; res: { game: GameInfo; analyses: Record<number, MoveAnalysis>; summary: GameSummary } };
  focus: { req: { id: string; ply: number }; res: void };
  analyse: { req: AnalyseRequest; res: MoveAnalysis };
  /** (D1) the quick, provisional analysis of a side-line move */
  analyseQuick: { req: AnalyseRequest; res: MoveAnalysis };
  subscribe: { req: { id: string; sub: number }; res: void };
  unsubscribe: { req: { sub: number }; res: void };
  /** Test hooks (`?testhooks=1`). */
  killEngines: { req: void; res: { killed: number } };
  failNext: { req: { n: number }; res: void };
  stats: { req: void; res: WorkerStats };
}

export interface WorkerStats {
  engine: string | null;
  engines: number;
  threads: number;
  file: string;
  engineMs: number;
  searches: { hits: number; misses: number };
}

export type RequestType = keyof Requests;

export type ToWorker = { [K in RequestType]: { id: number; type: K; payload: Requests[K]['req'] } }[RequestType];

/** `status` mirrors the old HTTP status codes (400 bad input, 404 unknown game, 503 no engine, 500 other). */
export interface WorkerError {
  message: string;
  status: number;
}

export type FromWorker =
  | { kind: 'response'; id: number; ok: true; value: unknown }
  | { kind: 'response'; id: number; ok: false; error: WorkerError }
  | { kind: 'event'; sub: number; event: GameEvent };
