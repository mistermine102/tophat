import { describe, expect, it } from 'vitest';
import { parseUci, type NormalMove } from 'chessops';
import { makeFen } from 'chessops/fen';
import type { Fact, PositionalFeature } from '@chess-coach/shared';
import { positionFromFen } from '../src/chess/attacks';
import { positionalDelta, positionalFeatures } from '../src/facts/positional';

/** Plays UCI moves from `fen` and returns [fenBefore, fenAfter]. */
function play(fen: string, ...ucis: string[]): [string, string] {
  const pos = positionFromFen(fen);
  for (const u of ucis) {
    const m = parseUci(u) as NormalMove;
    if (!pos.isLegal(m)) throw new Error(`illegal ${u} in ${makeFen(pos.toSetup())}`);
    pos.play(m);
  }
  return [fen, makeFen(pos.toSetup())];
}
type Pos = Extract<Fact, { type: 'positional' }>;
const delta = (fen: string, ...ucis: string[]) => {
  const mover = positionFromFen(fen).turn;
  const [b, a] = play(fen, ...ucis);
  return positionalDelta(b, a, mover) as Pos[];
};
const find = (fs: Pos[], feature: PositionalFeature, side?: 'own' | 'opponent') =>
  fs.filter((f) => f.feature === feature && (side === undefined || f.side === side));

describe('positionalFeatures', () => {
  it('start position is symmetric', () => {
    const f = positionalFeatures('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(f.white.mobility).toBe(f.black.mobility);
    expect(f.white.centre).toBe(f.black.centre);
    expect(f.white.bishopPair).toBe(true);
    expect(f.white.pawns).toEqual({ passed: [], isolated: [], doubled: [], doubledCount: 0 });
    expect(f.white.development).toEqual({ undevelopedMinors: 4, castled: false, kingMoved: false });
    expect(f.white.kingSafety).toMatchObject({ square: 'e1', shield: 3, openFiles: 0, zoneAttackers: 0 });
  });

  it('pawn structure: passed, isolated, doubled', () => {
    const f = positionalFeatures('4k3/8/8/8/1P6/1P6/5P1P/4K3 w - - 0 1');
    expect(f.white.pawns.passed.sort()).toEqual(['b4', 'f2', 'h2']); // no black pawns at all
    expect(f.white.pawns.isolated.sort()).toEqual(['b3', 'b4', 'f2', 'h2']);
    expect(f.white.pawns.doubled.sort()).toEqual(['b3', 'b4']);
    expect(f.white.pawns.doubledCount).toBe(1);
    // (b3 is a rear doubled pawn: not counted as passed)
    const g = positionalFeatures('4k3/2p5/8/8/1P6/8/8/4K3 w - - 0 1');
    expect(g.white.pawns.passed).toEqual([]);
    expect(g.black.pawns.passed).toEqual([]);
  });

  it('rooks on open and semi-open files', () => {
    const f = positionalFeatures('4k3/p7/8/8/8/8/1P6/R2R2K1 w - - 0 1');
    expect(f.white.rooks.open).toEqual(['d1']);
    expect(f.white.rooks.semiOpen).toEqual(['a1']);
  });

  it('is fast (< 1 ms per position)', () => {
    const fen = 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 9';
    const pos = positionFromFen(fen);
    positionalFeatures(pos);
    const n = 2000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) positionalFeatures(pos);
    const per = (performance.now() - t0) / n;
    expect(per).toBeLessThan(1);
  });
});

