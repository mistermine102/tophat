// HTTP API end to end (real Stockfish, reduced search budget): the app on an ephemeral port, global fetch, SSE.
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AnalysisSettings, DEFAULT_SETTINGS, type GameInfo, type GameSummary, type MoveAnalysis } from '@chess-coach/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, createGameManager } from '../src/app';
import type { Searcher } from '../src/analysis/searchCache';
import { CacheDb } from '../src/cache';
import { Scheduler } from '../src/engine/scheduler';
import { Engine, engineAvailable } from '../src/engine/uci';
import { parseGamePgn } from '../src/games';

const T = 240_000;

// Fast budget so a whole game finishes in seconds (the pipeline is the same).
const FAST: AnalysisSettings = structuredClone(DEFAULT_SETTINGS);
FAST.budget.deep = { depth: 10, multipv: 5, maxMs: 1000 };
FAST.budget.shallow = { depth: 6, multipv: 5, maxMs: 300 };
FAST.budget.threat = { depth: 8, multipv: 1, maxMs: 300 };
FAST.budget.forcedness = { depth: 8, multipv: 2, maxMs: 300 };

// chess.com-style export: many headers, clock comments. Blackburne Shilling trap, 7...Nf3# (14 plies).
const PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.10.20"]
[Round "-"]
[White "SomeOpponent"]
[Black "SzymonJ"]
[Result "0-1"]
[CurrentPosition "rnb1kbnr/pppp1ppp/8/8/2B1q3/8/PPPPBP1P/RNBQKR2 w Qkq - 3 8"]
[Timezone "UTC"]
[ECO "C50"]
[WhiteElo "812"]
[BlackElo "845"]
[TimeControl "600"]
[Termination "SzymonJ won by checkmate"]
[Link "https://www.chess.com/game/live/123456789"]

1. e4 {[%clk 0:09:58.5]} 1... e5 {[%clk 0:09:57.1]} 2. Nf3 {[%clk 0:09:55.2]} 2... Nc6 {[%clk 0:09:54.0]}
3. Bc4 {[%clk 0:09:50.9]} 3... Nd4 {[%clk 0:09:49.3]} 4. Nxe5 $2 {[%clk 0:09:45.0]} 4... Qg5 {[%clk 0:09:40.8]}
5. Nxf7 {[%clk 0:09:30.2]} 5... Qxg2 {[%clk 0:09:35.5]} 6. Rf1 {[%clk 0:09:20.0]} (6. Qf3 Qxf3) 6... Qxe4+ {[%clk 0:09:30.1]}
7. Be2 {[%clk 0:09:10.4]} 7... Nf3# {[%clk 0:09:28.0]} 0-1`;

const PGN2 = `[Event "Casual"]
[White "A"]
[Black "B"]
[Result "*"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 6. Nf3 h6 *`;

interface SseEvent {
  event: string;
  data: unknown;
}

/** Read SSE events from `url` until `until(events)` is true (or the timeout). */
async function readSse(url: string, until: (events: SseEvent[]) => boolean, timeoutMs = 200_000): Promise<SseEvent[]> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const res = await fetch(url, { signal: ac.signal });
  expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: SseEvent[] = [];
  let buf = '';
  try {
    while (!until(events)) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
      }
    }
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
  return events;
}

const summaryDone = (events: SseEvent[]) => events.some((e) => e.event === 'summary' && (e.data as GameSummary).done === (e.data as GameSummary).total);

