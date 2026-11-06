import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha1 } from '../src/hash';

describe('sha1 (pure JS)', () => {
  it('matches node:crypto (so game ids and cache keys are unchanged)', () => {
    const inputs = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), 'zażółć gęślą jaźń ♞', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 e2e4 e7e5'];
    for (const s of inputs) expect(sha1(s), s).toBe(createHash('sha1').update(s).digest('hex'));
  });
});
