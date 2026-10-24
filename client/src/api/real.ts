// Real data layer: the server's HTTP API + SSE stream (ARCHITECTURE.md "HTTP API").
import type { GameInfo, GameSummary, MoveAnalysis, Settings } from '@chess-coach/shared';
import { ApiError, type AnalyseRequest, type ApiClient, type GameSnapshot, type StreamHandlers, type Unsubscribe } from './types';

type FetchLike = typeof fetch;
type EventSourceFactory = (url: string) => EventSource;

export class RealApiClient implements ApiClient {
  readonly mode = 'real' as const;

  constructor(
    private readonly base = '/api',
    private readonly fetchImpl: FetchLike = (...args) => fetch(...args),
    private readonly eventSource: EventSourceFactory = (url) => new EventSource(url),
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.base + path, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new ApiError(`Cannot reach the Chess Coach server (${(e as Error).message}). Is it running?`);
    }
    if (!res.ok) {
      let message = `${method} ${path} failed (${res.status})`;
      try {
        const data = (await res.json()) as { error?: string };
        if (data && typeof data.error === 'string') message = data.error;
      } catch {
        // non-JSON error body: keep the generic message
      }
      throw new ApiError(message, res.status);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  createGame(pgn: string): Promise<GameInfo> {
    return this.request<GameInfo>('POST', '/games', { pgn });
  }

  async getGame(id: string): Promise<GameSnapshot> {
    const data = await this.request<{ game: GameInfo; analyses?: Record<string, MoveAnalysis>; summary?: GameSummary }>(
      'GET',
      `/games/${encodeURIComponent(id)}`,
    );
    const analyses: Record<number, MoveAnalysis> = {};
    for (const [k, v] of Object.entries(data.analyses ?? {})) analyses[Number(k)] = v;
    return { game: data.game, analyses, summary: data.summary ?? null };
  }

  stream(id: string, handlers: StreamHandlers): Unsubscribe {
    const es = this.eventSource(`${this.base}/games/${encodeURIComponent(id)}/stream`);
    const parse = (e: Event): unknown => {
      try {
        return JSON.parse((e as MessageEvent<string>).data);
      } catch {
        return null;
      }
    };
    es.addEventListener('analysis', (e) => {
      const d = parse(e) as { ply: number | string; analysis: MoveAnalysis } | null;
      if (d) handlers.onAnalysis?.(Number(d.ply), d.analysis);
    });
    es.addEventListener('progress', (e) => {
      const d = parse(e) as { done: number; total: number } | null;
      if (d) handlers.onProgress?.(d.done, d.total);
    });
    es.addEventListener('summary', (e) => {
      const d = parse(e) as GameSummary | null;
      if (d) handlers.onSummary?.(d);
    });
    // `event: error` from the server arrives as a MessageEvent with data; a connection failure is a plain Event.
    es.addEventListener('error', (e) => {
      if (e instanceof MessageEvent && typeof e.data === 'string' && e.data) {
        const d = parse(e) as { ply: number | string; message: string } | null;
        if (d) handlers.onPlyError?.(Number(d.ply), d.message);
      } else {
        handlers.onConnectionError?.('Lost connection to the analysis stream — retrying…');
      }
    });
    return () => es.close();
  }

  focus(id: string, ply: number): Promise<void> {
    return this.request<void>('POST', `/games/${encodeURIComponent(id)}/focus`, { ply });
  }

  analyse(req: AnalyseRequest): Promise<MoveAnalysis> {
    return this.request<MoveAnalysis>('POST', '/analyse', req);
  }

  getSettings(): Promise<Settings> {
    return this.request<Settings>('GET', '/settings');
  }

  putSettings(settings: Settings): Promise<Settings> {
    return this.request<Settings>('PUT', '/settings', settings);
  }
}
