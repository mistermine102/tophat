import { DEFAULT_SETTINGS, type Fact } from '@chess-coach/shared';
import { describe, expect, it } from 'vitest';
import type { PvLine } from '../src/engine/uci';
import { forcedFromSearch, forcednessChecks, narrateLine, narrationPlies, nullMoveFen, threatFromSearch } from '../src/facts/line';
import { longTermFacts, positionalFacts } from '../src/facts/longterm';
import { legalFen, playUci } from './helpers/classifyHelpers';

const S = DEFAULT_SETTINGS;
const pvLine = (move: string, score: PvLine['score'], pv: string[] = [move], multipv = 1): PvLine => ({ multipv, move, score, depth: 12, pv });

// White knight b5 can fork king e8 + rook a8 with Nc7+.
const FORK = legalFen('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1');
const FORK_PV = ['b5c7', 'e8d7', 'c7a8', 'd7c6', 'e1e2', 'c6b7'];

describe('narrationPlies', () => {
  it('narrates the minimum on a quiet line', () => {
    const fen = legalFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(narrationPlies(fen, ['g1f3', 'g8f6', 'b1c3', 'b8c6', 'e2e3', 'e7e6', 'f1e2', 'f8e7'], S)).toBe(S.explain.shortLineMinPlies);
  });

  it('stops at the payoff: the first quiet point after the decisive capture', () => {
    // 1.Nc7+ Kd7 2.Nxa8: nothing is en prise any more -> the story ends with the rook won
    expect(narrationPlies(FORK, FORK_PV, S)).toBe(3);
  });

  it('runs to a mate that fits', () => {
    const fen = legalFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    expect(narrationPlies(fen, ['a1a8'], S, { mate: 1 })).toBe(1);
  });

  it('cuts illegal tails', () => {
    expect(narrationPlies(FORK, ['b5c7', 'a1a2'], S)).toBe(1);
  });
});

describe('narrateLine', () => {
  it('fork line: step facts, forced reply, material result', () => {
    const forced = new Map([[1, { forced: true, alternatives: 3 }]]);
    const { line, forcedReplies } = narrateLine(FORK, FORK_PV, { settings: S, forced, plies: 4 });
    expect(line.steps.map((s) => s.san)).toEqual(['Nc7+', 'Kd7', 'Nxa8', 'Kc6']);
    expect(line.steps[0]!.facts[0]).toMatchObject({ type: 'fork' });
    expect(line.steps[1]!.forced).toBe(true);
    expect(line.steps[2]!.facts.some((f) => f.type === 'capture')).toBe(true);
    expect(forcedReplies).toEqual([{ type: 'forced-reply', san: 'Kd7', alternatives: 3 }]);
    expect(line).toMatchObject({ result: 'wins-material', materialDelta: 5, won: ['rook'] });
    expect(line.lost).toBeUndefined();
  });

  it('a forced flag on a mover ply is ignored', () => {
    const { line } = narrateLine(FORK, FORK_PV, { settings: S, forced: new Map([[0, { forced: true, alternatives: 0 }]]), plies: 2 });
    expect(line.steps[0]!.forced).toBeUndefined();
  });

  it('mate results come from the score or the board', () => {
    const fen = legalFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    const { line } = narrateLine(fen, ['a1a8'], { settings: S });
    expect(line).toMatchObject({ result: 'mate', mateIn: 1 });
    expect(line.steps[0]!.facts[0]).toEqual({ type: 'checkmate' });
    const mated = narrateLine(legalFen('6k1/8/8/8/8/8/5PPP/r5K1 w - - 0 1'), ['h2h3'], { settings: S, score: { mate: -3 } });
    expect(mated.line).toMatchObject({ result: 'mated', mateIn: 3 });
  });

  it('even trade -> trade with no net pieces', () => {
    const fen = legalFen('3q1rk1/ppp2ppp/8/8/8/8/PPP2PPP/R2Q1RK1 w - - 0 1');
    const { line } = narrateLine(fen, ['d1d8', 'f8d8', 'a1d1', 'd8d1', 'f1d1', 'g8f8'], { settings: S });
    expect(line.result).toBe('trade');
    expect(line.materialDelta).toBe(0);
    expect(line.won).toBeUndefined();
  });

  it('losing line reports what was lost (queen for a pawn)', () => {
    const fen = legalFen('r5k1/ppp2pp1/7p/8/8/2N2N2/PPPQ1PPP/4R1K1 w - - 0 1');
    const { line } = narrateLine(fen, ['d2g5', 'h6g5', 'f3g5', 'a8d8', 'g5e4', 'd8d4'], { settings: S });
    expect(line).toMatchObject({ result: 'loses-material', materialDelta: -8, won: ['pawn'], lost: ['queen'] });
  });
});

describe('forcedness', () => {
  it('checks odd plies within the forcedness budget, only where the reply answers pressure', () => {
    // Kd7 answers the check; Kc6 and Kb7 answer nothing (no black piece is attacked, no mate threat)
    const checks = forcednessChecks(FORK, FORK_PV, 6, S);
    expect(checks.map((c) => c.index)).toEqual([1]);
    expect(checks[0]).toMatchObject({ uci: 'e8d7', fen: playUci(FORK, ['b5c7']) });
    expect(checks[0]!.legalMoves).toBe(5); // Kd7 Kd8 Ke7 Kf7 Kf8
  });

  it('forced when the 2nd best is much worse; not when close or when the PV move is not #1', () => {
    const c = { index: 1, fen: playUci(FORK, ['b5c7']), uci: 'e8d7', legalMoves: 4 };
    const lines = [pvLine('e8d7', { cp: -500 }), pvLine('e8e7', { cp: -900 }, ['e8e7'], 2)];
    expect(forcedFromSearch(c, lines, S)).toEqual({ forced: true, alternatives: 3 });
    expect(forcedFromSearch(c, [lines[0]!, pvLine('e8e7', { cp: -520 }, ['e8e7'], 2)], S).forced).toBe(false);
    expect(forcedFromSearch(c, [lines[1]!, lines[0]!], S).forced).toBe(false);
    expect(forcedFromSearch({ ...c, legalMoves: 1 }, [], S)).toEqual({ forced: true, alternatives: 0 });
  });
});

