// IdbStore on fake-indexeddb (an in-memory IndexedDB for Node), plus the pipeline's SearchCache on top of it.
import { IDBFactory } from 'fake-indexeddb';
import { SearchCache, type Searcher } from '@chess-coach/core/analysis/searchCache';
import { describe, expect, it, vi } from 'vitest';
import { IdbStore } from './idbStore';

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('IdbStore', () => {
  it('get / put per table, values survive reopening, clear', async () => {
    const factory = new IDBFactory();
    const a = await IdbStore.open('t1', factory);
    expect(await a.get('analyses', 'k')).toBeUndefined();
    await a.put('analyses', 'k', { label: 'best', n: [1, 2] });
    await a.put('games', 'k', { id: 'g' });
    expect(await a.get('analyses', 'k')).toEqual({ label: 'best', n: [1, 2] });
    expect(await a.get('games', 'k')).toEqual({ id: 'g' });
    expect(await a.count('analyses')).toBe(1);
    a.close();
    const b = await IdbStore.open('t1', factory);
    expect(await b.get('analyses', 'k')).toEqual({ label: 'best', n: [1, 2] });
    await b.clear();
    expect(await b.get('games', 'k')).toBeUndefined();
  });

  it('persists engine searches for SearchCache (a new cache over the same store needs no engine)', async () => {
    const store = await IdbStore.open('t2', new IDBFactory());
    const search = vi.fn(async () => ({ lines: [{ multipv: 1, move: 'e2e4', score: { cp: 20 }, depth: 10, pv: ['e2e4'] }], bestmove: 'e2e4', depth: 10, nodes: 1, timeMs: 5 }));
    const engine: Searcher = { search };
    const first = await new SearchCache(store).search(engine, FEN, { depth: 10, multipv: 1 });
    expect(first.cached).toBe(false);
    const again = await new SearchCache(store).search(engine, FEN, { depth: 10, multipv: 1 });
    expect(again).toEqual({ result: first.result, cached: true });
    expect(search).toHaveBeenCalledTimes(1);
  });
});
