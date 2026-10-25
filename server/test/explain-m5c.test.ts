// M5c regressions (explanation quality round 3): deep-only captions vs shown stories, suggestions that repeat the
// played move, stories that stop before the payoff, threats behind a reply, reasons ranked by magnitude (+ the
// honest hedge), pawn forks, batteries, perpetual checks / repetitions. Positions are from the review games.
import { DEFAULT_SETTINGS, type Explanation, type Fact } from '@chess-coach/shared';
import { describe, expect, it } from 'vitest';
import { verifyWithLine } from '../src/analysis/analyzeMove';
import { betterReasonFacts, contrastWithPlayed, lineText, reasonsArePartial, renderExplanation } from '../src/analysis/explain';
import { judgeCandidate, storyPaysOff } from '../src/analysis/suggest';
import { immediateFacts } from '../src/facts/immediate';
import { narrateLine, narrationPlies, refutationFact, repetitionInLine, type ThreatFact } from '../src/facts/line';

const S = DEFAULT_SETTINGS;
const pv = (s: string) => s.split(' ');
const of = <T extends Fact['type']>(facts: readonly Fact[], t: T) => facts.filter((f): f is Extract<Fact, { type: T }> => f.type === t);

describe('deep-only caption vs the shown story (weakness 1)', () => {
  // YMOxEowk 25.f3?? — the engine's Rh5+ wins a rook by a skewer 8 plies later; the depth-8 search misses it
  const fen = '8/p6p/1p3p2/2p5/8/3kb1P1/P4PKP/3r3R w - - 0 1';
  const winsRook: Fact = { type: 'line', steps: [{ ply: 1, san: 'Rh5+', uci: 'h1h5', color: 'white', facts: [{ type: 'check' }] }], materialDelta: 5, result: 'wins-material', won: ['rook'] };
  void fen;
  it('a candidate whose own short line wins material is near-term even when the shallow search disagrees', () => {
    const c = { uci: 'h1h5', score: { cp: 600 }, shallowScore: { cp: 0 }, material: null, facts: [{ type: 'check' } as Fact, winsRook] };
    expect(storyPaysOff(c.facts)).toBe(true);
    expect(judgeCandidate(c, { cp: 600 }, S)).toEqual([]);
  });
  it('… but not one that only wins back what the opponent just took, nor a quiet line', () => {
    const back: Fact = { ...winsRook, materialDelta: 3, owed: 3 } as Fact;
    expect(storyPaysOff([back])).toBe(false);
    const c = { uci: 'h1h5', score: { cp: 600 }, shallowScore: { cp: 0 }, material: null, facts: [{ type: 'check' } as Fact, back] };
    expect(judgeCandidate(c, { cp: 600 }, S)).toContain('shallow-disagrees');
  });
});

describe('suggestions do not repeat the played move (weakness 2)', () => {
  const ex = (imm: string[], long: string[] = ['No notable long-term change.']): Explanation => ({
    immediate: { facts: [], text: imm },
    short: { facts: [], text: ['No forcing follow-up.'] },
    long: { facts: [], text: long },
  });
  it('shared Immediate sentences are folded into one "Like X, it also …" sentence after the own ones', () => {
    // FroOipnY 10.Ba4?! vs the pick Bxd7
    const played = ex(["Stops Black's threat axb5, which would win a bishop (+3 points for Black)."]);
    const pick = ex(["Takes Black's knight on d7 — an even trade.", "Stops Black's threat axb5, which would win a bishop (+3 points for Black)."]);
    expect(contrastWithPlayed(pick, played, 'Ba4').immediate.text).toEqual([
      "Takes Black's knight on d7 — an even trade.",
      "Like Ba4, it also stops Black's threat axb5, which would win a bishop (+3 points for Black).",
    ]);
  });
  it('all shared: "Like X, it …"; nothing special: says so; long-term sentences are marked', () => {
    const played = ex(["Takes back: captures White's queen on d8."], ["After these moves, White's king is more exposed (fewer pawns in front of it)."]);
    const pick = ex(["Takes back: captures White's queen on d8."], ["After these moves, White's king is more exposed (fewer pawns in front of it)."]);
    const c = contrastWithPlayed(pick, played, 'Raxd8');
    expect(c.immediate.text).toEqual(["Like Raxd8, it takes back White's queen on d8."]);
    expect(c.long.text).toEqual(["After these moves, White's king is more exposed (fewer pawns in front of it) — as after Raxd8."]);
    expect(contrastWithPlayed(ex(['Nothing special happens right away.']), ex(['Nothing special happens right away.']), 'h4').immediate.text).toEqual(['Nothing special happens right away (as with h4).']);
  });
});

