import { describe, expect, it } from 'vitest';
import { formatBarScore, formatMaterial, formatPositionEval, formatScore, scoreLeader, whiteWinPercent } from './format';

describe('formatScore (White POV)', () => {
  it('formats centipawns with one decimal and a sign', () => {
    expect(formatScore({ cp: 120 })).toBe('+1.2');
    expect(formatScore({ cp: -35 })).toBe('-0.4');
    expect(formatScore({ cp: 4 })).toBe('0.0');
    expect(formatScore({ cp: 0 })).toBe('0.0');
    expect(formatScore({ cp: -1234 })).toBe('-12.3');
    expect(formatScore({ cp: 1000 })).toBe('+10.0');
  });

  it('formats mates', () => {
    expect(formatScore({ mate: 3 })).toBe('M3');
    expect(formatScore({ mate: -2 })).toBe('-M2');
    expect(formatScore({ mate: 0 })).toBe('#');
  });

  it('handles missing scores', () => {
    expect(formatScore(null)).toBe('…');
    expect(formatScore({})).toBe('…');
  });
});

describe('position eval / eval bar', () => {
  it('shows the result for a checkmated side', () => {
    expect(formatPositionEval({ mate: -1 }, 'white')).toBe('0-1');
    expect(formatPositionEval({ cp: 1000 }, 'black')).toBe('1-0');
    expect(formatPositionEval({ cp: 50 }, null)).toBe('+0.5');
  });

  it('bar label is unsigned', () => {
    expect(formatBarScore({ cp: -270 }, null)).toBe('2.7');
    expect(formatBarScore({ mate: -4 }, null)).toBe('M4');
    expect(formatBarScore(null, null)).toBe('');
  });

  it('win percent for White', () => {
    expect(whiteWinPercent({ cp: 0 })).toBe(50);
    expect(whiteWinPercent({ cp: 300 })).toBeGreaterThan(70);
    expect(whiteWinPercent({ mate: -3 })).toBeLessThan(5);
    expect(whiteWinPercent({ mate: 0 })).toBe(0);
    expect(whiteWinPercent({ cp: 0 }, 'black')).toBe(100);
    expect(whiteWinPercent(null)).toBe(50);
  });

  it('leader', () => {
    expect(scoreLeader({ cp: 30 })).toBe('white');
    expect(scoreLeader({ mate: -1 })).toBe('black');
    expect(scoreLeader({ cp: 0 })).toBeNull();
    expect(scoreLeader(null, 'white')).toBe('black');
  });

  it('material', () => {
    expect(formatMaterial(3)).toBe('+3');
    expect(formatMaterial(-9)).toBe('-9');
    expect(formatMaterial(0)).toBe('0');
  });
});
