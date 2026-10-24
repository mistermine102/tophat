import { describe, expect, it, vi } from 'vitest';
import { fixtureGame } from '../fixtures/game';
import { RealApiClient } from './real';
import { ApiError } from './types';

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

class FakeEventSource extends EventTarget {
  closed = false;
  constructor(readonly url: string) {
    super();
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

describe('RealApiClient', () => {
  const { game, analyses } = fixtureGame();

  it('uses the documented endpoints, methods and bodies', async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const u = String(url);
      if (u === '/api/games' && init?.method === 'POST') return jsonResponse(200, game);
      if (u.endsWith('/focus')) return new Response(null, { status: 204 });
      if (u === '/api/analyse') return jsonResponse(200, analyses[1]);
      if (u === '/api/settings') return jsonResponse(200, { username: 'x' });
      if (u.startsWith('/api/games/')) return jsonResponse(200, { game, analyses: { '1': analyses[1], '2': analyses[2] }, summary: null });
      return jsonResponse(404, { error: 'nope' });
    });
    const api = new RealApiClient('/api', fetchImpl as typeof fetch);

    expect((await api.createGame('1. e4')).id).toBe(game.id);
    const snap = await api.getGame('abc/1');
    expect(Object.keys(snap.analyses).map(Number)).toEqual([1, 2]);
    expect(snap.analyses[2]!.san).toBe('e5');
    await api.focus('g1', 12);
    await api.analyse({ fenBefore: 'f', uci: 'e2e4', prev: { fenBefore: 'p', uci: 'd2d4' } });
    await api.getSettings();
    await api.putSettings({ username: 'me' });

    expect(calls).toEqual([
      { url: '/api/games', method: 'POST', body: { pgn: '1. e4' } },
      { url: '/api/games/abc%2F1', method: 'GET', body: undefined },
      { url: '/api/games/g1/focus', method: 'POST', body: { ply: 12 } },
      { url: '/api/analyse', method: 'POST', body: { fenBefore: 'f', uci: 'e2e4', prev: { fenBefore: 'p', uci: 'd2d4' } } },
      { url: '/api/settings', method: 'GET', body: undefined },
      { url: '/api/settings', method: 'PUT', body: { username: 'me' } },
    ]);
  });

  it('maps a 400 {error} to ApiError with the server message', async () => {
    const api = new RealApiClient('/api', (async () => jsonResponse(400, { error: 'Bad PGN: no moves' })) as typeof fetch);
    await expect(api.createGame('x')).rejects.toMatchObject({ name: 'ApiError', status: 400, message: 'Bad PGN: no moves' });
  });

  it('reports an unreachable server', async () => {
    const api = new RealApiClient('/api', (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch);
    const err = await api.getSettings().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toMatch(/Cannot reach/);
  });

  it('parses SSE events and tells server `error` events from connection errors', () => {
    let es: FakeEventSource | null = null;
    const api = new RealApiClient('/api', fetch, (url) => (es = new FakeEventSource(url)) as unknown as EventSource);
    const got: string[] = [];
    const off = api.stream('g1', {
      onAnalysis: (ply, a) => got.push(`analysis ${ply} ${a.san}`),
      onProgress: (d, t) => got.push(`progress ${d}/${t}`),
      onSummary: (s) => got.push(`summary ${s.done}`),
      onPlyError: (ply, m) => got.push(`plyError ${ply} ${m}`),
      onConnectionError: () => got.push('connection'),
    });
    expect(es!.url).toBe('/api/games/g1/stream');
    es!.emit('analysis', { ply: '3', analysis: analyses[3] });
    es!.emit('progress', { done: 3, total: 72 });
    es!.emit('summary', { white: {}, black: {}, done: 72, total: 72 });
    es!.emit('error', { ply: 5, message: 'engine crashed' });
    es!.dispatchEvent(new Event('error'));
    off();
    expect(es!.closed).toBe(true);
    expect(got).toEqual([
      'analysis 3 Nf3',
      'progress 3/72',
      'summary 72',
      'plyError 5 engine crashed',
      'connection',
    ]);
  });
});