describe('null move + threat', () => {
  it('no null move after a check; otherwise the side to move flips and ep is cleared', () => {
    expect(nullMoveFen(playUci(FORK, ['b5c7']))).toBeNull();
    const after = playUci(legalFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'), ['e2e4']);
    expect(nullMoveFen(after)).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1');
  });

  it('fork threat with verified gain', () => {
    // after 1.Ke2 (quiet), White threatens Nc7+ forking king and rook
    const nf = nullMoveFen(playUci(legalFen('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1'), ['e1e2']))!;
    const t = threatFromSearch(nf, { lines: [pvLine('b5c7', { cp: 600 }, ['b5c7', 'e8d7', 'c7a8'])] });
    expect(t).toMatchObject({ type: 'threat', move: 'b5c7', san: 'Nc7+', gain: 5 });
    expect(t!.facts.map((f) => f.type)).toContain('fork');
  });

  it('mate threat', () => {
    const nf = nullMoveFen(playUci(legalFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1'), ['g1f1']))!;
    expect(threatFromSearch(nf, { lines: [pvLine('a1a8', { mate: 1 })] })).toMatchObject({ san: 'Ra8#', mateIn: 1 });
  });

  it('no threat: quiet first move (a plan, not a threat) or no gain', () => {
    const nf = nullMoveFen(playUci(FORK, ['e1e2']))!;
    expect(threatFromSearch(nf, { lines: [pvLine('e2d3', { cp: 600 }, ['e2d3', 'a8a1', 'b5c7'])] })).toBeNull();
    expect(threatFromSearch(nf, { lines: [pvLine('b5d4', { cp: 0 }, ['b5d4'])] })).toBeNull();
    expect(threatFromSearch(nf, { lines: [] })).toBeNull();
  });
});

describe('long-term facts', () => {
  const base = { settings: S, legalMoves: 20, secondBestLoss: 1, isBest: true, immediate: [] as Fact[], lineMaterialDelta: 0 };

  it('positional deltas of the move, plus structure at the line end', () => {
    // 1.Bxc6 dxc6: White giving up the bishop pair is big (kept at the line end); Black's doubled c-pawns are not
    // isolated (the b-pawn is next to them) -> a small structure change, dropped at the line end
    const fen = legalFen('r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1');
    const after = playUci(fen, ['b5c6']);
    const end = playUci(fen, ['b5c6', 'd7c6']);
    const fs = positionalFacts({ fenBefore: fen, fenAfter: after, lineEndFen: end, mover: 'white', immediate: [] });
    expect(fs.some((f) => f.feature === 'bishop-pair' && f.side === 'own' && f.at === 'line-end')).toBe(true);
    expect(fs.some((f) => f.feature === 'doubled-pawn')).toBe(false);
  });

  it('positional-gain: material given up without the eval dropping (gambit)', () => {
    const fen = legalFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    const gambit: Fact[] = [{ type: 'hangs', piece: { role: 'pawn', square: 'f4', color: 'white' }, loss: 1 }];
    const fs = longTermFacts({ ...base, immediate: gambit, fenBefore: fen, fenAfter: fen, lineEndFen: fen, mover: 'white', lineMaterialDelta: -1, score: { cp: 20 }, bestScore: { cp: 30 } });
    expect(fs).toContainEqual({ type: 'positional-gain', cp: 90 });
    // the same line without giving anything up (the pawn just falls in the engine line): not 'compensation'
    const quiet = longTermFacts({ ...base, fenBefore: fen, fenAfter: fen, lineEndFen: fen, mover: 'white', lineMaterialDelta: -1, score: { cp: 20 }, bestScore: { cp: 30 } });
    expect(quiet.some((f) => f.type === 'positional-gain')).toBe(false);
    // hanging the queen at +18: the eval really drops -> no "compensation" (unclamped cp)
    const hung = longTermFacts({ ...base, immediate: [{ type: 'hangs', piece: { role: 'queen', square: 'g5', color: 'white' }, loss: 8 }], fenBefore: fen, fenAfter: fen, lineEndFen: fen, mover: 'white', lineMaterialDelta: -8, score: { cp: 900 }, bestScore: { cp: 1820 } });
    expect(hung.some((f) => f.type === 'positional-gain')).toBe(false);
  });

  it('deep-payoff, necessary, nothing-notable', () => {
    const fen = legalFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    const common = { ...base, fenBefore: fen, fenAfter: fen, lineEndFen: fen, mover: 'white' as const, score: { cp: 100 }, bestScore: { cp: 100 } };
    expect(longTermFacts({ ...common, shallowScore: { cp: -100 } })).toEqual([{ type: 'deep-payoff' }]);
    expect(longTermFacts({ ...common, shallowScore: { cp: 90 } })).toEqual([{ type: 'nothing-notable' }]);
    expect(longTermFacts({ ...common, secondBestLoss: 25 })).toEqual([{ type: 'necessary' }]);
    expect(longTermFacts({ ...common, isBest: false, legalMoves: 1 })).toEqual([{ type: 'necessary', onlyMove: true }]);
  });
});
