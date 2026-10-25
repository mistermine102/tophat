import { describe, expect, it } from 'vitest';
import { SearchCache, type Searcher } from '../src/analysis/searchCache';
import { SearchAbortedError, type SearchResult } from '../src/engine/uci';

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const result = (move: string): SearchResult => ({ lines: [{ multipv: 1, move, score: { cp: 20 }, depth: 10, pv: [move] }], bestmove: move, depth: 10, nodes: 1, timeMs: 5 });

/** A searcher whose calls stay pending until resolved/rejected by the test. */
function controlled() {
  const calls: { resolve: (r: SearchResult) => void; reject: (e: unknown) => void }[] = [];
  const searcher: Searcher = { search: () => new Promise((resolve, reject) => calls.push({ resolve, reject })) };
  return { searcher, calls };
}

describe('SearchCache', () => {
  it('shares one in-flight search between concurrent callers (also across engines)', async () => {
    const cache = new SearchCache(null);
    const a = controlled();
    const b = controlled();
    const p1 = cache.search(a.searcher, FEN, { depth: 10, multipv: 1 });
    const p2 = cache.search(b.searcher, FEN, { depth: 10, multipv: 1 });
    expect(a.calls.length).toBe(1);
    expect(b.calls.length).toBe(0);
    a.calls[0]!.resolve(result('e2e4'));
    expect((await p1).cached).toBe(false);
    expect((await p2).result.bestmove).toBe('e2e4');
    expect(cache.peek(FEN, { depth: 10, multipv: 1 })?.bestmove).toBe('e2e4');
  });

  it('a waiter runs the search itself when the shared one is aborted (its job was preempted)', async () => {
    const cache = new SearchCache(null);
    const a = controlled();
    const b = controlled();
    const p1 = cache.search(a.searcher, FEN, { depth: 10, multipv: 1 });
    const p2 = cache.search(b.searcher, FEN, { depth: 10, multipv: 1 });
    a.calls[0]!.reject(new SearchAbortedError('aborted'));
    await expect(p1).rejects.toBeInstanceOf(SearchAbortedError);
    await new Promise((r) => setTimeout(r, 0));
    expect(b.calls.length).toBe(1); // b's own engine
    b.calls[0]!.resolve(result('d2d4'));
    expect((await p2).result.bestmove).toBe('d2d4');
    // aborted results are never cached; b's is
    expect(cache.peek(FEN, { depth: 10, multipv: 1 })?.bestmove).toBe('d2d4');
  });

  it('other errors propagate to waiters and nothing is cached', async () => {
    const cache = new SearchCache(null);
    const a = controlled();
    const b = controlled();
    const p1 = cache.search(a.searcher, FEN, { depth: 10, multipv: 1 });
    const p2 = cache.search(b.searcher, FEN, { depth: 10, multipv: 1 });
    a.calls[0]!.reject(new Error('engine crashed'));
    await expect(p1).rejects.toThrow('engine crashed');
    await expect(p2).rejects.toThrow('engine crashed');
    expect(b.calls.length).toBe(0);
    expect(cache.peek(FEN, { depth: 10, multipv: 1 })).toBeUndefined();
  });
});
