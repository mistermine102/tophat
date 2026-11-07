import { describe, expect, it } from 'vitest';
import { gameIdOf, isOpenState, OPEN_STATE, withGame } from './route';

describe('screen routing', () => {
  it('reads the game id from the URL (none = the Open screen)', () => {
    expect(gameIdOf('?game=abc&mock=1')).toBe('abc');
    expect(gameIdOf('?mock=1&ui=b')).toBeNull();
    expect(gameIdOf('?game=')).toBeNull();
  });

  it('sets / removes the game id and keeps the other parameters', () => {
    expect(withGame('http://x/?mock=1&ui=b', 'g1')).toBe('http://x/?mock=1&ui=b&game=g1');
    expect(withGame('http://x/?mock=1&game=g1', null)).toBe('http://x/?mock=1');
  });

  it("tells the Open screen's history entry", () => {
    expect(isOpenState(OPEN_STATE)).toBe(true);
    expect(isOpenState(null)).toBe(false);
    expect(isOpenState({ screen: 'game' })).toBe(false);
  });
});
