import { describe, expect, it } from 'vitest';
import { parseInfoLine, PvCollector } from '../src/engine/uci';

describe('parseInfoLine', () => {
  it('parses a full multipv line', () => {
    const i = parseInfoLine(
      'info depth 18 seldepth 25 multipv 2 score cp -31 nodes 1234567 nps 900000 hashfull 120 tbhits 0 time 1371 pv e7e5 g1f3 b8c6',
    );
    expect(i).toEqual({
      depth: 18,
      seldepth: 25,
      multipv: 2,
      score: { cp: -31 },
      nodes: 1234567,
      nps: 900000,
      hashfull: 120,
      tbhits: 0,
      time: 1371,
      pv: ['e7e5', 'g1f3', 'b8c6'],
    });
  });
  it('parses mate scores and bounds', () => {
    expect(parseInfoLine('info depth 5 multipv 1 score mate -3 nodes 5 pv a1a2')?.score).toEqual({ mate: -3 });
    const lb = parseInfoLine('info depth 20 seldepth 30 multipv 1 score cp 40 lowerbound nodes 10 time 5 pv e2e4');
    expect(lb?.bound).toBe('lower');
    expect(lb?.score).toEqual({ cp: 40 });
    expect(lb?.nodes).toBe(10);
    expect(parseInfoLine('info depth 20 score cp 40 upperbound pv e2e4')?.bound).toBe('upper');
  });
  it('parses wdl, depth-0 terminal lines, currmove and strings', () => {
    expect(parseInfoLine('info depth 10 multipv 1 score cp 20 wdl 100 850 50 nodes 9 pv d2d4')).toMatchObject({ wdl: [100, 850, 50], nodes: 9, pv: ['d2d4'] });
    expect(parseInfoLine('info depth 0 score mate 0')).toEqual({ depth: 0, score: { mate: 0 } });
    expect(parseInfoLine('info depth 0 score cp 0')).toEqual({ depth: 0, score: { cp: 0 } });
    expect(parseInfoLine('info depth 12 currmove e2e4 currmovenumber 1')).toEqual({ depth: 12, currmove: 'e2e4', currmovenumber: 1 });
    expect(parseInfoLine('info string NNUE evaluation using nn-x.nnue')?.string).toBe('NNUE evaluation using nn-x.nnue');
    expect(parseInfoLine('bestmove e2e4')).toBeNull();
    expect(parseInfoLine('  info   depth  3  score  cp  5  pv  e2e4  \r')).toMatchObject({ depth: 3, score: { cp: 5 }, pv: ['e2e4'] });
  });
});

describe('PvCollector', () => {
  const add = (c: PvCollector, line: string) => c.add(parseInfoLine(line)!);

  it('keeps the highest-depth exact line per multipv and prefers exact over bound', () => {
    const c = new PvCollector(2);
    add(c, 'info depth 10 multipv 1 score cp 30 nodes 100 pv e2e4 e7e5');
    add(c, 'info depth 10 multipv 2 score cp 20 nodes 110 pv d2d4');
    add(c, 'info depth 11 multipv 1 score cp 60 lowerbound nodes 150 pv e2e4');
    add(c, 'info depth 11 multipv 1 score cp 45 nodes 200 pv c2c4 e7e5');
    add(c, 'info depth 11 multipv 2 score cp 30 nodes 220 pv e2e4 c7c5');
    add(c, 'info depth 12 multipv 1 score cp 70 lowerbound nodes 250 pv c2c4');
    add(c, 'info depth 5 currmove g1f3 currmovenumber 3');
    expect(c.lines()).toEqual([
      { multipv: 1, move: 'c2c4', score: { cp: 45 }, depth: 11, pv: ['c2c4', 'e7e5'] },
      { multipv: 2, move: 'e2e4', score: { cp: 30 }, depth: 11, pv: ['e2e4', 'c7c5'] },
    ]);
    expect(c.nodes).toBe(250);
  });

  it('falls back to a bound line when no exact line exists, ignores multipv beyond the request, dedupes moves', () => {
    const c = new PvCollector(2);
    add(c, 'info depth 1 multipv 1 score cp 10 lowerbound pv e2e4');
    add(c, 'info depth 1 multipv 3 score cp 0 pv a2a3');
    expect(c.lines()).toEqual([{ multipv: 1, move: 'e2e4', score: { cp: 10 }, depth: 1, pv: ['e2e4'] }]);
    const d = new PvCollector(3);
    add(d, 'info depth 9 multipv 1 score cp 10 pv e2e4');
    add(d, 'info depth 9 multipv 2 score cp 5 pv d2d4');
    add(d, 'info depth 9 multipv 3 score cp 1 pv e2e4'); // stale duplicate
    expect(d.lines().map((l) => [l.multipv, l.move])).toEqual([[1, 'e2e4'], [2, 'd2d4']]);
  });

  it('ignores lines without pv (e.g. depth 0 mate 0)', () => {
    const c = new PvCollector(1);
    add(c, 'info depth 0 score mate 0');
    expect(c.lines()).toEqual([]);
  });
});
