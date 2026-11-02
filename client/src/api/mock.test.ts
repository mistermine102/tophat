import type { MoveAnalysis } from '@chess-coach/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_ID, FIXTURE_PGN } from '../fixtures/game';
import { MockApiClient } from './mock';
import { ApiError } from './types';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function collect(api: MockApiClient, id: string) {
  const plies: number[] = [];
  const progress: [number, number][] = [];
  let summary = 0;
  const off = api.stream(id, {
    onAnalysis: (ply) => plies.push(ply),
    onProgress: (d, t) => progress.push([d, t]),
    onSummary: () => summary++,
  });
  return { plies, progress, summary: () => summary, off };
}

describe('MockApiClient', () => {
  it('imports the fixture PGN and streams analyses one by one in ply order', async () => {
    const api = new MockApiClient({ intervalMs: 150, createDelayMs: 0 });
    const p = api.createGame(FIXTURE_PGN);
    await vi.advanceTimersByTimeAsync(1);
    const game = await p;
    expect(game.id).toBe(FIXTURE_ID);
    expect(game.you).toBe('black');
    const s = collect(api, game.id);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.plies).toEqual([]);
    expect(s.progress.at(-1)).toEqual([0, 72]);
    await vi.advanceTimersByTimeAsync(150);
    expect(s.plies).toEqual([1]);
    await vi.advanceTimersByTimeAsync(300);
    expect(s.plies).toEqual([1, 2, 3]);
    expect(s.progress.at(-1)).toEqual([3, 72]);
  });

  it('focus(ply) makes that ply and the next one arrive next', async () => {
    const api = new MockApiClient({ intervalMs: 150 });
    const s = collect(api, FIXTURE_ID);
    await vi.advanceTimersByTimeAsync(300); // plies 1, 2
    await api.focus(FIXTURE_ID, 40);
    expect(api.queueOf(FIXTURE_ID).slice(0, 3)).toEqual([40, 41, 3]);
    await vi.advanceTimersByTimeAsync(450);
    expect(s.plies).toEqual([1, 2, 40, 41, 3]);
    // Focusing an already analysed ply changes nothing.
    await api.focus(FIXTURE_ID, 40);
    expect(api.queueOf(FIXTURE_ID)[0]).toBe(4);
  });

  it('finishes with a summary and replays finished analyses to late subscribers', async () => {
    const api = new MockApiClient({ intervalMs: 10 });
    const s = collect(api, FIXTURE_ID);
    await vi.advanceTimersByTimeAsync(10 * 72 + 5);
    expect(s.plies).toHaveLength(72);
    expect(s.summary()).toBe(1);
    const late = collect(api, FIXTURE_ID);
    await vi.advanceTimersByTimeAsync(1);
    expect(late.plies).toHaveLength(72);
    expect(late.summary()).toBe(1);
    const sp = api.getGame(FIXTURE_ID);
    await vi.advanceTimersByTimeAsync(1);
    const snap = await sp;
    expect(Object.keys(snap.analyses)).toHaveLength(72);
    expect(snap.summary?.done).toBe(72);
  });

  it('getGame returns only what is finished so far', async () => {
    const api = new MockApiClient({ intervalMs: 100 });
    collect(api, FIXTURE_ID);
    await vi.advanceTimersByTimeAsync(250);
    const p = api.getGame(FIXTURE_ID);
    await vi.advanceTimersByTimeAsync(1);
    const snap = await p;
    expect(Object.keys(snap.analyses).map(Number)).toEqual([1, 2]);
    expect(snap.summary?.done).toBe(2);
  });

  it('analyse() answers after ~300 ms: fixture moves from the fixture, others generic', async () => {
    const api = new MockApiClient({ analyseDelayMs: 300 });
    const g = api.getGame(FIXTURE_ID);
    await vi.advanceTimersByTimeAsync(1);
    await g;
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    let res: MoveAnalysis | null = null;
    void api.analyse({ fenBefore: start, uci: 'e2e4' }).then((a) => (res = a));
    await vi.advanceTimersByTimeAsync(299);
    expect(res).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    expect(res!.label).toBe('book');

    const side = api.analyse({ fenBefore: start, uci: 'g1f3', prev: { fenBefore: start, uci: 'e2e4' } });
    await vi.advanceTimersByTimeAsync(300);
    const a = await side;
    expect(a.san).toBe('Nf3');
    expect(a.label).toBe('good');
    expect(a.played.explanation?.immediate.text[0]).toMatch(/Develops the knight/);
  });

  it('rejects bad PGNs with a 400 ApiError and supports any other valid PGN', async () => {
    const api = new MockApiClient({ createDelayMs: 0, intervalMs: 10 });
    const bad = api.createGame('1. e4 e5 2. Qxf7#').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1);
    const err = await bad;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);

    const ok = api.createGame('[White "a"]\n[Black "b"]\n\n1. d4 d5 2. c4 *');
    await vi.advanceTimersByTimeAsync(1);
    const g = await ok;
    expect(g.moves).toHaveLength(3);
    const s = collect(api, g.id);
    await vi.advanceTimersByTimeAsync(40);
    expect(s.plies).toEqual([1, 2, 3]);
    expect(s.summary()).toBe(1);
  });

  it("guesses the fixture player's side (black), like the server", async () => {
    const api = new MockApiClient({ createDelayMs: 0 });
    const g = api.createGame(FIXTURE_PGN);
    await vi.advanceTimersByTimeAsync(1);
    expect((await g).you).toBe('black');
  });
});