describe('stories run on to the payoff (weakness 3)', () => {
  // 57RP5sCb 12...Re8: the line "wins a pawn" with …cxb4 at ply 11, but Qxb4 takes it back at ply 16 (eval −0.5 for Black)
  const fen = 'r2q1rk1/pbp2ppp/1pn2n2/8/3PN3/5NP1/PP3PBP/R2QR1K1 b - - 0 12';
  const line = pv('f8e8 e4f6 d8f6 f3e5 c6a5 a1c1 c7c5 b2b4 b7g2 g1g2 c5b4 c1c7 e8f8 d1b1 a8d8 b1b4 f6e6 g2g1 e6d5');
  it('a "win" that goes against the eval is told on to where the material comes back (beyond the 12-ply horizon)', () => {
    // (a bad move's story is told on to its first material result, here …cxb4 at ply 11 — analyzeMove asks for that)
    expect(narrateLine(fen, line, { settings: S, score: { cp: -54 }, plies: 11 }).line.result).toBe('wins-material');
    const n = narrationPlies(fen, line, S, { cp: -54 }, { minPlies: 11 });
    expect(n).toBe(16);
    const t = lineText(narrateLine(fen, line, { settings: S, score: { cp: -54 }, plies: n }).line, { mover: 'black' });
    expect(t).toContain('Qxb4');
    expect(t).toMatch(/material stays level\.$/);
    expect(t).not.toContain('Black wins a pawn');
  });
});

describe('the threat behind a reply (weakness 4)', () => {
  it('a reply whose threat the mover meets by giving up material: the threat is named with the cost', () => {
    // PnAHyM23 26.Qc6?? Nd4! (threatens Nxc6) 27.Rxd4 cxd4 — White gives the exchange
    const fen = 'r4rk1/p1p2pp1/1p6/2p1Pn2/2P1QPb1/6P1/P2R3P/R5K1 w - - 3 26';
    const p = pv('e4c6 f5d4 d2d4 c5d4 h2h3 g4h3 c6f3 h3f5 g3g4 f5c2');
    const nl = narrateLine(fen, p, { settings: S, score: { cp: 461 }, plies: 7 });
    expect(nl.line.result).toBe('loses-material');
    const replyThreat: ThreatFact = { type: 'threat', move: 'd4c6', san: 'Nxc6', gain: 9, facts: [{ type: 'capture', captured: { role: 'queen', square: 'c6', color: 'white' }, outcome: 'wins-material', net: 9 }] };
    const a = refutationFact({ fenBefore: fen, uci: 'e4c6', pv: p, line: nl.line, replyThreat })!;
    expect(a.threatParried).toBe(true);
    const t = renderExplanation({ immediate: [a], short: [], long: [] }, { mover: 'white', label: 'blunder' }).immediate.text;
    expect(t[0]).toBe("Allows Nd4: then Black threatens Nxc6, winning a queen (+9 points for Black) — in the engine line White avoids that but loses 3 points.");
  });
  it('a threat that is simply stepped away from, with a loss elsewhere later, is not the reason', () => {
    const fen = 'r4rk1/p1p2pp1/1p6/2p1Pn2/2P1QPb1/6P1/P2R3P/R5K1 w - - 3 26';
    const p = pv('e4c6 f5d4 d2d4 c5d4 h2h3 g4h3 c6f3 h3f5 g3g4 f5c2');
    const nl = narrateLine(fen, p, { settings: S, score: { cp: 461 }, plies: 7 });
    // a smaller threat than the line's cost: no
    const small: ThreatFact = { type: 'threat', move: 'd4c6', san: 'Nxc6', gain: 2, facts: [] };
    expect(refutationFact({ fenBefore: fen, uci: 'e4c6', pv: p, line: nl.line, replyThreat: small })?.threatParried).toBeUndefined();
  });
  it('a quiet reply whose line costs material names the opponent\'s first forcing move', () => {
    // 2hOytwun 16.b3?? O-O 17.Be3 Nf3+ … Nxf1
    const fen = 'r3k2r/p1p2ppp/2p1pqb1/8/Q1Bn1P2/6P1/PP3P1P/R1B2RK1 w kq - 0 16';
    const p = pv('b2b3 e8g8 c1e3 d4f3 g1g2 g6e4 c4e2 f3d2 f2f3 d2f1 a1f1 e4d5 e3d4 f6f5 a4a6 f5h5');
    const nl = narrateLine(fen, p, { settings: S, score: { cp: -421 }, plies: 11 });
    const a = refutationFact({ fenBefore: fen, uci: 'b2b3', pv: p, line: nl.line, replyThreat: null, bestLineDelta: 0 })!;
    expect(a.follow).toBe('Nf3+');
    const t = renderExplanation({ immediate: [a], short: [], long: [] }, { mover: 'white', label: 'blunder' }).immediate.text;
    expect(t[0]).toBe('After O-O, Black goes on with Nf3+: in the engine line this costs White 2 points (see the short term).');
  });
});

