// Regression tests for explanation-quality problems found in the Opera game report (review of 2026-10-24).
// Pure: engine lines are fixed PVs (as Stockfish gave them), so the tests don't depend on search noise.
import { DEFAULT_SETTINGS, type Fact } from '@chess-coach/shared';
import { describe, expect, it } from 'vitest';
import { labelText, lineText, renderExplanation, verdictText } from '../src/analysis/explain';
import { concreteFacts } from '../src/analysis/suggest';
import { immediateFacts } from '../src/facts/immediate';
import { narrateLine, narrationPlies, refutationFact } from '../src/facts/line';
import { longTermFacts, positionalFacts } from '../src/facts/longterm';
import { targetHitsBack, threatExistedBefore, verifyWithLine } from '../src/analysis/analyzeMove';
import { legalFen, playUci } from './helpers/classifyHelpers';

const S = DEFAULT_SETTINGS;
const W = { mover: 'white' as const };
const B = { mover: 'black' as const };
type LineF = Extract<Fact, { type: 'line' }>;

/** UCI moves from SAN-free coordinates (helper for readability: 'g1f3 b8c6 ...'). */
const pv = (s: string) => s.split(' ');

// Opera game positions
const AFTER_1E5 = legalFen('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
const BEFORE_6W = legalFen('rn1qkbnr/ppp2ppp/8/4p3/4P3/5Q2/PPP2PPP/RNB1KB1R w KQkq - 0 6'); // 6. White to move
const BEFORE_6B = legalFen('rn1qkbnr/ppp2ppp/8/4p3/2B1P3/5Q2/PPP2PPP/RNB1K2R b KQkq - 1 6'); // 6...Nf6?

describe('1. no material claim at a non-quiet point', () => {
  // 2.Nf3 Nc6 3.Bb5 Nf6 4.O-O Nxe4 5.Re1 Nd6 6.Nxe5 Be7 7.Bf1 Nxe5 — the PV stops before 8.Rxe5 (Berlin)
  const BERLIN = pv('g1f3 b8c6 f1b5 g8f6 e1g1 f6e4 f1e1 e4d6 f3e5 f8e7 b5f1 c6e5');

  it('the story stops at the first quiet point; nothing is lost', () => {
    const { line } = narrateLine(AFTER_1E5, BERLIN, { settings: S });
    expect(line.steps.map((s) => s.san)).toEqual(['Nf3', 'Nc6']);
    expect(line.result).toBe('quiet');
    expect(lineText(line, W)).not.toMatch(/loses|few moves later/);
  });

  it('a line forced to end mid-exchange resolves the pending recapture with SEE (material stays level)', () => {
    const { line } = narrateLine(AFTER_1E5, BERLIN, { settings: S, plies: 12 });
    expect(line.result).not.toBe('loses-material');
    expect(line.materialDelta).toBe(0);
    expect(lineText(line, W)).not.toMatch(/loses a knight|few moves later/);
  });

  it('a capture the opponent cannot take back at once is no payoff when the eval says the material comes back', () => {
    // 3.Bb5 Nf6 4.O-O Nxe4: nothing recaptures on e4 right away, but Re1 / Nxe5 regain the pawn (eval +0.3)
    const fen = legalFen('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
    const p = pv('f1b5 g8f6 e1g1 f6e4 f1e1 e4d6 f3e5 c6e5 e1e5 f8e7 b5f1 e8g8');
    const { line } = narrateLine(fen, p, { settings: S, score: { cp: 30 } });
    expect(line.result).not.toBe('loses-material');
    expect(lineText(line, W)).not.toMatch(/White loses/);
  });

  it('a line that ends with material still hanging on several squares claims nothing', () => {
    // 1.e4 d5 2.Nc3 dxe4 3.Nxe4 Qd5: the queen hits e4 and nothing is settled after 4 plies with Nc3-... cut
    const fen = legalFen('rnbqkbnr/ppp1pppp/8/3p4/4P3/2N5/PPPP1PPP/R1BQKBNR b KQkq - 1 2');
    const { line } = narrateLine(fen, pv('d5e4 c3e4 d8d5 e4c3'), { settings: S, plies: 3 });
    expect(['unclear', 'trade', 'quiet']).toContain(line.result);
    expect(lineText(line, B)).not.toMatch(/wins|loses/);
  });
});

describe('2. bad moves are explained by what they allow', () => {
  // 6...Nf6? 7.Qb3: the queen hits b7 and adds a second attacker to f7 (Bxf7+ can no longer be answered by Kxf7)
  const NF6_PV = pv('g8f6 f3b3 d8e7 b1c3 c7c6 c1g5');

  it("refutation fact: the reply's double attack on b7 and f7", () => {
    const { line } = narrateLine(BEFORE_6B, NF6_PV, { settings: S });
    const allows = refutationFact({ fenBefore: BEFORE_6B, uci: 'g8f6', pv: NF6_PV, line });
    expect(allows).toMatchObject({ type: 'allows', reply: { san: 'Qb3', uci: 'f3b3' } });
    expect(allows!.targets!.map((t) => t.square).sort()).toEqual(['b7', 'f7']);
  });

  it('it leads the Immediate level of a Mistake, not of a good move', () => {
    const { line } = narrateLine(BEFORE_6B, NF6_PV, { settings: S });
    const allows = refutationFact({ fenBefore: BEFORE_6B, uci: 'g8f6', pv: NF6_PV, line })!;
    const imm = [allows, ...immediateFacts(BEFORE_6B, 'g8f6')];
    const bad = renderExplanation({ immediate: imm, short: [line], long: [] }, { mover: 'black', label: 'mistake' }).immediate.text;
    // Qb3 was already in the air before 6...Nf6 (White threatened it and Qxf7#): Nf6 stops one, not the other
    expect(bad[0]).toBe("Doesn't stop Qb3: then Black's pawns on b7 and f7 are both under attack.");
    const fine = renderExplanation({ immediate: imm, short: [line], long: [] }, { mover: 'black', label: 'best' }).immediate.text;
    expect(fine.join(' ')).not.toMatch(/Allows/);
  });

  it('the punishing reply is never "(forced)"', () => {
    const forced = new Map([[1, { forced: true, alternatives: 44 }]]);
    const { line, forcedReplies } = narrateLine(BEFORE_6B, NF6_PV, { settings: S, forced });
    expect(line.steps[1]).toMatchObject({ san: 'Qb3' });
    expect(line.steps[1]!.forced).toBeUndefined();
    expect(forcedReplies).toEqual([]);
    expect(lineText(line, B)).not.toMatch(/Qb3 \(forced\)/);
  });

  it('a reply that takes a hung piece is merged with the hang', () => {
    // 1.Qg5?? hxg5
    const fen = legalFen('r5k1/ppp2pp1/7p/8/8/2N2N2/PPPQ1PPP/4R1K1 w - - 0 1');
    const p = pv('d2g5 h6g5 f3g5 a8d8');
    const { line } = narrateLine(fen, p, { settings: S });
    const allows = refutationFact({ fenBefore: fen, uci: 'd2g5', pv: p, line })!;
    expect(allows.facts.some((f) => f.type === 'capture')).toBe(true);
    const text = renderExplanation({ immediate: [allows, ...immediateFacts(fen, 'd2g5')], short: [line], long: [] }, { mover: 'white', label: 'blunder' }).immediate.text;
    expect(text).toEqual(['Leaves the queen on g5 hanging: Black takes it with hxg5 (−8 points).']);
  });

  it('no "for free" / "threatens … winning" when the own line loses material: 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nd4 4.Nxe5? Qg5', () => {
    const fen = legalFen('r1bqkbnr/pppp1ppp/8/4p3/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4');
    const p = pv('f3e5 d8g5 e1g1 g5e5 c2c3 d4e6 d2d4 e5e4'); // Stockfish 19 PV
    const { line } = narrateLine(fen, p, { settings: S, targetDelta: -3 });
    expect(line).toMatchObject({ result: 'loses-material', materialDelta: -3 });
    // 4...Qg5's own verified threat (null-move search): Qxg2, winning the pawn and then attacking the rook on h1
    const replyThreat: Fact = { type: 'threat', move: 'g5g2', san: 'Qxg2', gain: 2, facts: [{ type: 'capture', captured: { role: 'pawn', square: 'g2', color: 'white' }, outcome: 'wins-material', net: 1 }] };
    const allows = refutationFact({ fenBefore: fen, uci: 'f3e5', pv: p, line, replyThreat: replyThreat as Extract<Fact, { type: 'threat' }> })!;
    expect(allows.targets!.map((t) => t.square)).toEqual(['e5', 'g2']);
    // the move's own null-move threat as the engine found it (Bxf7+ winning a pawn if Black passed)
    const ownThreat: Fact = { type: 'threat', move: 'c4f7', san: 'Bxf7+', gain: 1, facts: [{ type: 'capture', captured: { role: 'pawn', square: 'f7', color: 'black' }, outcome: 'wins-material', net: 1 }, { type: 'check' }] };
    const imm = [allows, ...immediateFacts(fen, 'f3e5'), ownThreat];
    const text = renderExplanation({ immediate: imm, short: [line], long: [] }, { mover: 'white', label: 'mistake' }).immediate.text;
    expect(text[0]).toBe("Takes Black's pawn on e5, but allows Qg5: then White's knight on e5 and pawn on g2 are both under attack.");
    expect(text.join(' ')).not.toMatch(/for free|Threatens|winning a pawn/);
    // and the story doesn't call the pawn grab a win either
    expect(lineText(line, W)).toMatch(/^Nxe5 takes the pawn → Qg5 attacks the knight/);
    expect(lineText(line, W)).toMatch(/White loses a knight \(−3 points\)\.$/);
  });

  it('the label text says why the better move is better, from its verified facts', () => {
    // 6...Qf6 defends f7; 6...Nf6 doesn't
    const qf6 = immediateFacts(BEFORE_6B, 'd8f6');
    const t = labelText({
      label: 'mistake', labelReason: { winChance: 'mistake' }, color: 'black', uci: 'g8f6', bestUci: 'd8f6', bestSan: 'Qf6',
      evalBefore: { cp: 150 }, evalAfter: { cp: 300 }, winBefore: 36, winAfter: 25, winLoss: 11,
      better: ['defends the pawn on f7'],
    }, S);
    expect(qf6.some((f) => f.type === 'defend' && f.piece.square === 'f7')).toBe(true);
    expect(t).toBe("Mistake ? — Qf6 was much better. Qf6 defends the pawn on f7. Black's winning chances go from 36% to 25%.");
  });
});

describe('3. short lines tell a story', () => {
  it('long lines are compressed to at most 6 steps, uneventful middle steps become "…"', () => {
    const steps = Array.from({ length: 10 }, (_, i) => ({ ply: i + 1, san: `m${i + 1}`, uci: 'a1a2', color: (i % 2 ? 'black' : 'white') as 'white' | 'black', facts: [] as Fact[] }));
    steps[4]!.facts = [{ type: 'check' }];
    steps[8]!.facts = [{ type: 'capture', captured: { role: 'pawn', square: 'b7', color: 'black' }, outcome: 'wins-material', net: 1 }];
    const line: LineF = { type: 'line', steps, materialDelta: 1, result: 'wins-material', won: ['pawn'] };
    const t = lineText(line, W);
    expect(t).toBe('m1 → m2 → … → m5 → … → m9 wins the pawn → m10 → White wins a pawn (+1 point).');
    expect(t).not.toMatch(/few moves later/);
  });

  it('opening quiet moves get a short line; Book moves skip a narration that has nothing forcing', () => {
    const p = pv('g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7');
    expect(narrationPlies(AFTER_1E5, p, S)).toBe(2);
    const { line } = narrateLine(AFTER_1E5, p, { settings: S });
    const e = renderExplanation({ immediate: immediateFacts(AFTER_1E5, 'g1f3'), short: [line], long: [] }, { mover: 'white', label: 'book' });
    expect(e.short.text).toEqual(['No forcing follow-up.']);
  });
});

describe('4. long-term: at most 2 meaningful sentences', () => {
  it('isolated pawns appearing only at the end of the line are not mentioned; the level is capped', () => {
    // 6.Bc4 Qf6 7.Qb3 Nd7 8.Qxb7 Rb8 9.Qa6 Qxa6 10.Bxa6: Black's a7/c7 become isolated only at the line end
    const fenAfter = playUci(BEFORE_6W, ['f1c4']);
    const end = playUci(BEFORE_6W, pv('f1c4 d8f6 f3b3 b8d7 b3b7 a8b8 b7a6 f6a6 c4a6'));
    const facts = longTermFacts({
      fenBefore: BEFORE_6W, fenAfter, lineEndFen: end, mover: 'white', immediate: immediateFacts(BEFORE_6W, 'f1c4'),
      lineMaterialDelta: 1, score: { cp: 140 }, bestScore: { cp: 220 }, shallowScore: { cp: 150 }, isBest: false, secondBestLoss: 3, legalMoves: 40, settings: S,
    });
    expect(facts.length).toBeLessThanOrEqual(2);
    expect(facts.some((f) => f.type === 'positional' && f.feature === 'isolated-pawn')).toBe(false);
  });
});

describe('5. pick: an attack whose line wins the target is concrete (6.Qb3 in the Opera game)', () => {
  it('Qb3 attacks the undefended b7 pawn and the line wins it', () => {
    const p = pv('f3b3 b8d7 c1e3 f8c5 e3c5 d7c5 b3b5 c5d7 b5b7 g8e7 b1c3 a8b8');
    const { line } = narrateLine(BEFORE_6W, p, { settings: S, score: { cp: 220 } });
    expect(line.result).toBe('wins-material');
    expect(line.won).toEqual(['pawn']);
    expect(line.steps.length).toBeLessThanOrEqual(9);
    const facts = [...immediateFacts(BEFORE_6W, 'f3b3'), line];
    expect(concreteFacts(facts).map((f) => f.type)).toEqual(expect.arrayContaining(['attack', 'line']));
    expect(lineText(line, W)).toMatch(/Qxb7 wins the pawn → White wins a pawn \(\+1 point\)\.$/);
  });
});

describe('review round 2: claims checked against the engine line', () => {
  it('"hanging" only when the engine line takes the piece', () => {
    const fen = legalFen('r5k1/ppp2pp1/7p/8/8/2N2N2/PPPQ1PPP/4R1K1 w - - 0 1');
    const facts = immediateFacts(fen, 'd2g5');
    expect(facts.some((f) => f.type === 'hangs')).toBe(true);
    expect(verifyWithLine(facts, fen, pv('d2g5 h6g5 f3g5')).some((f) => f.type === 'hangs')).toBe(true);
    expect(verifyWithLine(facts, fen, pv('d2g5 a8d8 g5d8')).some((f) => f.type === 'hangs')).toBe(false);
  });

  it('a threat that was already there before the move is not credited to it', () => {
    const nxe5: Extract<Fact, { type: 'threat' }> = { type: 'threat', move: 'f3e5', san: 'Nxe5', gain: 1, facts: [{ type: 'capture', captured: { role: 'pawn', square: 'e5', color: 'black' }, outcome: 'wins-material', net: 1 }] };
    // the knight already attacks the loose e5 pawn
    expect(threatExistedBefore(legalFen('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3'), nxe5)).toBe(true);
    // 2.Nf3 creates it
    expect(threatExistedBefore(AFTER_1E5, nxe5)).toBe(false);
  });

  it('results state the resulting balance when material was not level (a gambit pawn given back)', () => {
    const line: LineF = { type: 'line', steps: [{ ply: 1, san: 'Be6', uci: 'c8e6', color: 'black', facts: [] }, { ply: 2, san: 'cxd4', uci: 'c3d4', color: 'white', facts: [{ type: 'capture', captured: { role: 'pawn', square: 'd4', color: 'black' }, outcome: 'wins-material', net: 1 }] }], materialDelta: -1, result: 'loses-material', lost: ['pawn'], balance: 0 };
    expect(lineText(line, B)).toBe('Be6 → cxd4 wins the pawn → Black loses a pawn (−1 point); Black was a pawn up before, so material is now level.');
    const trade: LineF = { ...line, materialDelta: 0, result: 'trade', balance: 1, lost: undefined as never };
    delete (trade as { lost?: unknown }).lost;
    expect(lineText(trade, B)).toMatch(/the material balance doesn't change \(Black is a pawn up\)\.$/);
  });

  it('a capture of a bigger piece than was just lost is no "take-back"; a pawn grab elsewhere neither', () => {
    // 7...Bg4 8.Qb3 Bxf3 9.Qxb7 (a pawn, not a take-back) ... gxf3
    const fen = legalFen('rnbqkb1r/pp3ppp/5n2/3p4/3P4/2N2N2/PP3PPP/R1BQKB1R b KQkq - 3 7');
    const { line } = narrateLine(fen, pv('c8g4 d1b3 g4f3 b3b7 b8d7 g2f3'), { settings: S, plies: 6 });
    const t = lineText(line, B);
    expect(t).not.toMatch(/Qxb7 takes back/);
    expect(t).toMatch(/gxf3 (wins|takes) the bishop/);
  });

  it('move-level structure changes undone by the recapture are not reported; a mutual bishop trade is no "bishop pair" change', () => {
    const fen = legalFen('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
    const fs = positionalFacts({ fenBefore: fen, fenAfter: playUci(fen, ['e4d5']), lineEndFen: playUci(fen, ['e4d5', 'd8d5']), mover: 'white', immediate: [] });
    expect(fs.some((f) => f.feature === 'doubled-pawn')).toBe(false);
    const bb = legalFen('4k3/4bp2/4b3/8/2B5/8/3B4/4K3 w - - 0 1');
    const fb = positionalFacts({ fenBefore: bb, fenAfter: playUci(bb, ['c4e6']), lineEndFen: playUci(bb, ['c4e6', 'f7e6']), mover: 'white', immediate: [] });
    expect(fb.some((f) => f.feature === 'bishop-pair')).toBe(false);
  });
});

describe('review round 3', () => {
  const step = (san: string, color: 'white' | 'black', facts: Fact[] = []) => ({ ply: 1, san, uci: 'a1a2', color, facts });
  it('"wins back" only when the mover started behind', () => {
    // mcz8Z7Cr 27: White was 4 down, the line makes it level
    const back: LineF = { type: 'line', steps: [step('Bxg5', 'white'), step('Qd8', 'black')], materialDelta: 4, result: 'wins-material', balance: 0 };
    expect(lineText(back, W)).toMatch(/White wins back material \(\+4 points\); material is level\.$/);
    // dmVsbMbS 19: material level before, the line wins a pawn — no "back"
    const fresh: LineF = { type: 'line', steps: [step('Re1', 'white'), step('Qe7', 'black')], materialDelta: 1, result: 'wins-material', won: ['pawn'], balance: 1, owed: 1 };
    expect(lineText(fresh, W)).toBe('Re1 → Qe7 → White wins a pawn (+1 point).');
  });

  it('no "threatens Qxd5, winning a queen" when the queens face each other', () => {
    const q: Extract<Fact, { type: 'threat' }> = { type: 'threat', move: 'f7d5', san: 'Qxd5', gain: 9, facts: [] };
    expect(targetHitsBack(legalFen('7k/5Q2/8/3q4/8/8/8/K7 b - - 0 1'), q)).toBe(true);
    expect(targetHitsBack(legalFen('7k/5Q2/8/3r4/8/8/8/K7 b - - 0 1'), { ...q, gain: 5 })).toBe(false);
  });

  it('no "for free" (SEE also wins defended pawns); a queen attacked by a rook is not "undefended"', () => {
    expect(renderExplanation({ immediate: immediateFacts(legalFen('4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1'), 'd1d5'), short: [], long: [] }, W).immediate.text[0]).toBe("Wins Black's knight on d5 (+3 points).");
    const att: Fact = { type: 'attack', attacker: { role: 'rook', square: 'f8', color: 'black' }, target: { role: 'queen', square: 'f7', color: 'white' }, reason: 'undefended' };
    expect(renderExplanation({ immediate: [att], short: [], long: [] }, B).immediate.text[0]).toBe("Attacks White's queen on f7 with a rook.");
  });
});

describe('review round 4', () => {
  it('a pin opened by the moving piece is "uncovered", credited to the real pinner (lmnbpO0B 18: Qf4 with Rd1 behind)', () => {
    const pin: Fact = { type: 'pin', pinner: { role: 'rook', square: 'd1', color: 'white' }, pinned: { role: 'knight', square: 'd7', color: 'black' }, behind: { role: 'queen', square: 'd8', color: 'black' }, absolute: false };
    const line: LineF = { type: 'line', steps: [{ ply: 1, san: 'Re8', uci: 'f8e8', color: 'black', facts: [] }, { ply: 2, san: 'Qf4', uci: 'd2f4', color: 'white', facts: [pin] }], materialDelta: 0, result: 'quiet' };
    expect(lineText(line, B)).toBe('Re8 → Qf4 uncovers a pin: the rook on d1 pins the knight to the queen.');
    expect(renderExplanation({ immediate: [pin], short: [], long: [] }, { mover: 'white', uci: 'd2f4' }).immediate.text[0]).toBe("Uncovers a pin: the rook on d1 now pins Black's knight on d7 to the queen on d8.");
  });
});

describe('6. confirmations per label', () => {
  it('Book / Forced / Best / Great captions', () => {
    expect(verdictText('book', true)).toBe('Opening theory.');
    expect(verdictText('forced', true)).toBe('The only legal move.');
    expect(verdictText('best', true)).toBe('This was the best move.');
    expect(verdictText('best', false)).toBe("As good as the best move.");
    expect(verdictText('great', true)).toBe('Great find — the only good move here.');
    expect(verdictText('mistake', false)).toBeNull();
  });
});
