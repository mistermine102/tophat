import { describe, expect, it } from 'vitest';
import { playSound, soundFor } from './sound';

describe('soundFor', () => {
  it('the end of the game first, then check, then the move itself', () => {
    // Fool's mate
    expect(soundFor('Qh4#', 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3')).toBe('checkmate');
    // stalemate: Black king a8, White queen b6, White king c7... Black to move, no legal move
    expect(soundFor('Qb6', 'k7/2K5/1Q6/8/8/8/8/8 b - - 0 1')).toBe('draw');
    expect(soundFor('Bb5+', 'rnbqkbnr/ppp2ppp/3p4/1B2p3/4P3/8/PPPP1PPP/RNBQK1NR b KQkq - 1 3')).toBe('check');
    expect(soundFor('e8=Q', '4Q3/8/8/8/8/8/k7/6K1 b - - 0 1')).toBe('promote');
    expect(soundFor('O-O', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQ1RK1 b kq - 1 1')).toBe('castle');
    expect(soundFor('exd5', 'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2')).toBe('capture');
    expect(soundFor('e4', 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')).toBe('move');
  });

  it('playing without Web Audio is a no-op', () => {
    expect(() => playSound('move')).not.toThrow();
  });
});
