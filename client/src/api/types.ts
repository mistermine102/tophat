// Data-layer contract used by the UI. Two implementations: LocalApiClient (in-browser analysis worker, api/local.ts) and
// MockApiClient (fixture data + simulated streaming, `?mock=1`).
import type { ChessComGames, GameInfo, GameSummary, MoveAnalysis } from '@chess-coach/shared';

export interface GameSnapshot {
  game: GameInfo;
  analyses: Record<number, MoveAnalysis>;
  summary: GameSummary | null;
}

export interface AnalyseRequest {
  fenBefore: string;
  uci: string;
  /** The move before this one (enables Miss detection). */
  prev?: { fenBefore: string; uci: string };
}

export interface StreamHandlers {
  onAnalysis?(ply: number, analysis: MoveAnalysis): void;
  onProgress?(done: number, total: number): void;
  onSummary?(summary: GameSummary): void;
  /** Analysis of one ply failed. */
  onPlyError?(ply: number, message: string): void;
  /** The analysis worker failed or the subscription could not be made. */
  onConnectionError?(message: string): void;
  /** The subscription is open; finished analyses are replayed after this. */
  onOpen?(): void;
}

/** Is the in-browser engine running? */
export interface Health {
  ok: boolean;
  engine: string | null;
  error?: string;
}

export type Unsubscribe = () => void;

export interface ApiClient {
  readonly mode: 'real' | 'mock';
  createGame(pgn: string): Promise<GameInfo>;
  getGame(id: string): Promise<GameSnapshot>;
  stream(id: string, handlers: StreamHandlers): Unsubscribe;
  focus(id: string, ply: number): Promise<void>;
  analyse(req: AnalyseRequest): Promise<MoveAnalysis>;
  /** The newest finished games of a chess.com player (chess.com public API, called from the browser), at most `limit` (default 50). */
  chessComGames(username: string, limit?: number): Promise<ChessComGames>;
  /** Is the analysis engine running? Never throws (a failed engine is `{ ok: false }`). */
  health(): Promise<Health>;
}

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}
