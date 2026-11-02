// chess.com import by username (fake chess.com API; no network).
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { fetchChessComGames } from '../src/chesscom';

const API = 'https://api.chess.com/pub';

function raw(n: number, extra: Record<string, unknown> = {}) {
  return {
    url: `https://www.chess.com/game/live/${n}`,
    pgn: `[White "SzymonJ"]\n[Black "Opp${n}"]\n[Result "1-0"]\n\n1. e4 e5 1-0`,
    end_time: n,
    time_class: 'rapid',
    time_control: '600',
    rated: true,
    rules: 'chess',
    white: { username: 'SzymonJ', rating: 800, result: 'win' },
    black: { username: `Opp${n}`, rating: 790, result: 'resigned' },
    ...extra,
  };
}

/** A fake chess.com: `months` maps "YYYY/MM" to that month's games; records requested URLs. */
function fakeChessCom(months: Record<string, unknown[]>, opts: { status?: number } = {}) {
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    expect(new Headers(init?.headers).get('User-Agent')).toMatch(/chess-coach/);
    if (opts.status) return new Response('{}', { status: opts.status });
    if (url === `${API}/player/szymonj/games/archives`) {
      return Response.json({ archives: Object.keys(months).map((m) => `${API}/player/szymonj/games/${m}`) });
    }
    const m = /games\/(\d{4}\/\d{2})$/.exec(url)?.[1];
    if (m && months[m]) return Response.json({ games: months[m] });
    return Response.json({ code: 0, message: 'not found' }, { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, urls };
}

describe('fetchChessComGames', () => {
  it('reads the newest months first, newest game first, and stops at the limit', async () => {
    const { fetchImpl, urls } = fakeChessCom({ '2026/08': [raw(1), raw(2)], '2026/09': [raw(3)], '2026/10': [raw(5), raw(4)] });
    const res = await fetchChessComGames('szymonj', { limit: 3, fetchImpl });
    expect(res.username).toBe('SzymonJ'); // spelling from the games
    expect(res.games.map((g) => g.endTime)).toEqual([5, 4, 3]);
    expect(urls.some((u) => u.endsWith('2026/08'))).toBe(false);
    expect(res.games[0]).toMatchObject({ timeClass: 'rapid', rated: true, white: { username: 'SzymonJ', rating: 800, result: 'win' } });
    expect(res.games[0]!.pgn).toContain('1. e4 e5');
  });
  it('skips variants and games without a PGN', async () => {
    const { fetchImpl } = fakeChessCom({ '2026/10': [raw(1), raw(2, { rules: 'chess960' }), raw(3, { pgn: '' })] });
    const res = await fetchChessComGames('SzymonJ', { fetchImpl });
    expect(res.games.map((g) => g.endTime)).toEqual([1]);
  });
  it('a player without games gets an empty list', async () => {
    const { fetchImpl } = fakeChessCom({});
    expect(await fetchChessComGames('szymonj', { fetchImpl })).toEqual({ username: 'szymonj', games: [] });
  });
});

describe('GET /api/chesscom/:username/games', () => {
  async function get(fetchImpl: typeof fetch, path: string) {
    const server = createApp({ engine: null, scheduler: null, fetchImpl }).listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      return { status: res.status, body: (await res.json()) as { error?: string; games?: unknown[] } };
    } finally {
      server.close();
    }
  }

  it('returns the games', async () => {
    const { fetchImpl } = fakeChessCom({ '2026/10': [raw(1), raw(2)] });
    const res = await get(fetchImpl, '/api/chesscom/SzymonJ/games?limit=1');
    expect(res.status).toBe(200);
    expect(res.body.games).toHaveLength(1);
  });
  it('404 for an unknown player, 502 when chess.com fails, 400 for a bad name or limit', async () => {
    const unknown = await get(fakeChessCom({}, { status: 404 }).fetchImpl, '/api/chesscom/nobody/games');
    expect(unknown).toEqual({ status: 404, body: { error: 'chess.com has no player called "nobody".' } });
    const down = await get(fakeChessCom({}, { status: 500 }).fetchImpl, '/api/chesscom/szymonj/games');
    expect(down.status).toBe(502);
    expect(down.body.error).toMatch(/chess\.com answered 500/);
    const throws = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    expect((await get(throws, '/api/chesscom/szymonj/games')).body.error).toMatch(/Could not reach chess\.com/);
    expect((await get(fakeChessCom({}).fetchImpl, '/api/chesscom/a%20b/games')).status).toBe(400);
    expect((await get(fakeChessCom({}).fetchImpl, '/api/chesscom/szymonj/games?limit=0')).status).toBe(400);
  });
});
