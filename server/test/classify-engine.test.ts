// Engine-backed classification scenarios (real Stockfish, deep MultiPV 5 + searchmoves for the played move, built
// the way M2's analyzeMove will). Auto-skipped when the binary is missing (set STOCKFISH_PATH or run
// `npm run setup:engine`). Every scenario first checks its premise against the engine, so a failure says whether
// the position or the classifier is at fault.
import { DEFAULT_SETTINGS, scoreToCp } from '@chess-coach/shared';
import { INITIAL_FEN } from 'chessops/fen';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LABEL_SEVERITY } from '../src/analysis/classify';
import { lineMaterial } from '../src/chess/material';
import { Engine, engineAvailable } from '../src/engine/uci';
import { analyseMove, describe as dump, legalFen, playUci, prevContext } from './helpers/classifyHelpers';

const S = DEFAULT_SETTINGS;
const T = 120_000;
const after = (moves: string) => playUci(INITIAL_FEN, moves.split(' ').filter(Boolean));
const horizon = { horizonPlies: S.material.quietHorizonPlies };

describe.skipIf(!engineAvailable())('classification on real positions (Stockfish)', () => {
  let engine: Engine;
  beforeAll(async () => {
    engine = await Engine.start({ threads: 4, hashMb: 128 });
  });
  afterAll(async () => {
    await engine?.quit();
  });

  it(
    'a) hangs the queen while +12: Blunder by the material rule, win-chance label milder',
    async () => {
      // White: Q+R+N vs R. 1.Qg5?? hxg5 2.Nxg5 leaves R+N vs R: still clearly winning.
      const fen = legalFen('r5k1/ppp2pp1/7p/8/8/5N2/PPPQ1PPP/4R1K1 w - - 0 1');
      const a = await analyseMove(engine, fen, 'd2g5');
      const msg = dump(a);
      expect(scoreToCp(a.input.best.score), msg).toBeGreaterThanOrEqual(1000); // ~+12 or better
      expect(scoreToCp(a.input.played.score), msg).toBeGreaterThan(300); // still clearly winning after
      expect(a.result.label, msg).toBe('blunder');
      expect(a.result.labelReason.material, msg).toMatchObject({ label: 'blunder', hung: { role: 'queen', square: 'g5', color: 'white' } });
      expect(a.result.labelReason.material!.loss, msg).toBeGreaterThanOrEqual(8);
      expect(LABEL_SEVERITY[a.result.labelReason.winChance], msg).toBeLessThan(LABEL_SEVERITY.blunder);
    },
    T,
  );

  it(
    'b1) Légal: 5.Nxe5! "sacrifices" the queen (5...Bxd1? 6.Bxf7+ Ke7 7.Nd5#) -> not flagged (Best/Great)',
    async () => {
      const fen = after('e2e4 e7e5 g1f3 d7d6 f1c4 c8g4 b1c3 g7g6');
      const a = await analyseMove(engine, fen, 'f3e5', { book: false });
      const msg = dump(a);
      expect(a.input.playedIsBest, msg).toBe(true);
      expect(['best', 'great'], msg).toContain(a.result.label);
      expect(a.result.labelReason.material?.label, msg).toBeUndefined();
    },
    T,
  );

  it(
    'b2) smothered-mate pattern: 1.Nf7+ (engine #2, queen sacrifice later in the line) -> not flagged',
    async () => {
      const fen = legalFen('5r1k/6pp/7N/8/2Q5/8/5PPP/6K1 w - - 0 1');
      const a = await analyseMove(engine, fen, 'h6f7');
      const msg = dump(a);
      expect(a.input.best.score.mate, msg).toBe(2); // Qg8+! Rxg8 Nf7#
      expect(a.input.playedIsBest, msg).toBe(false);
      expect(a.input.played.score.mate, msg).toBeGreaterThan(0);
      expect(a.result.labelReason.material, msg).toMatchObject({ loss: 0 });
      expect(a.result.labelReason.material?.label, msg).toBeUndefined();
      expect(a.result.label, msg).toBe('best'); // a slower mate keeps win%
      // and the mating queen sacrifice itself
      const q = await analyseMove(engine, fen, 'c4g8');
      expect(q.result.label, dump(q)).toBe('best');
    },
    T,
  );

  it(
    'b3) Muzio Gambit 5.O-O: a real knight sacrifice (gxf3), engine-approved -> not flagged by material',
    async () => {
      const fen = after('e2e4 e7e5 f2f4 e5f4 g1f3 g7g5 f1c4 g5g4');
      const a = await analyseMove(engine, fen, 'e1g1', { book: false });
      const msg = dump(a);
      const played = lineMaterial(fen, a.input.played.pv, horizon);
      // the knight really is given up (for pawns): net material down at the quiet point
      expect(played.moves.some((m) => m.color === 'black' && m.captured?.role === 'knight'), msg).toBe(true);
      expect(played.delta, msg).toBeLessThan(0);
      expect(a.result.labelReason.material?.label, msg).toBeUndefined();
      expect(LABEL_SEVERITY[a.result.label], msg).toBeLessThanOrEqual(LABEL_SEVERITY.good);
      // in a real game it is a book move
      const b = await analyseMove(engine, fen, 'e1g1');
      expect(b.result.label, dump(b)).toBe('book');
      expect(b.result.labelReason.book?.name, dump(b)).toMatch(/Muzio/);
    },
    T,
  );

  it(
    'c) only-move defence (keeping the opposition: 1...Ke6!) -> Great',
    async () => {
      const fen = legalFen('8/8/3k4/8/3PK3/8/8/8 b - - 0 1');
      const a = await analyseMove(engine, fen, 'd6e6');
      const msg = dump(a);
      expect(a.input.playedIsBest, msg).toBe(true);
      const winSecond = a.result.winBest - a.result.labelReason.great!.secondBestLoss;
      expect(a.result.winBest - winSecond, msg).toBeGreaterThanOrEqual(S.great.secondBestMinLoss);
      expect(a.result.winBest, msg).toBeGreaterThanOrEqual(S.great.minWinAfterBest);
      expect(a.result.winBest, msg).toBeLessThanOrEqual(S.great.maxWinAfterBest);
      expect(a.result.label, msg).toBe('great');
      // any other move loses -> e.g. 1...Kc6? is a Blunder
      const bad = await analyseMove(engine, fen, 'd6c6');
      expect(bad.result.label, dump(bad)).toBe('blunder');
    },
    T,
  );

  it(
    'd) single legal move -> Forced',
    async () => {
      const fen = legalFen('7k/8/8/8/8/8/6q1/7K w - - 0 1');
      const a = await analyseMove(engine, fen, 'h1g2');
      expect(a.input.legalMoveCount).toBe(1);
      expect(a.lines.length).toBe(1);
      expect(a.result.label, dump(a)).toBe('forced');
    },
    T,
  );

  it(
    'e) opponent hangs a bishop (...Bg4??), mover ignores it with a quiet move -> Miss',
    async () => {
      const p0 = legalFen('r1b3k1/ppp2pp1/7p/8/8/2N2N1P/P4PP1/R5K1 b - - 0 1'); // White +2..+3.5
      const { ctx, analysed } = await prevContext(engine, p0, 'c8g4');
      const pmsg = dump(analysed);
      expect(ctx.winLoss, pmsg).toBeGreaterThanOrEqual(S.miss.opponentMinLoss); // the opponent's move was a Mistake+
      const fen = playUci(p0, ['c8g4']);
      const a = await analyseMove(engine, fen, 'a1b1', { prev: ctx }); // 2.Rb1 (quiet; hxg4 was free)
      const msg = `${pmsg}\n${dump(a)}`;
      expect(a.input.best.uci, msg).toBe('h3g4');
      expect(a.result.winLoss, msg).toBeGreaterThan(S.miss.playedMinLoss);
      expect(a.result.winLoss, msg).toBeLessThanOrEqual(S.labels.mistakeMaxLoss);
      expect(a.result.labelReason.material?.label, msg).toBeUndefined(); // not taking is not "throwing away"
      expect(a.result.labelReason.miss, msg).toBe(true);
      expect(a.result.label, msg).toBe('miss');
      // without the previous-move context it is a plain Inaccuracy/Mistake
      const noCtx = await analyseMove(engine, fen, 'a1b1');
      expect(['inaccuracy', 'mistake'], dump(noCtx)).toContain(noCtx.result.label);
    },
    T,
  );

  it(
    'f) even queen trade while winning -> not flagged',
    async () => {
      const fen = legalFen('3q1rk1/ppp2ppp/8/8/8/8/PPP2PPP/R2Q1RK1 w - - 0 1'); // White up a rook
      const a = await analyseMove(engine, fen, 'd1d8');
      const msg = dump(a);
      expect(scoreToCp(a.input.best.score), msg).toBeGreaterThan(400);
      expect(a.result.labelReason.material?.loss ?? 0, msg).toBe(0);
      expect(a.result.labelReason.material?.label, msg).toBeUndefined();
      expect(LABEL_SEVERITY[a.result.label], msg).toBeLessThanOrEqual(LABEL_SEVERITY.good);
    },
    T,
  );

  it(
    'g) hanging a piece in an equal position (1.e4 e5 2.Ba6??) -> Blunder by win chance',
    async () => {
      const fen = after('e2e4 e7e5');
      const a = await analyseMove(engine, fen, 'f1a6');
      const msg = dump(a);
      expect(Math.abs(scoreToCp(a.input.best.score)), msg).toBeLessThan(100);
      expect(a.result.labelReason.winChance, msg).toBe('blunder');
      expect(a.result.label, msg).toBe('blunder');
      expect(a.result.labelReason.book, msg).toBeUndefined();
      expect(a.result.labelReason.material?.hung, msg).toMatchObject({ role: 'bishop', square: 'a6' });
    },
    T,
  );

  it(
    'h) mate in 2 available, played move still mates in 3 -> not worse than Excellent',
    async () => {
      const fen = legalFen('7k/8/5K2/8/8/8/8/1Q6 w - - 0 1');
      const a = await analyseMove(engine, fen, 'b1h1');
      const msg = dump(a);
      expect(a.input.best.score.mate, msg).toBe(2);
      expect(a.input.played.score.mate, msg).toBe(3);
      expect(LABEL_SEVERITY[a.result.label], msg).toBeLessThanOrEqual(LABEL_SEVERITY.excellent);
    },
    T,
  );

  it(
    'book: traps in the Lichess list lose Book (Fool\'s mate 2.g4??), dubious gambits keep it (Halloween 4.Nxe5)',
    async () => {
      const fool = await analyseMove(engine, after('f2f3 e7e5'), 'g2g4');
      expect(fool.result.labelReason.book, dump(fool)).toBeDefined();
      expect(fool.result.label, dump(fool)).toBe('blunder');
      const halloween = await analyseMove(engine, after('e2e4 e7e5 g1f3 b8c6 b1c3 g8f6'), 'f3e5');
      expect(halloween.result.label, dump(halloween)).toBe('book');
      expect(halloween.result.labelReason.material?.label, dump(halloween)).toBeUndefined();
      // the main line is book all the way
      const ruy = await analyseMove(engine, after('e2e4 e7e5 g1f3 b8c6'), 'f1b5');
      expect(ruy.result).toMatchObject({ label: 'book', labelReason: { book: { eco: 'C60', name: 'Ruy Lopez' } } });
    },
    T,
  );

  it(
    'SPEC limitation (documented): hanging the queen while mating stays mild — the clamp hides the drop',
    async () => {
      // White mates in ~4; 1.Qg5?? hxg5 2.Nxg5 is still ~+9 (>= +10 clamps to 1000): eval drop < 250
      const fen = legalFen('6k1/ppp2pp1/7p/8/8/5N2/PPPQ1PPP/4R1K1 w - - 0 1');
      const a = await analyseMove(engine, fen, 'd2g5');
      const msg = dump(a);
      expect(a.result.labelReason.material!.loss, msg).toBeGreaterThanOrEqual(8);
      expect(a.result.labelReason.material!.evalDropCp, msg).toBeLessThan(S.material.blunderMinEvalDropCp);
      expect(LABEL_SEVERITY[a.result.label], msg).toBeLessThan(LABEL_SEVERITY.blunder);
    },
    T,
  );
});
