// chess.com import by username: the newest finished games from the public API (https://api.chess.com/pub, no key).
// Monthly archives are read newest first until `limit` standard-chess games are collected (variants are skipped).
import type { ChessComGame, ChessComGames, ChessComPlayer } from '@chess-coach/shared';

/** chess.com's public API; env CHESSCOM_API overrides it (E2E tests point it at a dead port: no network). */
const apiBase = () => (process.env.CHESSCOM_API?.trim() || 'https://api.chess.com/pub').replace(/\/$/, '');
// chess.com asks API clients to identify themselves; requests without a User-Agent can get a Cloudflare challenge.
const USER_AGENT = 'chess-coach/0.0 (local game analysis app)';
/** At most this many monthly archives (2 years) are read per request (players with few games a month). */
const MAX_ARCHIVES = 24;
/** The first page of the Open dialog's list; "Show more games" asks for more, up to MAX_LIMIT. */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 300;

/** A failed chess.com lookup; `status` is the HTTP status for our API (404 unknown player, 502 chess.com down). */
export class ChessComError extends Error {
  override name = 'ChessComError';
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function validUsername(name: string): boolean {
  return /^[A-Za-z0-9_-]{1,50}$/.test(name);
}

interface RawPlayer { username?: string; rating?: number; result?: string }
interface RawGame {
  url?: string; pgn?: string; end_time?: number; time_class?: string; time_control?: string; rated?: boolean;
  rules?: string; white?: RawPlayer; black?: RawPlayer;
}

type FetchLike = typeof fetch;

async function getJson(url: string, fetchImpl: FetchLike, username: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new ChessComError(`Could not reach chess.com (${(e as Error).message}). Check your internet connection.`, 502);
  }
  if (res.status === 404) throw new ChessComError(`chess.com has no player called "${username}".`, 404);
  if (res.status === 429) throw new ChessComError('chess.com is rate-limiting requests — wait a minute and try again.', 502);
  if (!res.ok) throw new ChessComError(`chess.com answered ${res.status} — try again later.`, 502);
  try {
    return await res.json();
  } catch {
    throw new ChessComError('chess.com sent an unexpected answer — try again later.', 502);
  }
}

function player(p: RawPlayer | undefined): ChessComPlayer {
  return { username: p?.username ?? '?', rating: typeof p?.rating === 'number' ? p.rating : null, result: p?.result ?? '' };
}

export function toGame(g: RawGame): ChessComGame | null {
  if (g.rules !== 'chess' || typeof g.pgn !== 'string' || !g.pgn.trim()) return null;
  return {
    url: g.url ?? '',
    pgn: g.pgn,
    endTime: g.end_time ?? 0,
    timeClass: g.time_class ?? '',
    timeControl: g.time_control ?? '',
    rated: g.rated === true,
    white: player(g.white),
    black: player(g.black),
  };
}

/** The newest finished games of `username`, newest first. Throws ChessComError. */
export async function fetchChessComGames(
  username: string,
  opts: { limit?: number; fetchImpl?: FetchLike } = {},
): Promise<ChessComGames> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
  const API = apiBase();
  const user = encodeURIComponent(username.toLowerCase());
  const index = (await getJson(`${API}/player/${user}/games/archives`, fetchImpl, username)) as { archives?: unknown };
  const archives = Array.isArray(index.archives) ? index.archives.filter((a): a is string => typeof a === 'string') : [];
  const games: ChessComGame[] = [];
  for (const url of archives.slice(-MAX_ARCHIVES).reverse()) {
    if (!url.startsWith(`${API}/`)) continue;
    const month = (await getJson(url, fetchImpl, username)) as { games?: RawGame[] };
    const list = (Array.isArray(month.games) ? month.games : []).map(toGame).filter((g): g is ChessComGame => g !== null);
    games.push(...list.sort((a, b) => b.endTime - a.endTime));
    if (games.length >= limit) break;
  }
  const lower = username.toLowerCase();
  const own = games.flatMap((g) => [g.white.username, g.black.username]).find((n) => n.toLowerCase() === lower);
  return { username: own ?? username, games: games.slice(0, limit) };
}
