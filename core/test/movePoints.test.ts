// (Points) What a top move does, as short checked points, and how moves with the same idea are told by their
// differences (analysis/movePoints.ts). Engine-free: PVs are written out, extras (threats) built by hand.
import { DEFAULT_SETTINGS as S, type Fact } from '@chess-coach/shared';
import { describe, expect, it } from 'vitest';
import { type MoveInput, type MovePoints, compareIdeas, denied, movePoints, said, sameIdea, thirdPerson, topIdeas } from '../src/analysis/movePoints';
import type { PvLine, SearchResult } from '../src/engine/uci';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const OPEN_GAME = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
const LONDON = 'rnbqkb1r/ppp1pppp/5n2/3p4/3P1B2/5N2/PPP1PPPP/RN1QKB1R w KQkq - 4 3';
const QGD = 'rnbqkb1r/ppp2ppp/4pn2/3p2B1/2PP4/2N5/PP2PPPP/R2QKBNR b KQkq - 3 4';
const PIANISSIMO = 'r1bqk2r/ppp2ppp/2np1n2/2b1p3/2B1P3/2PP1N2/PP3PPP/RNBQK2R w KQkq - 0 6';

const pts = (fen: string, uci: string, pv: string[] = [], extra: Partial<MoveInput> = {}) =>
  movePoints(fen, { uci, pv: [uci, ...pv], score: { cp: 20 }, winLoss: 0, ...extra }, S);
const keys = (m: MovePoints) => m.points.map((p) => p.key);
const texts = (m: MovePoints) => m.points.map((p) => said(p).text);

describe('wording', () => {
  it('third person and denial', () => {
    expect(thirdPerson('attack')).toBe('attacks');
    expect(thirdPerson('push')).toBe('pushes');
    expect(thirdPerson('occupy')).toBe('occupies');
    expect(thirdPerson('take back')).toBe('takes back');
    const p = { key: 'develop', verb: 'develop', rest: 'the knight', tone: 'good' as const, weight: 22 };
    expect(said(p)).toMatchObject({ text: 'Develops the knight', tone: 'good' });
    expect(denied(p)).toMatchObject({ text: "Doesn't develop the knight", tone: 'bad' });
    // lacking a drawback is good
    expect(denied({ ...p, key: 'blocks-pawn:c', verb: 'block', rest: 'the c-pawn', tone: 'bad' })).toMatchObject({ text: "Doesn't block the c-pawn", tone: 'good' });
  });
});

describe('movePoints: board rules', () => {
  it('1.e4: occupies the centre and opens the bishop on f1', () => {
    expect(texts(pts(START, 'e2e4'))).toEqual(['Occupies the centre', 'Opens the diagonal for the bishop on f1']);
  });

  it('a knight move in the opening: develops it and controls centre squares', () => {
    const m = pts(START, 'g1f3');
    expect(texts(m)).toEqual(['Develops the knight', 'Controls d4 and e5 in the centre']);
  });

  it('1.e4 e5 2.Nf3 attacks the pawn on e5', () => {
    expect(keys(pts(OPEN_GAME, 'g1f3'))[0]).toBe('attack:e5');
  });

  it('a knight in front of the c-pawn in a queen\'s-pawn opening blocks it; Nbd2 does not', () => {
    expect(keys(pts(LONDON, 'b1c3'))).toContain('blocks-pawn:c');
    expect(keys(pts(LONDON, 'b1d2'))).not.toContain('blocks-pawn:c');
  });

  it('a knight on d2 blocks the bishop on c1 once the d-pawn has moved', () => {
    const fen = 'rnbqkb1r/ppp1pppp/5n2/3p4/3P4/5N2/PPP1PPPP/RNBQKB1R w KQkq - 2 3';
    expect(texts(pts(fen, 'b1d2'))).toContain('Blocks the bishop on c1');
  });

  it("e3 behind a bishop already out on f4 doesn't shut it in (only its way back is blocked)", () => {
    expect(keys(pts(LONDON, 'e2e3')).some((k) => k.startsWith('blocks:'))).toBe(false);
  });

  it('…Be7 prepares to castle', () => {
    expect(keys(pts(QGD, 'f8e7'))).toEqual(expect.arrayContaining(['develop', 'prepare-castle']));
  });

  it('h3 keeps the bishop and knight off g4', () => {
    expect(texts(pts(PIANISSIMO, 'h2h3', ['e8g8', 'e1g1']))).toContain('Keeps the bishop and knight off g4');
  });

  it('g3 prepares the fianchetto Bg2 (the next move of the engine line)', () => {
    const fen = 'rnbqkb1r/pppppppp/5n2/8/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 2 2';
    expect(texts(pts(fen, 'g2g3', ['g7g6', 'f1g2']))).toContain('Prepares Bg2');
  });

  it('a move with at most one point of its own gets the plan from its engine line', () => {
    const m = pts(START, 'h2h3', ['e7e5', 'e2e4', 'g8f6', 'b1c3']);
    expect(m.plan).toEqual(['e4', 'Nc3']);
  });
});