describe('reasons ranked by verified magnitude, with the honest hedge (weakness 5)', () => {
  const castle: Fact = { type: 'castle', side: 'king' };
  const win: Fact = { type: 'capture', captured: { role: 'knight', square: 'e4', color: 'white' }, outcome: 'wins-material', net: 3 };
  const pawn: Fact = { type: 'capture', captured: { role: 'pawn', square: 'b2', color: 'white' }, outcome: 'wins-material', net: 1 };
  const threat: Fact = { type: 'threat', move: 'e4e2', san: 'Rxe2', gain: 5, facts: [] };
  it('the two biggest reasons are told (in fact order), not the first two', () => {
    const r = betterReasonFacts([pawn, win, threat], [], 'black');
    expect(r.map((x) => x.phrase)).toEqual(["wins White's knight on e4", 'threatens Rxe2, winning material (+5 points)']);
  });
  it('quiet reasons only without a tactical one; a small reason for a big drop gets the hedge', () => {
    const r = betterReasonFacts([castle], [], 'white');
    expect(r.map((x) => x.phrase)).toEqual(['castles kingside']);
    expect(reasonsArePartial(r, 3.5)).toBe(true);
    expect(reasonsArePartial(r, 1)).toBe(false);
    expect(reasonsArePartial(betterReasonFacts([win, threat], [], 'black'), 6)).toBe(false);
    const mate: Fact = { type: 'line', steps: [], materialDelta: 0, result: 'mate', mateIn: 7 };
    expect(reasonsArePartial(betterReasonFacts([mate], [], 'white'), 900)).toBe(false);
    const text = renderExplanation({ immediate: [{ type: 'misses', san: 'O-O', uci: 'e1g1', facts: [castle], partial: true }], short: [], long: [] }, { mover: 'white', label: 'mistake' }).immediate.text;
    expect(text).toEqual(['Misses O-O, which castles kingside — but the engine sees more than this.']);
  });
  it('a defence the played move also manages is a minor difference', () => {
    const saves: Fact = { type: 'escape', piece: { role: 'queen', square: 'd3', color: 'black' }, from: 'd8' };
    const takes: Fact = { type: 'capture', captured: { role: 'bishop', square: 'd3', color: 'white' }, outcome: 'wins-material', net: 3 };
    const stops: Fact = { type: 'defends-threat', move: 'f6d8', san: 'Bxd8', gain: 9, facts: [] };
    const playedLine: Fact = { type: 'line', steps: [], materialDelta: 0, result: 'trade' };
    const r = betterReasonFacts([saves, takes, stops], [playedLine], 'black');
    expect(r.map((x) => x.phrase)).toEqual(["wins White's bishop on d3", 'saves the queen on d8']);
  });
});

