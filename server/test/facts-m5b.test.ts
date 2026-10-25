// M5b fact types and wording: castling rights, attacking a pinned piece, trapped pieces, desperado, checking forks
// shown by the line, prophylaxis ('prevents'), mate lines for allowed / missed mates, sacrifices in the story.
import { DEFAULT_SETTINGS, type Fact } from '@chess-coach/shared';
import { describe, expect, it } from 'vitest';
import { addLineFork, hangsAfterReply, moverWins, stillEnPrise, targetHitsBack, verifyWithLine } from '../src/analysis/analyzeMove';
import { betterReasons, labelText, lineText, renderExplanation } from '../src/analysis/explain';
import { immediateFacts } from '../src/facts/immediate';
import { mateLineSan, narrateLine, preventsFact, pvFork, refutationFact, threatFromSearch } from '../src/facts/line';
import { castlingLostInLine } from '../src/facts/longterm';
import { legalFen } from './helpers/classifyHelpers';

const S = DEFAULT_SETTINGS;
const W = { mover: 'white' as const };
const B = { mover: 'black' as const };
const pv = (s: string) => s.split(' ');
const of = <T extends Fact['type']>(facts: readonly Fact[], t: T) => facts.filter((f): f is Extract<Fact, { type: T }> => f.type === t);
const text = (facts: Fact[], ctx: { mover: 'white' | 'black'; label?: 'blunder' | 'miss' | 'best' } = W) =>
  renderExplanation({ immediate: facts, short: [], long: [] }, ctx).immediate.text;