describe('movePoints: facts and the engine line', () => {
  it('with the previous move known, a capture on its square is taking back, not winning a piece', () => {
    // 1.e4 d5 2.exd5: …Qxd5 takes the pawn back
    const before = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const fen = 'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2';
    expect(keys(pts(fen, 'd8d5', [], { prev: { fenBefore: before, uci: 'e4d5' } }))).toContain('recapture');
    expect(keys(pts(fen, 'd8d5'))).not.toContain('recapture');
  });

  it("a knight leaving d4 doesn't \"control d4\"", () => {
    // Sicilian: 4…e5, Nb5
    const fen = 'r1bqkbnr/pp1p1ppp/2n5/4p3/3NP3/8/PPP2PPP/RNBQKB1R w KQkq - 0 5';
    expect(texts(pts(fen, 'd4b5')).join(' ')).not.toMatch(/Controls d4/);
  });

  it("a piece that was already en prise isn't the move's offer", () => {
    // the white knight on a4 is attacked by the b5 pawn before e4 and after it
    const fen = 'rnbqkbnr/p1pppppp/8/1p6/N7/8/PPPPPPPP/R1BQKBNR w KQkq - 0 3';
    const m = pts(fen, 'e2e4', ['b5a4']);
    expect(keys(m).some((k) => k.startsWith('offer:'))).toBe(false);
  });

  it('material the line wins is told only against the baseline of the other moves', () => {
    // after Nf3 the line goes on to win the e5 pawn
    const pv = ['a7a6', 'f3e5', 'b7b6'];
    const win = (m: MovePoints) => texts(m).find((t) => t.includes('winning'));
    // the winning capture comes later: it is named, and it is the same point as the attack on e5
    expect(win(pts(OPEN_GAME, 'g1f3', pv))).toBe('Sets up Nxe5, winning a pawn');
    expect(texts(pts(OPEN_GAME, 'g1f3', pv))).not.toContain('Attacks the pawn on e5');
    // every top move wins it: not this move's point
    expect(win(pts(OPEN_GAME, 'g1f3', pv, { baseline: 1 }))).toBeUndefined();
  });

  it("stopping a threat and defending the threatened piece is one point; attacking the piece a threat takes is that threat", () => {
    // White: Qe2 defends the bishop on c4 that …Qxc4 would take
    const fen = 'r1b1k2r/ppq1ppb1/5npp/4p3/2B1P3/2N2Q2/PPP2PPP/R3K1NR w KQkq - 0 11';
    const defends: Extract<Fact, { type: 'defends-threat' }> = { type: 'defends-threat', move: 'c7c4', san: 'Qxc4', gain: 3, facts: [] };
    const m = movePoints(fen, { uci: 'f3e2', pv: ['f3e2'], score: { cp: -80 }, winLoss: 0 }, S, { defends });
    expect(keys(m).filter((k) => k.startsWith('defend'))).toEqual(['defends:c7c4']);
    expect(texts(m)[0]).toBe("Stops Black's threat …Qxc4");
  });
});