describe('pawn forks, batteries, perpetual checks (weakness 6)', () => {
  it('a pawn fork the pawn can be taken from is kept only when the engine line wins material', () => {
    // PnAHyM23 7...Qd6? 8.e5! hits the queen and the knight; …Qxe5 9.d4 and White wins material
    const fen = 'r1b1k2r/ppp2ppp/2pq1n2/2b5/4P3/3PB3/PPP2PPP/RN1QKB1R w KQkq - 5 8';
    const fork = of(immediateFacts(fen, 'e4e5'), 'fork')[0]!;
    expect(fork).toMatchObject({ byLine: true, attacker: { role: 'pawn', square: 'e5' } });
    const wins = pv('e4e5 d6e5 d3d4 c5d4 d1d4 e5d4 e3d4 c8f5 b1a3');
    expect(of(verifyWithLine(immediateFacts(fen, 'e4e5'), fen, wins), 'fork')).toHaveLength(1);
    const loses = pv('e4e5 d6e5 b1c3 c5e3 f2e3 e5e3');
    expect(of(verifyWithLine(immediateFacts(fen, 'e4e5'), fen, loses), 'fork')).toHaveLength(0);
    expect(renderExplanation({ immediate: [fork], short: [], long: [] }, { mover: 'white' }).immediate.text[0]).toBe("Pawn fork: the pawn on e5 attacks Black's queen on d6 and knight on f6 at once, and the engine line wins material after it.");
  });
  it('a battery: the moved rook lines up behind its own rook against a piece that can now be won', () => {
    // YMOxEowk 25.Rgg8! behind the rook on d8 against the bishop on c8 (defended once by the rook on a8)
    const f = of(immediateFacts('r1bR4/p6p/1p2pp2/2p2k2/8/6R1/P4PPP/6K1 w - - 4 25', 'g3g8'), 'attack');
    expect(f).toEqual([{ type: 'attack', attacker: { role: 'rook', square: 'g8', color: 'white' }, target: { role: 'bishop', square: 'c8', color: 'black' }, reason: 'outnumbered', through: { role: 'rook', square: 'd8', color: 'white' } }]);
    expect(renderExplanation({ immediate: f, short: [], long: [] }, { mover: 'white' }).immediate.text).toEqual(["Lines up behind the rook on d8: together they attack Black's bishop on c8, and White now threatens to win it."]);
  });
  it('a perpetual check in the engine line is the result of the story', () => {
    // w6ueCJMc 26...Kf8: White's queen checks on f6, e6, h6, d6, e6 — a draw
    const fen = '2r3k1/8/q1n1p1Q1/1p1pP3/2r5/2P5/PP3PPP/R5K1 b - - 0 26';
    const p = pv('g8f8 g6f6 f8e8 f6e6 e8f8 e6h6 f8e7 h6d6 e7e8 d6e6');
    expect(repetitionInLine(fen, p, { cp: 0 })).toEqual({ at: 10, kind: 'perpetual', by: 'white' });
    expect(repetitionInLine(fen, p, { cp: 120 })).toBeNull();
    const n = narrationPlies(fen, p, S, { cp: 0 });
    expect(n).toBe(10);
    const nl = narrateLine(fen, p, { settings: S, score: { cp: 0 } });
    expect(nl.line).toMatchObject({ draw: 'perpetual', drawBy: 'white' });
    expect(lineText(nl.line, { mover: 'black' })).toMatch(/White keeps giving check: a draw by perpetual check\.$/);
    // the side that gives the perpetual has a concrete point; the other side's refutation names it
    expect(storyPaysOff([{ ...nl.line, steps: nl.line.steps.slice(1).map((s) => s) }])).toBe(true);
  });
});
