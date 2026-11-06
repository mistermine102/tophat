import { afterAll, describe, expect, it } from 'vitest';
import { createEnginePool, defaultProcesses, type EnginePool } from '../src/engine/pool';
import { engineAvailable } from '../src/engine/uci';

describe('defaultProcesses', () => {
  it('splits the threads into 2-thread processes', () => {
    expect(defaultProcesses(10)).toBe(5);
    expect(defaultProcesses(3)).toBe(1);
    expect(defaultProcesses(1)).toBe(1);
  });
});

describe.skipIf(!engineAvailable())('createEnginePool (real Stockfish)', () => {
  let pool: EnginePool | null = null;
  afterAll(async () => {
    await pool?.quit();
  });
  it('starts N processes with threads / N threads each; they search independently', async () => {
    pool = await createEnginePool({ threads: 4, processes: 2, hashMb: 16 });
    expect(pool.engines.length).toBe(2);
    expect(pool.threadsPerEngine).toBe(2);
    expect(pool.engines.map((e) => e.threads)).toEqual([2, 2]);
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const rs = await Promise.all(pool.engines.map((e) => e.search({ fen, depth: 8 })));
    for (const r of rs) expect(r.lines.length).toBe(1);
  });
});
