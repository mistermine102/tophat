// The two screens and the URL: `?game=<id>` is the game screen (a reload opens the game again), no `game` parameter
// is the Open screen (the landing page). Other parameters (`mock`, `ui`) are kept. Going from a game to the Open
// screen pushes a history entry, so the browser's Back button returns to the game; opening a game from the Open
// screen replaces that entry with the game's URL (boot.ts → setGameParam).
export type Screen = 'open' | 'game';

/** History state of the Open screen entry pushed over a game (`history.back()` returns to the game). */
export const OPEN_STATE = { screen: 'open' } as const;

export function gameIdOf(search: string): string | null {
  return new URLSearchParams(search).get('game')?.trim() || null;
}

/** `href` with the `game` parameter set (or removed, for null). */
export function withGame(href: string, id: string | null): string {
  const url = new URL(href);
  if (id) url.searchParams.set('game', id);
  else url.searchParams.delete('game');
  return url.toString();
}

export function isOpenState(state: unknown): boolean {
  return !!state && typeof state === 'object' && (state as { screen?: unknown }).screen === 'open';
}
