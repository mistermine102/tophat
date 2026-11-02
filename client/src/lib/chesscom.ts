// Rows for the chess.com game list in the Open dialog: the game seen from the player's side.
import type { ChessComGame } from '@chess-coach/shared';
import { type Ending, endingFromChessCom } from './ending';

export type Outcome = 'win' | 'draw' | 'loss';

export interface ChessComRow {
  game: ChessComGame;
  /** The player's colour, null when they aren't in the game (shouldn't happen). */
  side: 'white' | 'black' | null;
  outcome: Outcome | null;
  /** How it ended (resignation, on time, checkmate …), null for codes we don't know. */
  ending: Ending | null;
  opponent: string;
  opponentRating: number | null;
  /** "Rapid · 10 min", "Blitz · 3+2", "Daily". */
  kind: string;
  /** "18 Oct", or "18 Oct 2025" outside the current year. */
  date: string;
  /** The local day the game ended ("2026-10-18"), for grouping the list by day. */
  day: string;
  /** "Today", "Yesterday", "Saturday 18 October" (+ the year outside the current one). */
  dayLabel: string;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** "Today" / "Yesterday" / "Saturday 18 October" (+ year outside the current one), local time. */
export function dayLabel(d: Date, now = new Date()): string {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(now)) return 'Today';
  if (dayKey(d) === dayKey(yesterday)) return 'Yesterday';
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' });
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  return `${weekday} ${date}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

/** Consecutive rows that ended on the same day (the list is newest first). */
export function groupByDay<T extends { day: string; dayLabel: string }>(rows: readonly T[]): { day: string; label: string; rows: T[] }[] {
  const out: { day: string; label: string; rows: T[] }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.day === r.day) last.rows.push(r);
    else out.push({ day: r.day, label: r.dayLabel, rows: [r] });
  }
  return out;
}

// chess.com result codes: https://www.chess.com/news/view/published-data-api#game-results
const DRAWS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);

export function outcomeOf(result: string): Outcome {
  if (result === 'win') return 'win';
  return DRAWS.has(result) ? 'draw' : 'loss';
}

/** "600" → "10 min", "180+2" → "3+2", "1/86400" → "" (daily), "30" → "30 s". */
export function formatTimeControl(tc: string): string {
  if (!tc || tc.includes('/')) return '';
  const [base, inc] = tc.split('+').map(Number);
  if (base === undefined || !Number.isFinite(base)) return tc;
  const minutes = base >= 60 ? `${Math.round((base / 60) * 10) / 10}` : null;
  if (inc) return `${minutes ?? `${base}s`}+${inc}`;
  return minutes ? `${minutes} min` : `${base} s`;
}

export function chessComRow(game: ChessComGame, username: string, now = new Date()): ChessComRow {
  const me = username.toLowerCase();
  const side = game.white.username.toLowerCase() === me ? 'white' : game.black.username.toLowerCase() === me ? 'black' : null;
  const mine = side === 'black' ? game.black : game.white;
  const theirs = side === 'black' ? game.white : game.black;
  const tc = formatTimeControl(game.timeControl);
  const cls = game.timeClass ? game.timeClass[0]!.toUpperCase() + game.timeClass.slice(1) : '';
  const d = new Date(game.endTime * 1000);
  const date = d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
  return {
    game,
    side,
    outcome: side ? outcomeOf(mine.result) : null,
    ending: endingFromChessCom(game.white.result, game.black.result),
    opponent: side ? theirs.username : `${game.white.username} vs ${game.black.username}`,
    opponentRating: side ? theirs.rating : null,
    kind: [cls, tc].filter(Boolean).join(' · '),
    date,
    day: dayKey(d),
    dayLabel: dayLabel(d, now),
  };
}