describe('positionalDelta', () => {
  it('passed pawn created by a capture', () => {
    const fs = delta('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 'e4d5');
    expect(find(fs, 'passed-pawn', 'own')).toEqual([
      { type: 'positional', feature: 'passed-pawn', delta: 1, side: 'own', detail: '0->1', squares: ['d5'] },
    ]);
  });

  it('isolated pawn created (own: negative)', () => {
    const fs = delta('4k3/8/8/8/8/4n3/2PP1PP1/4K3 w - - 0 1', 'd2e3');
    expect(find(fs, 'isolated-pawn', 'own')).toEqual([
      { type: 'positional', feature: 'isolated-pawn', delta: -1, side: 'own', detail: '0->1', squares: ['c2'] },
    ]);
  });

  it("isolating the opponent's pawn is positive", () => {
    // Black captures on d2... from Black's point of view White's c2 becomes isolated
    const fs = delta('4k3/8/8/8/8/4p3/2PP1PP1/4K3 b - - 0 1', 'e3d2', 'e1d2');
    const f = find(fs, 'isolated-pawn', 'opponent');
    expect(f).toHaveLength(1);
    expect(f[0].delta).toBe(1);
    expect(f[0].squares).toEqual(['c2']);
  });

  it('doubled pawns after a recapture towards the centre', () => {
    const fs = delta('4k3/8/8/8/8/2n5/1P1P4/4K3 w - - 0 1', 'b2c3', 'e8d8', 'd2d3');
    const own = find(fs, 'doubled-pawn', 'own');
    expect(own).toHaveLength(0); // b2xc3 then d3: c3 + d3, no doubling
    const fs2 = delta('4k3/8/8/8/8/3n4/2P1P3/4K3 w - - 0 1', 'c2d3');
    expect(find(fs2, 'doubled-pawn', 'own')).toHaveLength(0);
    const fs3 = delta('4k3/8/8/8/8/2n5/1PP5/4K3 w - - 0 1', 'b2c3');
    expect(find(fs3, 'doubled-pawn', 'own')).toEqual([
      { type: 'positional', feature: 'doubled-pawn', delta: -1, side: 'own', detail: '0->1', squares: ['c2', 'c3'] },
    ]);
  });

  it('king shield weakened by a pawn move', () => {
    const fs = delta('3qk3/8/8/8/8/8/5PPP/6K1 w - - 0 1', 'g2g4');
    const ks = find(fs, 'king-safety', 'own');
    expect(ks).toHaveLength(1);
    expect(ks[0].delta).toBe(-1);
    expect(ks[0].detail).toContain('shield 3->2');
  });

  it('king safety is not discussed without enemy attacking material, nor for central kings', () => {
    expect(find(delta('4k3/8/8/8/8/8/5PPP/6K1 w - - 0 1', 'g2g4'), 'king-safety')).toEqual([]);
    expect(find(delta('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e4'), 'king-safety')).toEqual([]);
  });

  it('castling improves king safety and development', () => {
    const fs = delta('r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', 'e1g1');
    expect(find(fs, 'king-safety', 'own')[0].delta).toBeGreaterThan(0);
    expect(find(fs, 'development', 'own')[0].delta).toBe(1);
  });

  it('bishop pair lost (own, after a trade) and taken from the opponent', () => {
    const fs = delta('r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 3 3', 'b5c6', 'd7c6');
    expect(find(fs, 'bishop-pair', 'own')).toEqual([{ type: 'positional', feature: 'bishop-pair', delta: -1, side: 'own' }]);
    const fs2 = delta('4k3/8/8/8/8/8/8/r1B1KB2 b - - 0 1', 'a1c1');
    expect(find(fs2, 'bishop-pair', 'opponent')).toEqual([{ type: 'positional', feature: 'bishop-pair', delta: 1, side: 'opponent' }]);
  });

  it('rook to an open file', () => {
    const fs = delta('4k3/pp4pp/8/8/8/8/PP4PP/1R4K1 w - - 0 1', 'b1d1');
    expect(find(fs, 'open-file-rook', 'own')).toEqual([
      { type: 'positional', feature: 'open-file-rook', delta: 1, side: 'own', detail: '0->1', squares: ['d1'] },
    ]);
    // rook along a closed file: nothing
    expect(find(delta('4k3/pp4pp/8/8/8/8/PP4PP/1R4K1 w - - 0 1', 'g1f1'), 'open-file-rook')).toEqual([]);
  });

  it('development in the opening', () => {
    const fs = delta('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'g1f3');
    expect(find(fs, 'development', 'own')).toEqual([{ type: 'positional', feature: 'development', delta: 1, side: 'own', detail: '0->1' }]);
    // no development facts late in the game
    expect(find(delta('4k3/8/8/8/8/8/8/4K1N1 w - - 0 40', 'g1f3'), 'development')).toEqual([]);
  });

  it('a quiet symmetrical move produces no structural facts', () => {
    const fs = delta('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'b1c3');
    for (const f of ['passed-pawn', 'isolated-pawn', 'doubled-pawn', 'bishop-pair', 'open-file-rook', 'king-safety'] as const) {
      expect(find(fs, f)).toEqual([]);
    }
  });

  it('mobility/centre/space deltas use the mover POV', () => {
    const fs = delta('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e4');
    const mob = find(fs, 'mobility');
    expect(mob).toHaveLength(1);
    expect(mob[0].delta).toBeGreaterThan(0);
    expect(find(fs, 'centre-control')[0]?.delta ?? 0).toBeGreaterThan(0);
  });
});
