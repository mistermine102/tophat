import { describe, expect, it } from 'vitest';
import { MemoryStore, prefixedStore } from '../src/store';

describe('prefixedStore', () => {
  it('keeps another engine’s analyses and searches apart, shares the games and settings', async () => {
    const base = new MemoryStore();
    const lite = prefixedStore(base, 'lite:');
    base.put('analyses', 'k', 'full');
    base.put('searches', 'k', 'full');
    base.put('games', 'g', 'game');
    base.put('settings', 's', 'setting');

    expect(await lite.get('analyses', 'k')).toBeUndefined();
    expect(await lite.get('searches', 'k')).toBeUndefined();
    expect(await lite.get('games', 'g')).toBe('game');
    expect(await lite.get('settings', 's')).toBe('setting');

    await lite.put('analyses', 'k', 'lite');
    expect(await lite.get('analyses', 'k')).toBe('lite');
    expect(base.get('analyses', 'k')).toBe('full');
  });

  it('no prefix: the store itself', () => {
    const base = new MemoryStore();
    expect(prefixedStore(base, '')).toBe(base);
  });
});
