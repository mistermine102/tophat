// In-browser data layer: the ApiClient contract served by the analysis worker (worker/analysis.worker.ts) instead
// of an HTTP server. Requests are postMessage round trips; `stream` is a worker subscription (replay + live events,
// like the old SSE stream). chess.com is called directly (its public API allows cross-origin requests).
import type { GameEvent } from '@chess-coach/core/games';
import type { ChessComGames, GameInfo, MoveAnalysis, TopIdeasResult, TopMovesResult } from '@chess-coach/shared';
import type { AnalysisConfig } from '../worker/config';
import type { FromWorker, RequestType, Requests, ToWorker, WorkerStats } from '../worker/protocol';
import { ChessComError, DEFAULT_LIMIT, fetchChessComGames, validUsername } from './chesscom';
import { ApiError, type AnalyseRequest, type ApiClient, type GameSnapshot, type Health, type StreamHandlers, type Unsubscribe } from './types';

/** The part of a Worker the client uses (tests pass a fake). */
export interface WorkerLike {
  postMessage(message: ToWorker): void;
  addEventListener(type: 'message', listener: (e: MessageEvent<FromWorker>) => void): void;
  addEventListener(type: 'error', listener: (e: ErrorEvent) => void): void;
}

export interface LocalApiOptions {
  fetchImpl?: typeof fetch;
  /** chess.com API base (tests). */
  chessComApi?: string;
}

export class LocalApiClient implements ApiClient {
  // 'real' (not mock): keeps the localStorage keys (recent games, sides, chess.com name) of the server version
  readonly mode = 'real' as const;
  private nextId = 1;
  private nextSub = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private streams = new Map<number, StreamHandlers>();
  private workerError: string | null = null;
  private ready: Promise<void>;

  constructor(
    private readonly worker: WorkerLike,
    config: AnalysisConfig,
    private readonly opts: LocalApiOptions = {},
  ) {
    worker.addEventListener('message', (e) => this.onMessage(e.data));
    worker.addEventListener('error', (e) => {
      this.workerError = e.message || 'the analysis worker failed to load';
      for (const p of this.pending.values()) p.reject(new ApiError(`Analysis worker error: ${this.workerError}`, 500));
      this.pending.clear();
      for (const h of this.streams.values()) h.onConnectionError?.(`Analysis worker error: ${this.workerError}`);
    });
    this.ready = this.call('init', config);
    this.ready.catch(() => undefined);
  }

  private call<K extends RequestType>(type: K, payload: Requests[K]['req']): Promise<Requests[K]['res']> {
    if (this.workerError) return Promise.reject(new ApiError(`Analysis worker error: ${this.workerError}`, 500));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ id, type, payload } as ToWorker);
    });
  }

  private onMessage(m: FromWorker): void {
    if (m.kind === 'event') {
      const h = this.streams.get(m.sub);
      if (h) dispatch(h, m.event);
      return;
    }
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    if (m.ok) p.resolve(m.value);
    else p.reject(new ApiError(m.error.message, m.error.status));
  }

  createGame(pgn: string): Promise<GameInfo> {
    return this.call('createGame', { pgn });
  }

  getGame(id: string): Promise<GameSnapshot> {
    return this.call('getGame', { id });
  }

  stream(id: string, handlers: StreamHandlers): Unsubscribe {
    const sub = this.nextSub++;
    this.streams.set(sub, handlers);
    this.call('subscribe', { id, sub }).then(
      () => handlers.onOpen?.(),
      (e: unknown) => handlers.onConnectionError?.((e as Error).message),
    );
    return () => {
      this.streams.delete(sub);
      void this.call('unsubscribe', { sub }).catch(() => undefined);
    };
  }

  focus(id: string, ply: number): Promise<void> {
    return this.call('focus', { id, ply });
  }

  analyse(req: AnalyseRequest): Promise<MoveAnalysis> {
    return this.call('analyse', req);
  }

  analyseQuick(req: AnalyseRequest): Promise<MoveAnalysis> {
    return this.call('analyseQuick', req);
  }

  topMoves(fen: string, prev: { fenBefore: string; uci: string } | null = null): Promise<TopMovesResult> {
    return this.call('topMoves', { fen, prev });
  }

  topIdeas(fen: string, prev: { fenBefore: string; uci: string } | null = null): Promise<TopIdeasResult> {
    return this.call('topIdeas', { fen, prev });
  }

  async chessComGames(username: string, limit: number = DEFAULT_LIMIT): Promise<ChessComGames> {
    const name = username.trim();
    if (!validUsername(name)) throw new ApiError('a chess.com username has only letters, digits, "_" and "-"', 400);
    if (!Number.isInteger(limit) || limit < 1) throw new ApiError('limit must be a positive integer', 400);
    try {
      return await fetchChessComGames(name, { limit, ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}), ...(this.opts.chessComApi ? { apiBase: this.opts.chessComApi } : {}) });
    } catch (e) {
      if (e instanceof ChessComError) throw new ApiError(e.message, e.status);
      throw new ApiError((e as Error).message, 502);
    }
  }

  async health(): Promise<Health> {
    try {
      return await this.call('health', undefined);
    } catch (e) {
      return { ok: false, engine: null, error: (e as Error).message };
    }
  }

  // --- test hooks (`?testhooks=1`, window.__chessCoachTest) ---------------------------------------------------

  killEngines(): Promise<{ killed: number }> {
    return this.call('killEngines', undefined);
  }

  failNext(n: number): Promise<void> {
    return this.call('failNext', { n });
  }

  stats(): Promise<WorkerStats> {
    return this.call('stats', undefined);
  }
}

function dispatch(h: StreamHandlers, e: GameEvent): void {
  switch (e.type) {
    case 'analysis':
      h.onAnalysis?.(e.ply, e.analysis);
      break;
    case 'progress':
      h.onProgress?.(e.done, e.total);
      break;
    case 'summary':
      h.onSummary?.(e.summary);
      break;
    case 'error':
      h.onPlyError?.(e.ply, e.message);
      break;
  }
}