describe('castling-lost', () => {
  it('a king move gives up both castling rights', () => {
    const fen = legalFen('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
    const f = immediateFacts(fen, 'e1e2');
    expect(of(f, 'castling-lost')).toEqual([{ type: 'castling-lost', color: 'white', sides: ['king', 'queen'] }]);
    expect(text(f)).toContain('White gives up the right to castle.');
  });

  it('a rook move that gives up the last right; not one that keeps a right; not castling', () => {
    const fen = legalFen('r3k2r/8/8/8/8/8/8/R3K2R w Kkq - 0 1');
    expect(of(immediateFacts(fen, 'h1g1'), 'castling-lost')).toHaveLength(1);
    expect(of(immediateFacts(fen, 'a1b1'), 'castling-lost')).toHaveLength(0);
    expect(of(immediateFacts(fen, 'e1g1'), 'castling-lost')).toHaveLength(0);
  });

  it('not in an endgame without enemy attacking material', () => {
    expect(of(immediateFacts(legalFen('4k3/8/8/8/8/8/8/R3K3 w Q - 0 1'), 'e1d2'), 'castling-lost')).toHaveLength(0);
  });

  it('stepping out of check with the king says it in one sentence', () => {
    // 1.e4 e5 2.Qh5 Nc6 3.Bc4 d6?? 4.Qxf7+ is mate; use 3...Ke7-like: a check the king must answer
    const fen = legalFen('rnbqkbnr/pppp1Bpp/8/4p3/4P3/8/PPPP1PPP/RNBQK1NR b KQkq - 0 3');
    const f = immediateFacts(fen, 'e8e7');
    expect(text(f, B)).toContain('Steps out of check with the king — Black can no longer castle.');
    expect(text(f, B).join(' ')).not.toContain('gives up the right');
  });

  it('line end: a king driven out during the line (Bxf7+ Kxf7)', () => {
    const after = legalFen('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 3');
    const end = legalFen('r1bq1bnr/pppp1kpp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQ - 0 5');
    expect(castlingLostInLine(after, end)).toEqual([{ type: 'castling-lost', color: 'black', sides: ['king', 'queen'], at: 'line-end' }]);
    const long = renderExplanation({ immediate: [], short: [], long: castlingLostInLine(after, end) }, W).long.text;
    expect(long).toEqual(["After these moves, Black's king can no longer castle."]);
  });
});

describe('attack-pinned', () => {
  // the knight on e5 is pinned to the king by the rook on e1; d4 attacks it again — it can't step away
  const FEN = legalFen('4k3/8/3p4/4n3/8/8/3P4/4R1K1 w - - 0 1');
  it('adding an attacker to a pinned piece that can now be won', () => {
    const f = immediateFacts(FEN, 'd2d4');
    expect(of(f, 'attack-pinned')).toEqual([{
      type: 'attack-pinned',
      attacker: { role: 'pawn', square: 'd4', color: 'white' },
      pinned: { role: 'knight', square: 'e5', color: 'black' },
      pinner: { role: 'rook', square: 'e1', color: 'white' },
      behind: { role: 'king', square: 'e8', color: 'black' },
      absolute: true,
    }]);
    expect(of(f, 'attack')).toHaveLength(0); // covered
    expect(text(f)).toEqual(["Attacks Black's knight on e5 once more — it can't step away (it is pinned to the king), so White now threatens to win it."]);
  });

  it('not when the piece could already be won, nor for a new pin', () => {
    // without the d6 defender Rxe5 already wins the knight
    expect(of(immediateFacts(legalFen('4k3/8/8/4n3/8/8/3P4/4R1K1 w - - 0 1'), 'd2d4'), 'attack-pinned')).toHaveLength(0);
    // Re1 makes the pin itself: that is a 'pin' fact, not attack-pinned
    expect(of(immediateFacts(legalFen('4k3/8/3p4/4n3/3P4/8/8/R5K1 w - - 0 1'), 'a1e1'), 'attack-pinned')).toHaveLength(0);
  });
});

describe('trapped', () => {
  // b4 attacks the knight on a5: b3 (a2), c4 (d3), c6 (d5) and b7 (Ba6) are all covered
  const FEN = legalFen('7k/8/B7/n2P4/8/3P4/PP6/6K1 w - - 0 1');
  it('an attacked piece with no safe square', () => {
    const f = immediateFacts(FEN, 'b2b4');
    expect(of(f, 'trapped')).toEqual([{ type: 'trapped', piece: { role: 'knight', square: 'a5', color: 'black' }, attacker: { role: 'pawn', square: 'b4', color: 'white' } }]);
    expect(of(f, 'attack')).toHaveLength(0);
    expect(text(f)).toEqual(["Traps Black's knight on a5: it is attacked, and every square it could move to is covered too."]);
  });

  it('not when it has a safe square', () => {
    // without the bishop on a6, Nb7 is safe
    expect(of(immediateFacts(legalFen('7k/8/8/n2P4/8/3P4/PP6/6K1 w - - 0 1'), 'b2b4'), 'trapped')).toHaveLength(0);
  });

  it('kept only when the engine line wins the piece (followed if it moves)', () => {
    expect(moverWins(FEN, pv('b2b4 a5c4 d3c4'), 'a5')).toBe(true);
    expect(moverWins(FEN, pv('b2b4 a5c4 g1f2'), 'a5')).toBe(false);
  });
});

describe('desperado', () => {
  it('a trapped piece that takes something before it is lost', () => {
    // the bishop on a7 is attacked by the rook and Bb8 is covered: Bxb6 cxb6 is better than losing it for nothing
    const f = immediateFacts(legalFen('r5k1/B1p5/1p6/8/8/8/8/6K1 w - - 0 1'), 'a7b6');
    const cap = of(f, 'capture')[0]!;
    expect(cap).toMatchObject({ outcome: 'loses-material', net: -2, desperado: true });
    expect(text(f)[0]).toBe("Takes Black's pawn on b6 as a desperado: the capturing piece was attacked and had no safe square, so it takes something before it is lost (−2 points after the exchange).");
  });

  it('a plain losing capture is no desperado', () => {
    const cap = of(immediateFacts(legalFen('6k1/2p5/1p6/8/3B4/8/8/6K1 w - - 0 1'), 'd4b6'), 'capture')[0]!;
    expect(cap.outcome).toBe('loses-material');
    expect(cap.desperado).toBeUndefined();
  });
});

describe('checking forks shown by the line', () => {
  it('pvFork: check + attack, the reply, then the capture', () => {
    const fen = legalFen('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1');
    expect(pvFork(fen, pv('b5c7 e8d7 c7a8'))).toMatchObject({
      type: 'fork',
      attacker: { role: 'knight', square: 'c7' },
      targets: [{ role: 'king', square: 'e8' }, { role: 'rook', square: 'a8' }],
      followUp: { reply: 'Kd7', capture: 'Nxa8', kingMustMove: true },
    });
    // the line doesn't take the rook: no fork claimed from the line
    expect(pvFork(fen, pv('b5c7 e8d7 c7b5'))).toBeNull();
  });

  it('a checking knight that the board test rejects (the queen could hit back) but the line carries out', () => {
    // Nf6+ attacks the king on g8 and the queen on d7; after Kh8 Nxd7 the queen is gone
    const fen = legalFen('6k1/3q1ppp/8/7N/8/8/5PPP/6K1 w - - 0 1');
    const facts = immediateFacts(fen, 'h5f6');
    addLineFork(facts, fen, pv('h5f6 g7f6 g1f1'));
    expect(of(facts, 'fork')).toHaveLength(0); // gxf6 takes the knight: no fork
    const facts2 = immediateFacts(legalFen('6k1/3q1p1p/8/7N/8/8/5PPP/6K1 w - - 0 1'), 'h5f6');
    addLineFork(facts2, legalFen('6k1/3q1p1p/8/7N/8/8/5PPP/6K1 w - - 0 1'), pv('h5f6 g8g7 f6d7'));
    const fk = of(facts2, 'fork')[0]!;
    expect(fk.followUp).toEqual({ reply: 'Kg7', capture: 'Nxd7', kingMustMove: true });
    expect(text(facts2)).toHaveLength(1); // the check is implied by the fork
    expect(text(facts2)[0]).toBe("Fork with check: the knight on f6 attacks Black's king and queen on d7 — the king must move, then Nxd7 takes the queen.");
  });

  it('the story says "forks" for such a step', () => {
    const fen = legalFen('6k1/3q1p1p/8/7N/8/8/5PPP/6K1 w - - 0 1');
    const { line } = narrateLine(fen, pv('h5f6 g8g7 f6d7'), { settings: S, plies: 3 });
    expect(lineText(line, W)).toMatch(/^Nf6\+ forks the king and queen → Kg7 attacks the knight → Nxd7 wins the queen/);
  });
});

describe('prevents (prophylaxis)', () => {
  const FEN = legalFen('4k3/8/2n5/8/8/8/P7/4K3 w - - 0 1');
  const nullSearch = { lines: [{ multipv: 1, move: 'c6b4', score: { cp: 200 }, depth: 12, pv: ['c6b4'] }] };
  it("the opponent's best idea now loses material on its square", () => {
    const f = preventsFact({ fenBefore: FEN, uci: 'a2a3', nullSearch, score: { cp: -10 } });
    expect(f).toEqual({ type: 'prevents', move: 'c6b4', san: 'Nb4', square: 'b4', reason: 'covered', by: { role: 'pawn', square: 'a3', color: 'white' } });
    expect(text([f!])).toEqual(["Prevents Nb4, Black's best idea here (what Black would play if White passed): the pawn on a3 now covers b4."]);
  });

  it('not when the idea is worth little, still works, or the position is decided', () => {
    expect(preventsFact({ fenBefore: FEN, uci: 'a2a3', nullSearch, score: { cp: -100 } })).toBeNull();
    expect(preventsFact({ fenBefore: FEN, uci: 'a2a4', nullSearch, score: { cp: -10 } })).toBeNull();
    expect(preventsFact({ fenBefore: FEN, uci: 'a2a3', nullSearch: { lines: [{ ...nullSearch.lines[0]!, score: { cp: 900 } }] }, score: { cp: -800 } })).toBeNull();
  });

  it('an occupied square', () => {
    const fen = legalFen('4k3/8/2n5/8/8/8/1N6/4K3 w - - 0 1');
    const f = preventsFact({ fenBefore: fen, uci: 'b2d3', nullSearch: { lines: [{ multipv: 1, move: 'c6d4', score: { cp: 200 }, depth: 12, pv: ['c6d4'] }] }, score: { cp: 0 } });
    // Nd3 doesn't occupy d4 — but it covers it? no: a knight on d3 doesn't attack d4 → no fact
    expect(f).toBeNull();
    const g = preventsFact({ fenBefore: fen, uci: 'b2c4', nullSearch: { lines: [{ multipv: 1, move: 'c6b4', score: { cp: 200 }, depth: 12, pv: ['c6b4'] }] }, score: { cp: 0 } });
    expect(g).toBeNull(); // Nc4 doesn't cover b4 either
  });
});

describe('mate lines', () => {
  it('mateLineSan: only a line that ends in checkmate on the board', () => {
    expect(mateLineSan(legalFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1'), pv('a1a8'), 1)).toEqual(['Ra8#']);
    expect(mateLineSan(legalFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1'), pv('a1a7'), 1)).toBeNull();
  });

  it('allowed mate states the moves', () => {
    const allows: Fact = { type: 'allows', reply: { san: 'Qb8+', uci: 'b5b8' }, facts: [{ type: 'check' }], mateIn: 2, mateLine: ['Qb8+', 'Nxb8', 'Rd8#'] };
    expect(text([allows, { type: 'allows-mate', inMoves: 2 }], { mover: 'black', label: 'blunder' })).toEqual(['Allows a forced mate in 2: Qb8+ Nxb8 Rd8#.']);
    expect(text([{ type: 'allows-mate', inMoves: 2, line: ['Qb8+', 'Nxb8', 'Rd8#'] }], { mover: 'black', label: 'blunder' })).toEqual(['Allows a forced mate in 2: Qb8+ Nxb8 Rd8#.']);
  });

  it('missed mate leads the Immediate level', () => {
    const f: Fact[] = [{ type: 'misses-mate', mateIn: 2, best: 'Qxf7+', line: ['Qxf7+', 'Kh8', 'Qg8#'] }, { type: 'check' }];
    expect(text(f, { mover: 'white', label: 'miss' })[0]).toBe('Misses a forced mate in 2: Qxf7+ Kh8 Qg8#.');
    expect(text([{ type: 'misses-mate', mateIn: 1, best: 'Qg8#', line: ['Qg8#'] }], { mover: 'white', label: 'miss' })).toEqual(['Misses checkmate in one: Qg8#.']);
  });
});

describe('positional / quiet mistakes', () => {
  const threat: Fact = { type: 'threat', move: 'f6e8', san: 'Nf6+', gain: 2, facts: [{ type: 'discovered-attack', moved: { role: 'knight', square: 'f6', color: 'white' }, attacker: { role: 'queen', square: 'e2', color: 'white' }, target: { role: 'rook', square: 'e8', color: 'black' } }] };
  const render = (imm: Fact[], long: Fact[] = []) => renderExplanation({ immediate: imm, short: [], long }, { mover: 'white', label: 'inaccuracy' }).immediate.text;

  it("a bad move with nothing else to say names what the engine's move does instead", () => {
    expect(render([{ type: 'misses', san: 'Rfe1', uci: 'f1e1', facts: [threat] }])).toEqual(["Misses Rfe1, which threatens Nf6+, uncovering an attack on Black's rook on e8 (+2 points)."]);
  });

  it('no reason found: honest fallback; a long-term drawback is pointed to', () => {
    expect(render([{ type: 'misses', san: 'g3', uci: 'g2g3', facts: [] }])).toEqual(['No tactical problem right away — the engine prefers g3 for long-term reasons that are hard to put into words.']);
    const exposed: Fact = { type: 'positional', feature: 'king-safety', delta: -1, side: 'own', detail: 'shield 3->2', squares: ['g1'] };
    expect(render([{ type: 'misses', san: 'g3', uci: 'g2g3', facts: [] }], [exposed])[0]).toMatch(/drawback is long-term/);
  });

  it('the misses sentence leads a bad move that only does good things; not when a negative fact explains it', () => {
    expect(render([{ type: 'check' }, { type: 'misses', san: 'Rfe1', uci: 'f1e1', facts: [threat] }])).toEqual(["Misses Rfe1, which threatens Nf6+, uncovering an attack on Black's rook on e8 (+2 points).", 'Gives check.']);
    const hang: Fact = { type: 'hangs', piece: { role: 'knight', square: 'c3', color: 'white' }, loss: 3 };
    expect(render([hang, { type: 'misses', san: 'Rfe1', uci: 'f1e1', facts: [threat] }])).toEqual(['Leaves the knight on c3 hanging: Black can win it (−3 points).']);
    expect(render([{ type: 'check' }, { type: 'misses', san: 'g3', uci: 'g2g3', facts: [] }])).toEqual(['Gives check.']);
    const good = renderExplanation({ immediate: [{ type: 'misses', san: 'g3', uci: 'g2g3', facts: [] }], short: [], long: [] }, { mover: 'white', label: 'good' }).immediate.text;
    expect(good).toEqual(['Nothing special happens right away.']);
  });

  it('quiet reasons of the better move (development, castling, long-term) — only without a tactical one', () => {
    const develop: Fact = { type: 'develop', piece: { role: 'knight', square: 'f3', color: 'white' } };
    const castle: Fact = { type: 'castle', side: 'king' };
    expect(betterReasons([develop], [], 'white')).toEqual(['develops the knight']);
    expect(betterReasons([castle, develop], [{ type: 'develop', piece: { role: 'bishop', square: 'c4', color: 'white' } }], 'white')).toEqual(['castles kingside']);
    expect(betterReasons([develop, threat], [], 'white')).toEqual(["threatens Nf6+, uncovering an attack on Black's rook on e8 (+2 points)"]);
    const passed: Fact = { type: 'positional', feature: 'passed-pawn', delta: 1, side: 'own', squares: ['d5'] };
    expect(betterReasons([passed], [], 'white')).toEqual(['creates a passed pawn on d5']);
    expect(betterReasons([passed], [passed], 'white')).toEqual([]);
  });

  it('a quiet refutation whose line costs material (vs the best line) is still named, neutrally', () => {
    const fen = legalFen('4k3/p7/8/8/8/8/8/4K2R w K - 0 1');
    const line: Extract<Fact, { type: 'line' }> = { type: 'line', steps: [], materialDelta: -3, result: 'loses-material' };
    const allows = refutationFact({ fenBefore: fen, uci: 'e1f1', pv: pv('e1f1 a7a6'), line, bestLineDelta: 0 });
    expect(allows).toMatchObject({ type: 'allows', reply: { san: 'a6' }, gain: 3 });
    expect(renderExplanation({ immediate: [allows!], short: [], long: [] }, { mover: 'white', label: 'mistake' }).immediate.text).toEqual(['After a6, the engine line costs White 3 points of material (see the short term).']);
    // the best line loses as much: not this move's fault
    expect(refutationFact({ fenBefore: fen, uci: 'e1f1', pv: pv('e1f1 a7a6'), line, bestLineDelta: -2 })).toBeNull();
  });
});

describe('story details', () => {
  it('a "trapped" step is told only when the line then wins the piece', () => {
    const fen = legalFen('7k/8/B7/n2P4/8/3P4/PP6/6K1 w - - 0 1');
    const won = narrateLine(fen, pv('b2b4 h8g8 b4a5'), { settings: S, plies: 3 }).line;
    expect(won.steps[0]!.facts.some((f) => f.type === 'trapped')).toBe(true);
    const notWon = narrateLine(fen, pv('b2b4 h8g8 g1f2'), { settings: S, plies: 3 }).line;
    expect(notWon.steps[0]!.facts.some((f) => f.type === 'trapped')).toBe(false);
  });

  it('a quiet last step after hidden steps is dropped; the result follows "…"', () => {
    const step = (ply: number, san: string, facts: Fact[] = []) => ({ ply, san, uci: 'a1a2', color: (ply % 2 ? 'white' : 'black') as 'white' | 'black', facts });
    const cap: Fact = { type: 'capture', captured: { role: 'pawn', square: 'a7', color: 'black' }, outcome: 'wins-material', net: 1 };
    const line: Extract<Fact, { type: 'line' }> = { type: 'line', steps: [step(1, 'm1'), step(2, 'm2'), step(3, 'm3', [cap]), step(4, 'm4'), step(5, 'm5'), step(6, 'm6')], materialDelta: 1, result: 'wins-material', won: ['pawn'] };
    expect(lineText(line, W)).toBe('m1 → m2 → m3 wins the pawn → … → White wins a pawn (+1 point).');
  });
});

describe('round 5 regressions', () => {
  it('a capture that wins a piece outright is named, with the right gain (Qxa1+ wins the rook, not "+3 fork")', () => {
    const nf = legalFen('4k3/8/8/8/8/2N5/1q6/R3K2R b KQ - 0 1');
    const t = threatFromSearch(nf, { lines: [{ multipv: 1, move: 'b2a1', score: { cp: 500 }, depth: 12, pv: ['b2a1', 'e1e2'] }] })!;
    expect(t.gain).toBe(5);
    expect(text([t], B)).toEqual(['Threatens Qxa1+, winning a rook (+5 points).']);
  });

  it('a fork threat is worth what the second target nets after recaptures (round 6: Nc3 vs Qe4 + defended Rb1)', () => {
    const nf = legalFen('5r1k/6pp/8/3n4/4Q3/8/8/RR4K1 b - - 0 1');
    const t = threatFromSearch(nf, { lines: [{ multipv: 1, move: 'd5c3', score: { cp: 200 }, depth: 12, pv: pv('d5c3 e4e3 c3b1 a1b1') }] })!;
    expect(t.facts.some((f) => f.type === 'fork')).toBe(true);
    expect(t.gain).toBe(2);
  });

  it('no discovered attack on a piece that simply takes the attacker', () => {
    expect(of(immediateFacts(legalFen('3k4/4q3/8/8/4N3/8/8/4R1K1 w - - 0 1'), 'e4c3'), 'discovered-attack')).toHaveLength(0);
  });

  it('a pin the opponent ignores at once is dropped; an escape the reply attacks again too', () => {
    const fen = legalFen('rnbqkb1r/pppp1ppp/5n2/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 2 3');
    const pin: Fact = { type: 'pin', pinner: { role: 'bishop', square: 'g5', color: 'white' }, pinned: { role: 'knight', square: 'f6', color: 'black' }, behind: { role: 'queen', square: 'd8', color: 'black' }, absolute: false };
    expect(verifyWithLine([pin], fen, pv('h2h3 f6e4'))).toEqual([]);
    expect(verifyWithLine([pin], fen, pv('h2h3 b8c6'))).toEqual([pin]);
    // …Nh4 "saved" the knight, but Kh3 attacks it again
    expect(hangsAfterReply(legalFen('6k1/8/8/5n2/8/8/7K/8 b - - 0 1'), pv('f5h4 h2h3'), 'h4')).toBe(true);
  });

  it('a threat counts as stopped only if the threatened piece is safe now', () => {
    expect(stillEnPrise(legalFen('6k1/8/8/3b4/8/8/8/3R2K1 w - - 0 1'), 'd1d5')).toBe(true);
    expect(stillEnPrise(legalFen('6k1/8/4p3/3b4/8/8/8/3R2K1 w - - 0 1'), 'd1d5')).toBe(false);
  });

  it('wording: under-protected pieces, threats that were already there, half-open files, mates the label names', () => {
    expect(text([{ type: 'hangs', piece: { role: 'knight', square: 'e5', color: 'white' }, loss: 1 }])).toEqual(['Leaves the knight on e5 under-protected: Black wins material by taking on e5 (−1 point).']);
    const threat: Fact = { type: 'threat', move: 'h7a7', san: 'Rxa7', gain: 1, facts: [{ type: 'capture', captured: { role: 'pawn', square: 'a7', color: 'black' }, outcome: 'wins-material', net: 1 }] };
    const allows: Fact = { type: 'allows', reply: { san: 'Kh2', uci: 'g1h2' }, facts: [threat], targets: [{ role: 'pawn', square: 'a7', color: 'black' }], gain: 1, already: true, keepsThreat: true };
    expect(text([allows], { mover: 'black', label: 'miss' })).toEqual(["Doesn't deal with White's threat Rxa7, winning a pawn (+1 point for White)."]);
    expect(betterReasons([{ type: 'positional', feature: 'open-file-rook', delta: 1, side: 'own', detail: '0->1', squares: ['e8'] }], [], 'black')).toEqual(['gives the rook on e8 a file without its own pawns']);
    const lt = labelText({
      label: 'blunder', color: 'white', uci: 'f5e6', san: 'fxe6', bestSan: 'Rf8', bestUci: 'f1f8',
      labelReason: { winChance: 'mistake', material: { playedLine: -8, bestLine: 0, loss: 8, evalDropCp: 900, label: 'blunder' } },
      evalBefore: { cp: 200 }, evalAfter: { mate: -7 }, winBefore: 68, winAfter: 0, winLoss: 50,
    }, S);
    expect(lt).toMatch(/^Blunder \?\? — fxe6 allows a forced mate in 7\./);
  });
});

describe('round 6 regressions', () => {
  it('a trade on one square cancels first: the piece really lost is named (57RP5sCb 13...Nxd4)', () => {
    const fen = legalFen('r2qr1k1/pbp2ppp/1pn2n2/8/3PN3/5NP1/PP2QPBP/R3R1K1 b - - 2 13');
    const { line } = narrateLine(fen, pv('c6d4 e4f6 g7f6 e2e8 d8e8 e1e8 a8e8 f3d4 b7g2 g1g2'), { settings: S, plies: 10 });
    expect(lineText(line, B)).toMatch(/Black gives a knight for a pawn \(−2 points\)\.$/);
    // YMOxEowk 19...Ne6: N for B on e6, then the c8 bishop goes
    const fen2 = legalFen('r1b1R3/ppp2pkp/5p2/8/2Bn4/8/P4PPP/3R2K1 b - - 2 19');
    const l2 = narrateLine(fen2, pv('d4e6 c4e6 f7e6 d1d8 c7c6 d8c8 a8c8 e8c8'), { settings: S, plies: 8 }).line;
    expect(lineText(l2, B)).toMatch(/Black loses a bishop \(−3 points\)\.$/);
  });

  it('no SEE recapture is assumed when the engine line goes on without it (FroOipnY 23.Rf2)', () => {
    const fen = legalFen('r4rk1/2nq2b1/3pp3/1pp3B1/6P1/1Q1P4/PP5N/R4RK1 w - - 0 23');
    const full = pv('f1f2 g7d4 a1f1 d7h7 g1g2 f8f2 f1f2 d4f2 h2f3 a8f8 b3d1 f2d4');
    const { line } = narrateLine(fen, full, { settings: S, plies: 8 });
    expect(line.materialDelta).toBe(-5);
    expect(lineText(line, W)).toMatch(/White loses a rook \(−5 points\)\.$/);
  });

  it('a threat whose target can take back only at a loss is still a threat (Bf1 hitting the queen on c4)', () => {
    const t: Extract<Fact, { type: 'threat' }> = { type: 'threat', move: 'f1c4', san: 'Bxc4', gain: 6, facts: [] };
    // queen c4 can take f1 but the rook recaptures: still a threat
    expect(targetHitsBack(legalFen('3k4/8/8/8/2q5/8/8/4RBK1 b - - 0 1'), t)).toBe(false);
  });

  it('a capture both moves make is no reason; the fallback names a line that loses material', () => {
    const cap: Fact = { type: 'capture', captured: { role: 'pawn', square: 'g5', color: 'white' }, outcome: 'wins-material', net: 1 };
    expect(betterReasons([cap], [cap], 'black')).toEqual([]);
    const lost: Extract<Fact, { type: 'line' }> = { type: 'line', steps: [], materialDelta: -2, result: 'loses-material' };
    const t = renderExplanation({ immediate: [{ type: 'misses', san: 'Rae8', uci: 'a8e8', facts: [] }], short: [lost], long: [] }, { mover: 'black', label: 'mistake' }).immediate.text;
    expect(t).toEqual(['Nothing is lost right away, but the engine line costs Black 2 points (see the short term); the engine prefers Rae8.']);
  });
});

describe('round 7 regressions', () => {
  it('a piece already pinned by another rook is not "pinned" again: the move adds an attacker (YMOxEowk Rdd8)', () => {
    const f = immediateFacts(legalFen('r1b1R3/6k1/8/8/8/8/8/3R2K1 w - - 0 1'), 'd1d8');
    expect(of(f, 'pin')).toHaveLength(0);
    expect(of(f, 'attack-pinned')).toMatchObject([{ attacker: { square: 'd8' }, pinned: { square: 'c8' }, pinner: { square: 'e8' }, behind: { square: 'a8' } }]);
  });

  it('an under-protected piece is not mentioned when the line loses nothing', () => {
    const hang: Fact = { type: 'hangs', piece: { role: 'knight', square: 'e5', color: 'white' }, loss: 1 };
    const level: Extract<Fact, { type: 'line' }> = { type: 'line', steps: [], materialDelta: 0, result: 'trade' };
    expect(renderExplanation({ immediate: [hang], short: [level], long: [] }, { mover: 'white', label: 'best' }).immediate.text).toEqual(['Nothing special happens right away.']);
  });
});

describe('no false "No forcing follow-up."', () => {
  it('a story without facts says the engine line goes on with a check', () => {
    const step = (ply: number, san: string) => ({ ply, san, uci: 'a1a2', color: (ply % 2 ? 'black' : 'white') as 'white' | 'black', facts: [] as Fact[] });
    const line: Extract<Fact, { type: 'line' }> = { type: 'line', steps: [step(1, 'Re3'), step(2, 'Rgh2'), step(3, 'Kf7')], materialDelta: 0, result: 'quiet', nextForcing: 'Rh7+' };
    expect(lineText(line, B)).toBe('Re3 → Rgh2 → Kf7; the engine line then goes on with Rh7+.');
    expect(lineText({ ...line, nextForcing: undefined } as never, B)).toBe('No forcing follow-up.');
  });
});

describe('sacrifices in the Immediate level', () => {
  it('24.Rxd4!! (Kasparov–Topalov): a losing capture the engine line declines is told as an offer, not a loss', () => {
    const fen = legalFen('b2r3r/k4p1p/p2q1np1/NppP4/3p1Q2/P4PPB/1PP4P/1K1RR3 w - - 1 24');
    const p = pv('d1d4 a7b6 b2b4 d6f4 d4f4 f6d5 f4f7 c5b4 a3b4 d5b4');
    const { line } = narrateLine(fen, p, { settings: S, score: { cp: 0 } });
    const imm = immediateFacts(fen, 'd1d4');
    const best = renderExplanation({ immediate: imm, short: [line], long: [] }, { mover: 'white', label: 'best', uci: 'd1d4' }).immediate.text;
    expect(line.result).toBe('trade');
    expect(best[0]).toBe("Takes Black's pawn on d4 and leaves the rook where it can be taken (−3 points if it is), but in the engine line Black doesn't take it.");
    // when the line takes it and comes out level, it is a sacrifice won back
    const taken = narrateLine(fen, pv('d1d4 c5d4 e1e7 a7b6'), { settings: S, plies: 2 }).line;
    void taken;
    const bad = renderExplanation({ immediate: imm, short: [line], long: [] }, { mover: 'white', label: 'mistake', uci: 'd1d4' }).immediate.text;
    expect(bad[0]).not.toMatch(/sacrifice/);
  });
});

describe('sacrifices in the story', () => {
  it('a queen offered for a mate reads as a sacrifice, not "attacks the rook"', () => {
    const fen = legalFen('5rk1/5ppp/8/1Q6/8/8/5PPP/4R1K1 w - - 0 1');
    const { line } = narrateLine(fen, pv('b5e8 f8e8 e1e8'), { settings: S, score: { mate: 2 } });
    expect(lineText(line, W)).toBe('Qe8 sacrifices the queen → Rxe8 takes the queen → Rxe8# is checkmate.');
  });
});
