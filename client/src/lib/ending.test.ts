import { describe, expect, it } from 'vitest';
import { ENDING_TEXT, endingFromChessCom, endingFromPgn } from './ending';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MATED = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'; // fool's mate

describe('game ending', () => {
  it('reads chess.com result codes from the loser (or the draw)', () => {
    expect(endingFromChessCom('win', 'resigned')).toBe('resignation');
    expect(endingFromChessCom('timeout', 'win')).toBe('time');
    expect(endingFromChessCom('checkmated', 'win')).toBe('checkmate');
    expect(endingFromChessCom('repetition', 'repetition')).toBe('repetition');
    expect(endingFromChessCom('timevsinsufficient', 'timevsinsufficient')).toBe('timeout-insufficient');
    expect(endingFromChessCom('win', 'kingofthehill')).toBeNull();
  });

  it("reads chess.com's Termination header", () => {
    expect(endingFromPgn('mistermine102 won by resignation', '1-0', START)).toBe('resignation');
    expect(endingFromPgn('Opp won on time', '0-1', START)).toBe('time');
    expect(endingFromPgn('Opp won by checkmate', '0-1', MATED)).toBe('checkmate');
    expect(endingFromPgn('Opp won - game abandoned', '0-1', START)).toBe('abandonment');
    expect(endingFromPgn('Game drawn by agreement', '1/2-1/2', START)).toBe('agreement');
    expect(endingFromPgn('Game drawn by timeout vs insufficient material', '1/2-1/2', START)).toBe('timeout-insufficient');
    expect(endingFromPgn('Game drawn by insufficient material', '1/2-1/2', START)).toBe('insufficient');
    expect(endingFromPgn('Game drawn by 50-move rule', '1/2-1/2', START)).toBe('fifty');
  });

  it("reads lichess's Termination and falls back to the final position", () => {
    expect(endingFromPgn('Time forfeit', '1-0', START)).toBe('time');
    expect(endingFromPgn('Normal', '0-1', MATED)).toBe('checkmate');
    expect(endingFromPgn('Normal', '1-0', START)).toBe('resignation');
    expect(endingFromPgn('Normal', '1/2-1/2', START)).toBeNull();
    expect(endingFromPgn(undefined, '0-1', MATED)).toBe('checkmate');
    expect(endingFromPgn(undefined, '1-0', START)).toBeNull();
  });

  it('has a phrase for every ending', () => {
    expect(ENDING_TEXT.time).toBe('on time');
    expect(ENDING_TEXT.resignation).toBe('by resignation');
  });
});
