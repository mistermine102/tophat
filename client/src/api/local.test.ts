// LocalApiClient against a fake analysis worker (the protocol), no engine.
import type { MoveAnalysis } from '@chess-coach/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AnalysisConfig } from '../worker/config';
import type { FromWorker, ToWorker } from '../worker/protocol';
import { type WorkerLike, LocalApiClient } from './local';
import { ApiError } from './types';

const CONFIG: AnalysisConfig = { flavour: 'full', engines: 1, threads: 1, hashMb: 16, profile: 'fast', testHooks: false };

/** A fake worker: `reply` answers requests; `emit` sends subscription events. */
function fakeWorker(reply: (m: ToWorker) => { ok: true; value?: unknown } | { ok: false; message: string; status: number } | null) {
  const listeners: { message: ((e: MessageEvent<FromWorker>) => void)[]; error: ((e: ErrorEvent) => void)[] } = { message: [], error: [] };
  const sent: ToWorker[] = [];
  const send = (m: FromWorker) => queueMicrotask(() => listeners.message.forEach((l) => l({ data: m } as MessageEvent<FromWorker>)));
  const worker: WorkerLike = {
    postMessage(m: ToWorker) {
      sent.push(m);
      const r = reply(m);
      if (!r) return;
      send(r.ok ? { kind: 'response', id: m.id, ok: true, value: r.value } : { kind: 'response', id: m.id, ok: false, error: { message: r.message, status: r.status } });
    },
    addEventListener(type: 'message' | 'error', l: never) {
      (listeners[type] as unknown[]).push(l);
    },
  };
  return { worker, sent, emit: send, fail: (message: string) => listeners.error.forEach((l) => l({ message } as ErrorEvent)) };
}

describe('LocalApiClient', () => {
  it('sends init first, then request/response round trips; errors become ApiError with the status', async () => {
    const w = fakeWorker((m) => {
      if (m.type === 'createGame') return m.payload.pgn === 'bad' ? { ok: false, message: 'no moves found', status: 400 } : { ok: true, value: { id: 'g1' } };
      return { ok: true };
    });
    const api = new LocalApiClient(w.worker, CONFIG);
    expect(api.mode).toBe('real');
    expect(await api.createGame('1. e4 *')).toEqual({ id: 'g1' });
    await expect(api.createGame('bad')).rejects.toMatchObject({ name: 'ApiError', message: 'no moves found', status: 400 });
    expect(w.sent.map((m) => m.type)).toEqual(['init', 'createGame', 'createGame']);
    expect(w.sent[0]!.payload).toEqual(CONFIG);
  });

  it('stream: subscribe, events to handlers, unsubscribe', async () => {
    const w = fakeWorker(() => ({ ok: true }));
    const api = new LocalApiClient(w.worker, CONFIG);
    const onAnalysis = vi.fn();
    const onProgress = vi.fn();
    const onPlyError = vi.fn();
    const onOpen = vi.fn();
    const stop = api.stream('g1', { onAnalysis, onProgress, onPlyError, onOpen });
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalled());
    const sub = (w.sent.find((m) => m.type === 'subscribe')!.payload as { sub: number }).sub;
    w.emit({ kind: 'event', sub, event: { type: 'analysis', ply: 3, analysis: { san: 'e4' } as MoveAnalysis } });
    w.emit({ kind: 'event', sub, event: { type: 'progress', done: 1, total: 2 } });
    w.emit({ kind: 'event', sub, event: { type: 'error', ply: 2, message: 'boom' } });
    w.emit({ kind: 'event', sub: sub + 1, event: { type: 'progress', done: 9, total: 9 } }); // someone else's
    await vi.waitFor(() => expect(onPlyError).toHaveBeenCalledWith(2, 'boom'));
    expect(onAnalysis).toHaveBeenCalledWith(3, { san: 'e4' });
    expect(onProgress).toHaveBeenCalledTimes(1);
    stop();
    expect(w.sent.at(-1)).toMatchObject({ type: 'unsubscribe', payload: { sub } });
  });

  it('health never throws; a worker failure rejects pending calls', async () => {
    const w = fakeWorker((m) => (m.type === 'health' || m.type === 'init' ? null : { ok: true }));
    const api = new LocalApiClient(w.worker, CONFIG);
    const h = api.health();
    w.fail('out of memory');
    expect(await h).toEqual({ ok: false, engine: null, error: 'Analysis worker error: out of memory' });
    await expect(api.focus('g1', 1)).rejects.toBeInstanceOf(ApiError);
  });

  it('chess.com: direct fetch; bad names are rejected without a request', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/archives')) return Response.json({ archives: [] });
      return Response.json({}, { status: 404 });
    }) as unknown as typeof fetch;
    const api = new LocalApiClient(fakeWorker(() => ({ ok: true })).worker, CONFIG, { fetchImpl });
    expect(await api.chessComGames('SzymonJ', 5)).toEqual({ username: 'SzymonJ', games: [] });
    expect(String((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0])).toBe('https://api.chess.com/pub/player/szymonj/games/archives');
    await expect(api.chessComGames('a b')).rejects.toMatchObject({ status: 400 });
    const notFound = vi.fn(async () => Response.json({}, { status: 404 })) as unknown as typeof fetch;
    await expect(new LocalApiClient(fakeWorker(() => ({ ok: true })).worker, CONFIG, { fetchImpl: notFound }).chessComGames('nobody')).rejects.toMatchObject({ status: 404 });
  });
});
