// Data-layer contract used by the UI. Two implementations: RealApiClient (HTTP API from ARCHITECTURE.md) and
// MockApiClient (fixture data + simulated streaming, `?mock=1`).
import type { GameInfo, GameSummary, MoveAnalysis, Settings } from '@chess-coach/shared';

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
  /** Analysis of one ply failed on the server. */
  onPlyError?(ply: number, message: string): void;
  /** Connection-level problem (the real client keeps retrying via EventSource). */
  onConnectionError?(message: string): void;
}

export type Unsubscribe = () => void;

export interface ApiClient {
  readonly mode: 'real' | 'mock';
  createGame(pgn: string): Promise<GameInfo>;
  getGame(id: string): Promise<GameSnapshot>;
  stream(id: string, handlers: StreamHandlers): Unsubscribe;
  focus(id: string, ply: number): Promise<void>;
  analyse(req: AnalyseRequest): Promise<MoveAnalysis>;
  getSettings(): Promise<Settings>;
  putSettings(settings: Settings): Promise<Settings>;
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
