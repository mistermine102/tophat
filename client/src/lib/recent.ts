// Recently opened games (ids + a little metadata) in localStorage.
import type { GameInfo } from '@chess-coach/shared';

export interface RecentGame {
  id: string;
  white: string;
  black: string;
  result: string;
  date: string;
  moves: number;
  openedAt: number;
}

const MAX = 8;

export function recentKey(mode: 'real' | 'mock'): string {
  return mode === 'mock' ? 'chess-coach:recent:mock' : 'chess-coach:recent';
}

export function loadRecent(storage: Pick<Storage, 'getItem'> | null, key: string): RecentGame[] {
  try {
    const raw = storage?.getItem(key);
    const list = raw ? (JSON.parse(raw) as RecentGame[]) : [];
    return Array.isArray(list) ? list.filter((g) => g && typeof g.id === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberGame(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  key: string,
  game: GameInfo,
  now = Date.now(),
): RecentGame[] {
  const entry: RecentGame = {
    id: game.id,
    white: game.headers.White ?? 'White',
    black: game.headers.Black ?? 'Black',
    result: game.headers.Result ?? '*',
    date: game.headers.Date ?? '',
    moves: Math.ceil(game.moves.length / 2),
    openedAt: now,
  };
  const list = [entry, ...loadRecent(storage, key).filter((g) => g.id !== game.id)].slice(0, MAX);
  try {
    storage?.setItem(key, JSON.stringify(list));
  } catch {
    /* storage full / disabled */
  }
  return list;
}
