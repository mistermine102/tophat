// Your side per game ("You" = the side at the bottom of the board; flipping the board changes it) and the chess.com
// username last looked up on the Open screen, both in localStorage (no username setting on the server).
import type { Color } from '@chess-coach/shared';

type Store = Pick<Storage, 'getItem' | 'setItem'> | null;
type Mode = 'real' | 'mock';

const MAX_SIDES = 300;
const sidesKey = (mode: Mode) => (mode === 'mock' ? 'chess-coach:sides:mock' : 'chess-coach:sides');
const nameKey = (mode: Mode) => (mode === 'mock' ? 'chess-coach:chesscom-name:mock' : 'chess-coach:chesscom-name');

function readSides(storage: Store, mode: Mode): Record<string, Color> {
  try {
    const raw = storage?.getItem(sidesKey(mode));
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, Color>) : {};
  } catch {
    return {};
  }
}

export function loadSide(storage: Store, mode: Mode, gameId: string): Color | null {
  const s = readSides(storage, mode)[gameId];
  return s === 'white' || s === 'black' ? s : null;
}

export function saveSide(storage: Store, mode: Mode, gameId: string, side: Color): void {
  const all = readSides(storage, mode);
  delete all[gameId];
  all[gameId] = side; // newest last
  const ids = Object.keys(all);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_SIDES))) delete all[id];
  try {
    storage?.setItem(sidesKey(mode), JSON.stringify(all));
  } catch {
    /* storage full / disabled */
  }
}

export function loadChessComName(storage: Store, mode: Mode): string | null {
  try {
    return storage?.getItem(nameKey(mode))?.trim() || null;
  } catch {
    return null;
  }
}

export function saveChessComName(storage: Store, mode: Mode, name: string): void {
  try {
    storage?.setItem(nameKey(mode), name.trim());
  } catch {
    /* storage full / disabled */
  }
}

/** The side whose player (PGN White / Black header) is `name` (any letter case), or null. */
export function sideOfName(headers: Record<string, string>, name: string | null): Color | null {
  const u = name?.trim().toLowerCase();
  if (!u) return null;
  if (headers.White?.toLowerCase() === u) return 'white';
  if (headers.Black?.toLowerCase() === u) return 'black';
  return null;
}
