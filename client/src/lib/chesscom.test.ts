import type { ChessComGame } from '@chess-coach/shared';
import { describe, expect, it } from 'vitest';
import { chessComRow, dayLabel, formatTimeControl, groupByDay, outcomeOf } from './chesscom';

const game: ChessComGame = {
  url: 'https://www.chess.com/game/live/1',
  pgn: '1. e4 e5',
  endTime: Date.UTC(2026, 9, 18, 12) / 1000,
  timeClass: 'rapid',
  timeControl: '600',
  rated: true,
  white: { username: 'Opp', rating: 812, result: 'resigned' },
  black: { username: 'SzymonJ', rating: 835, result: 'win' },
};

describe('chess.com rows', () => {
  it('formats time controls', () => {
    expect(formatTimeControl('600')).toBe('10 min');
    expect(formatTimeControl('180+2')).toBe('3+2');
    expect(formatTimeControl('90+1')).toBe('1.5+1');
    expect(formatTimeControl('30')).toBe('30 s');
    expect(formatTimeControl('1/86400')).toBe('');
  });
  it('maps chess.com result codes', () => {
    expect(outcomeOf('win')).toBe('win');
    expect(outcomeOf('repetition')).toBe('draw');
    expect(outcomeOf('timevsinsufficient')).toBe('draw');
    expect(outcomeOf('checkmated')).toBe('loss');
    expect(outcomeOf('abandoned')).toBe('loss');
  });
  it('sees the game from the player (any letter case)', () => {
    const row = chessComRow(game, 'szymonj', new Date(Date.UTC(2026, 9, 26)));
    expect(row).toMatchObject({ side: 'black', outcome: 'win', opponent: 'Opp', opponentRating: 812, kind: 'Rapid · 10 min', date: '18 Oct' });
    expect(chessComRow(game, 'SzymonJ', new Date(Date.UTC(2027, 0, 5))).date).toBe('18 Oct 2026');
    expect(chessComRow({ ...game, timeClass: 'daily', timeControl: '1/86400' }, 'x')).toMatchObject({
      side: null,
      outcome: null,
      opponent: 'Opp vs SzymonJ',
      kind: 'Daily',
    });
  });
  it('tells how the game ended', () => {
    expect(chessComRow(game, 'szymonj').ending).toBe('resignation');
    expect(chessComRow({ ...game, white: { ...game.white, result: 'timeout' } }, 'szymonj').ending).toBe('time');
  });
  it('groups the list by day: Today, Yesterday, then the date', () => {
    const now = new Date(2026, 9, 28, 15);
    expect(dayLabel(new Date(2026, 9, 28, 9), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 9, 27, 23), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 9, 18, 12), now)).toBe('Sunday 18 October');
    expect(dayLabel(new Date(2025, 9, 18, 12), now)).toBe('Saturday 18 October 2025');
    const rows = [
      { day: 'b', dayLabel: 'B', n: 1 },
      { day: 'b', dayLabel: 'B', n: 2 },
      { day: 'a', dayLabel: 'A', n: 3 },
    ];
    expect(groupByDay(rows).map((g) => [g.label, g.rows.map((r) => r.n)])).toEqual([
      ['B', [1, 2]],
      ['A', [3]],
    ]);
  });
});
