// Mock-only PGN import (the real import lives on the server): first game, main line only; comments, clocks,
// NAGs and variations are ignored.
import type { Color, GameInfo, GameMove } from '@chess-coach/shared';
import { makeFen } from 'chessops/fen';
import { parsePgn, startingPosition } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { playUci } from '../lib/chess';

export class PgnImportError extends Error {
  override name = 'PgnImportError';
}

/** Small stable string hash (FNV-1a 32-bit, hex). */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function sideOf(headers: Record<string, string>, username: string | null): { you: Color; orientation: Color } {
  const u = username?.trim().toLowerCase();
  if (u && headers.Black?.toLowerCase() === u) return { you: 'black', orientation: 'black' };
  return { you: 'white', orientation: 'white' };
}

export function pgnToGame(pgn: string, username: string | null, idPrefix = 'mock-'): GameInfo {
  if (!pgn.trim()) throw new PgnImportError('The PGN is empty.');
  const games = parsePgn(pgn);
  const g = games[0];
  if (!g) throw new PgnImportError('No game found in the PGN.');
  const start = startingPosition(g.headers);
  if (start.isErr) throw new PgnImportError(`Invalid starting position: ${start.error.message}`);
  const pos = start.value;
  const startFen = makeFen(pos.toSetup());
  const headers: Record<string, string> = {};
  for (const [k, v] of g.headers) headers[k] = v;

  const moves: GameMove[] = [];
  let fen = startFen;
  let ply = 0;
  for (const node of g.moves.mainline()) {
    const move = parseSan(pos, node.san);
    if (!move) {
      const no = Math.floor(ply / 2) + 1;
      throw new PgnImportError(`Illegal or unreadable move "${node.san}" at move ${no}.`);
    }
    const played = playUci(fen, makeUci(move))!;
    pos.play(move);
    ply++;
    moves.push({ ply, san: played.san, uci: played.uci, color: played.color, fenBefore: fen, fenAfter: played.fenAfter });
    fen = played.fenAfter;
  }
  if (moves.length === 0) throw new PgnImportError('The PGN contains no moves.');
  const id = idPrefix + hashString(startFen + '|' + moves.map((m) => m.uci).join(' '));
  return { id, headers, startFen, moves, ...sideOf(headers, username) };
}