describe('compareIdeas', () => {
  it('Nc3 after Nf3 (1.e4 e5): the same idea, and it lacks the attack on e5', () => {
    const [nf3, nc3] = compareIdeas([pts(OPEN_GAME, 'g1f3'), pts(OPEN_GAME, 'b1c3')]);
    expect(nf3!.like).toBeUndefined();
    expect(nc3!.like).toBe(0);
    expect(nc3!.minus!.map((p) => p.text)).toEqual(["Doesn't attack the pawn on e5"]);
  });

  it('d4 is another plan than Nf3, even though both hit e5 (a pawn, not a piece)', () => {
    const [, d4] = compareIdeas([pts(OPEN_GAME, 'g1f3'), pts(OPEN_GAME, 'd2d4')]);
    expect(d4!.like).toBeUndefined();
    expect(d4!.points.length).toBeGreaterThan(0);
  });

  it('Nc3 next to Nbd2 in the London: same idea, but it blocks the c-pawn', () => {
    const [, nc3] = compareIdeas([pts(LONDON, 'b1d2'), pts(LONDON, 'b1c3')]);
    expect(nc3!.like).toBe(0);
    expect(nc3!.minus!.map((p) => p.text)).toEqual(['Blocks the c-pawn']);
    expect(nc3!.plus).toEqual([]);
  });

  it('…Nbd7 next to …Be7: same idea, but it doesn\'t prepare castling', () => {
    const [, nbd7] = compareIdeas([pts(QGD, 'f8e7'), pts(QGD, 'b8d7')]);
    expect(nbd7!.like).toBe(0);
    expect(nbd7!.minus!.map((p) => p.text)).toContain("Doesn't prepare to castle");
  });

  it('two moves that stop the same threat share the idea, whatever piece moves', () => {
    const a: MovePoints = { uci: 'a2a3', san: 'a3', kind: 'pawn', plan: [], points: [{ key: 'defends:h2h1', verb: 'stop', rest: 'the mate threat', tone: 'good', weight: 75 }] };
    const b: MovePoints = { uci: 'e2d1', san: 'Qd1', kind: 'queen', plan: [], points: [{ key: 'defends:h2h1', verb: 'stop', rest: 'the mate threat', tone: 'good', weight: 75 }, { key: 'attack:d4', verb: 'attack', rest: 'the pawn on d4', tone: 'good', weight: 25 }] };
    expect(sameIdea(b, a)).toBe(true);
    const [, qd1] = compareIdeas([a, b]);
    expect(qd1!.plus!.map((p) => p.text)).toEqual(['Attacks the pawn on d4']);
  });

  it('a move without a good point of its own has no idea to share', () => {
    const empty: MovePoints = { uci: 'h2h3', san: 'h3', kind: 'pawn', plan: ['e4'], points: [] };
    const [, h3] = compareIdeas([pts(START, 'e2e4'), empty]);
    expect(h3!.like).toBeUndefined();
    expect(h3!.plan).toEqual(['e4']);
  });

  it('at most MAX_POINTS points per move', () => {
    const many: MovePoints = { uci: 'e2e4', san: 'e4', kind: 'pawn', plan: [], points: ['a', 'b', 'c', 'd', 'e'].map((k, i) => ({ key: k, verb: 'do', rest: k, tone: 'good' as const, weight: 10 - i })) };
    expect(compareIdeas([many])[0]!.points.map((p) => p.key)).toEqual(['a', 'b', 'c']);
  });
});

describe('topIdeas', () => {
  it('runs the null-move searches and keeps the order of the top moves', async () => {
    const lines: PvLine[] = [
      { multipv: 1, move: 'g1f3', score: { cp: 30 }, depth: 14, pv: ['g1f3', 'b8c6'] },
      { multipv: 2, move: 'b1c3', score: { cp: 20 }, depth: 14, pv: ['b1c3', 'g8f6'] },
    ];
    const searched: string[] = [];
    const empty: SearchResult = { lines: [], bestmove: null, depth: 12, nodes: 0, timeMs: 0 };
    const ideas = await topIdeas(OPEN_GAME, [{ uci: 'g1f3', winLoss: 0 }, { uci: 'b1c3', winLoss: 1 }], lines, S, async (fen) => {
      searched.push(fen);
      return empty;
    });
    expect(ideas.map((m) => m.san)).toEqual(['Nf3', 'Nc3']);
    expect(ideas[1]!.like).toBe(0);
    // the opponent's null move now, then one per move (no opponent threat: no "does it still work" searches)
    expect(searched.length).toBe(3);
  });
});
