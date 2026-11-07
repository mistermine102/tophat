// chess.com import by username (fake chess.com API; no network).
import { describe, expect, it } from 'vitest';
import { ChessComError, fetchChessComGames, validUsername } from './chesscom';

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
    // browser-friendly: only CORS-safelisted headers (no preflight)
    expect([...new Headers(init?.headers).keys()]).toEqual(['accept']);
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

describe('fetchChessComGames errors', () => {
  it('unknown player, chess.com failing or unreachable -> ChessComError with a readable message', async () => {
    await expect(fetchChessComGames('nobody', { fetchImpl: fakeChessCom({}, { status: 404 }).fetchImpl })).rejects.toMatchObject({ status: 404, message: 'chess.com has no player called "nobody".' });
    await expect(fetchChessComGames('szymonj', { fetchImpl: fakeChessCom({}, { status: 500 }).fetchImpl })).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/chess\.com answered 500/) });
    await expect(fetchChessComGames('szymonj', { fetchImpl: fakeChessCom({}, { status: 429 }).fetchImpl })).rejects.toThrow(/rate-limiting/);
    const throws = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await expect(fetchChessComGames('szymonj', { fetchImpl: throws })).rejects.toBeInstanceOf(ChessComError);
    await expect(fetchChessComGames('szymonj', { fetchImpl: throws })).rejects.toThrow(/Could not reach chess\.com/);
  });
  it('validUsername', () => {
    expect(validUsername('SzymonJ_1-2')).toBe(true);
    expect(validUsername('a b')).toBe(false);
    expect(validUsername('')).toBe(false);
  });
});