describe.skipIf(!engineAvailable())('HTTP API (Stockfish)', () => {
  let engine: Engine;
  let server: Server;
  let base: string;
  let dir: string;
  let dbPath: string;
  let db: CacheDb;

  const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  beforeAll(async () => {
    engine = await Engine.start({ threads: 4, hashMb: 128 });
    dir = mkdtempSync(join(tmpdir(), 'chess-coach-http-'));
    dbPath = join(dir, 'cache.sqlite');
    db = new CacheDb(dbPath);
    const scheduler = new Scheduler<Searcher>(engine);
    const games = createGameManager({ scheduler, db, settings: FAST });
    server = createApp({ engine, scheduler, games }).listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  afterAll(async () => {
    server?.closeAllConnections();
    server?.close();
    await engine?.quit();
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('settings round-trip; username decides "you" (case-insensitive)', async () => {
    expect(await (await fetch(`${base}/settings`)).json()).toEqual({ username: null });
    const put = await fetch(`${base}/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: ' szymonj ' }) });
    expect(await put.json()).toEqual({ username: 'szymonj' });
    expect(await (await fetch(`${base}/settings`)).json()).toEqual({ username: 'szymonj' });
    const bad = await fetch(`${base}/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 5 }) });
    expect(bad.status).toBe(400);
  });

  it('bad PGN -> 400', async () => {
    for (const pgn of ['', 'hello world', '1. e4 e5 2. Ke3 Ke6 3. Qh5 Kxh5', '[FEN "not a fen"]\n\n1. e4 *']) {
      const res = await post('/games', { pgn });
      expect(res.status, pgn).toBe(400);
      expect(((await res.json()) as { error?: string }).error, pgn).toBeTruthy();
    }
    expect((await post('/games', { nope: 1 })).status).toBe(400);
  });

  it(
    'POST /api/games -> GameInfo; the SSE stream delivers every analysis and the summary; GET returns them',
    async () => {
      const res = await post('/games', { pgn: PGN });
      expect(res.status).toBe(200);
      const info = (await res.json()) as GameInfo;
      expect(info.moves).toHaveLength(14);
      expect(info.moves[13]).toMatchObject({ ply: 14, san: 'Nf3#', uci: 'd4f3', color: 'black' });
      expect(info.headers.White).toBe('SomeOpponent');
      expect(info.you).toBe('black');
      expect(info.orientation).toBe('black');
      expect(info.id).toBe(parseGamePgn(PGN).id);

      const events = await readSse(`${base}/games/${info.id}/stream`, summaryDone);
      const analyses = events.filter((e) => e.event === 'analysis').map((e) => e.data as { ply: number; analysis: MoveAnalysis });
      expect(new Set(analyses.map((a) => a.ply))).toEqual(new Set(Array.from({ length: 14 }, (_, i) => i + 1)));
      expect(events.some((e) => e.event === 'progress')).toBe(true);
      expect(events.filter((e) => e.event === 'error')).toEqual([]);
      const last = analyses.find((a) => a.ply === 14)!.analysis;
      expect(last.label).toBe('best');
      expect(last.played.explanation!.immediate.text).toContain('Checkmate — Black wins.');
      const blunder = analyses.find((a) => a.ply === 9)!.analysis; // 5.Nxf7??
      expect(['mistake', 'blunder', 'miss']).toContain(blunder.label);

      const g = (await (await fetch(`${base}/games/${info.id}`)).json()) as { game: GameInfo; analyses: Record<string, MoveAnalysis>; summary: GameSummary };
      expect(Object.keys(g.analyses)).toHaveLength(14);
      expect(g.summary).toMatchObject({ done: 14, total: 14 });
      expect(g.summary.white.accuracy).toBeGreaterThan(0);
      expect(g.summary.black.accuracy).toBeGreaterThan(g.summary.white.accuracy!);
      const counts = (s: GameSummary['white']) => Object.values(s.counts).reduce((x, y) => x + (y ?? 0), 0);
      expect(counts(g.summary.white) + counts(g.summary.black)).toBe(14);
      expect((await fetch(`${base}/games/nope`)).status).toBe(404);
      expect((await fetch(`${base}/games/nope/stream`)).status).toBe(404);
    },
    T,
  );

  it(
    'a second import of the same PGN (and a restarted server) is served from the cache',
    async () => {
      const t0 = performance.now();
      const info = (await (await post('/games', { pgn: PGN })).json()) as GameInfo;
      const g = (await (await fetch(`${base}/games/${info.id}`)).json()) as { analyses: Record<string, MoveAnalysis> };
      expect(Object.keys(g.analyses)).toHaveLength(14);
      expect(performance.now() - t0).toBeLessThan(1000);

      // a new app over the same database file (no engine needed): the game reloads by id, analyses from sqlite
      const db2 = new CacheDb(dbPath);
      const app2 = createApp({ engine: null, scheduler: null, games: createGameManager({ scheduler: null, db: db2, settings: FAST }) });
      const s2 = app2.listen(0);
      await new Promise<void>((r) => s2.once('listening', () => r()));
      try {
        const t1 = performance.now();
        const r = await fetch(`http://127.0.0.1:${(s2.address() as AddressInfo).port}/api/games/${info.id}`);
        const body = (await r.json()) as { analyses: Record<string, MoveAnalysis>; summary: GameSummary };
        expect(Object.keys(body.analyses)).toHaveLength(14);
        expect(body.summary.done).toBe(14);
        expect(performance.now() - t1).toBeLessThan(1000);
      } finally {
        s2.close();
        db2.close();
      }
    },
    T,
  );

  it(
    'focus reorders the queue',
    async () => {
      const info = (await (await post('/games', { pgn: PGN2 })).json()) as GameInfo;
      expect(info.moves).toHaveLength(12);
      expect(info.you).toBe('white'); // username matches neither side
      const focus = await post(`/games/${info.id}/focus`, { ply: 9 });
      expect(focus.status).toBe(204);
      expect((await post(`/games/${info.id}/focus`, { ply: 0 })).status).toBe(400);
      expect((await post('/games/nope/focus', { ply: 1 })).status).toBe(404);
      const events = await readSse(`${base}/games/${info.id}/stream`, summaryDone);
      const order = events.filter((e) => e.event === 'analysis').map((e) => (e.data as { ply: number }).ply);
      expect(order).toHaveLength(12);
      // ply 1 may already be running when the focus arrives; 9 and 10 jump ahead of 2..8
      expect(order.indexOf(9), order.join(',')).toBeLessThan(order.indexOf(2));
      expect(order.indexOf(10), order.join(',')).toBeLessThan(order.indexOf(2));
    },
    T,
  );

  it(
    'POST /api/analyse: a side-line move (with prev) and validation',
    async () => {
      const g = parseGamePgn(PGN);
      // side line after 3...Nd4: 4.Nxd4 instead of 4.Nxe5
      const res = await post('/analyse', { fenBefore: g.moves[6]!.fenBefore, uci: 'f3d4', prev: { fenBefore: g.moves[5]!.fenBefore, uci: g.moves[5]!.uci } });
      expect(res.status).toBe(200);
      const a = (await res.json()) as MoveAnalysis;
      expect(a.san).toBe('Nxd4');
      expect(a.played.explanation!.immediate.text.join(' ')).toMatch(/knight on d4/);
      expect(['best', 'great', 'excellent', 'good']).toContain(a.label);
      expect((await post('/analyse', { fenBefore: g.moves[6]!.fenBefore, uci: 'e1e3' })).status).toBe(400);
      expect((await post('/analyse', { fenBefore: 'garbage', uci: 'e2e4' })).status).toBe(400);
      expect((await post('/analyse', { fenBefore: g.moves[6]!.fenBefore, uci: 'f3d4', prev: { fenBefore: g.moves[0]!.fenBefore, uci: 'e2e4' } })).status).toBe(400);
    },
    T,
  );
});
