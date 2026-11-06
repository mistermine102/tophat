// Engine-backed classification scenarios (real Stockfish, deep MultiPV 5 + searchmoves for the played move, built
// the way M2's analyzeMove will). Auto-skipped when the binary is missing (set STOCKFISH_PATH or run
// `npm run setup:engine`). Every scenario first checks its premise against the engine, so a failure says whether
// the position or the classifier is at fault.
import { DEFAULT_SETTINGS, scoreToCp } from '@chess-coach/shared';
import { INITIAL_FEN } from 'chessops/fen';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LABEL_SEVERITY } from '../src/analysis/classify';
import { parseSquare } from 'chessops/util';
import { lineMaterial, positionFromFen } from '../src/chess/material';
import { hangingLoss } from '../src/chess/see';
import { Engine, engineAvailable } from '../src/engine/node';
import { analyseMove, describe as dump, legalFen, playUci, prevContext } from './helpers/classifyHelpers';

const S = DEFAULT_SETTINGS;
const T = 120_000;
const after = (moves: string) => playUci(INITIAL_FEN, moves.split(' ').filter(Boolean));
const horizon = { horizonPlies: S.material.quietHorizonPlies };

describe.skipIf(!engineAvailable())('classification on real positions (Stockfish)', () => {
  let engine: Engine;
  beforeAll(async () => {
    engine = await Engine.start({ threads: Number(process.env.TEST_ENGINE_THREADS ?? 2), hashMb: 128 });
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
      // premises (engine cp at huge evals is noisy under CPU load: wide margins; the material facts are what matter)
      expect(scoreToCp(a.input.best.score), msg).toBeGreaterThanOrEqual(600); // ~+12 or better, typically
      expect(scoreToCp(a.input.played.score), msg).toBeGreaterThan(150); // still winning after
      expect(a.result.label, msg).toBe('blunder');
      expect(a.result.labelReason.material, msg).toMatchObject({ label: 'blunder', hung: { role: 'queen', square: 'g5', color: 'white' } });
      // the queen (9) for a pawn; the PV may win a pawn or two back later in the 12-ply horizon (measured 6..8)
      expect(a.result.labelReason.material!.loss, msg).toBeGreaterThanOrEqual(5);
      // the point of the test: win chance alone is milder (asserted when the engine agrees the position stays won)
      if (scoreToCp(a.input.played.score) >= 500) expect(LABEL_SEVERITY[a.result.labelReason.winChance], msg).toBeLessThan(LABEL_SEVERITY.blunder);
    },
    T,
  );

  it(
    'b1) LĂ©gal: 5.Nxe5! "sacrifices" the queen (5...Bxd1? 6.Bxf7+ Ke7 7.Nd5#) -> not flagged (Best/Great)',
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
      expect(a.result.label, msg).toBe('excellent'); // a slower mate keeps win% (Excellent: only the #1 is Best)
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
      expect(a.result.labelReason.material?.loss ?? 0, msg).toBeLessThan(2); // deep lines may drift a pawn; the rule must not fire
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
    'a2) hangs the queen at ~+18 -> ~+8.5 (both beyond the win% clamp): still a Blunder (unclamped guard)',
    async () => {
      // White: Q+R+2N vs R. 1.Qg5?? hxg5 2.Nxg5 leaves R+2N vs R.
      const fen = legalFen('r5k1/ppp2pp1/7p/8/8/2N2N2/PPPQ1PPP/4R1K1 w - - 0 1');
      const a = await analyseMove(engine, fen, 'd2g5');
      const msg = dump(a);
      // premises with wide margins (cp at these evals is noisy under CPU load, e.g. 1478 instead of >= 1500)
      expect(scoreToCp(a.input.best.score), msg).toBeGreaterThanOrEqual(1000);
      expect(scoreToCp(a.input.played.score), msg).toBeGreaterThanOrEqual(300);
      // win% barely moves when both stay beyond the clamp
      if (scoreToCp(a.input.played.score) >= 1000) expect(a.result.labelReason.winChance, msg).not.toBe('blunder');
      expect(a.result.labelReason.material, msg).toMatchObject({ label: 'blunder', hung: { role: 'queen', square: 'g5' } });
      expect(a.result.label, msg).toBe('blunder');
    },
    T,
  );

  it(
    'a3) had a forced mate, hangs the queen and no longer mates (still > +10) -> Blunder',
    async () => {
      for (const fen of ['r5k1/ppp2pp1/7p/8/8/2B2N2/PPPQ1PPP/3RR1K1 w - - 0 1', '6k1/ppp2pp1/7p/8/8/5N2/PPPQ1PPP/4R1K1 w - - 0 1']) {
        const a = await analyseMove(engine, legalFen(fen), 'd2g5');
        const msg = dump(a);
        expect(a.input.best.score.mate ?? 0, msg).toBeGreaterThan(0);
        expect(a.input.played.score.mate, msg).toBeUndefined();
        expect(scoreToCp(a.input.played.score), msg).toBeGreaterThan(400); // still clearly winning (wide margin)
        expect(a.result.labelReason.material, msg).toMatchObject({ label: 'blunder', hung: { role: 'queen', square: 'g5' } });
        expect(a.result.label, msg).toBe('blunder');
      }
    },
    T,
  );

  it(
    'M3 allowed mate: Opera game 15...Nxd7?? walks into mate in 2 (16.Qb8+! Nxb8 17.Rd8#) -> Blunder although lost anyway',
    async () => {
      const fen = legalFen('4kb1r/p2B1ppp/4qn2/4p1B1/4P3/1Q6/PPP2PPP/2KR4 b k - 0 15');
      const a = await analyseMove(engine, fen, 'f6d7');
      const msg = dump(a);
      expect(a.input.played.score.mate, msg).toBe(-2);
      expect(a.input.best.score.mate === undefined || a.input.best.score.mate <= -5, msg).toBe(true); // 15...Qxd7 avoids it
      expect(a.result.winLoss, msg).toBeLessThan(2); // invisible by win chance (both ~2 %)
      expect(a.result.labelReason.allowedMate, msg).toMatchObject({ matedIn: 2 });
      expect(a.result.label, msg).toBe('blunder');
      // the best move (Qxd7) itself is not flagged
      const q = await analyseMove(engine, fen, 'e6d7');
      expect(q.result.labelReason.allowedMate, dump(q)).toBeUndefined();
    },
    T,
  );

  it(
    'M3 missed mate: Ra8# available, a quiet king move keeps a won rook ending -> Miss',
    async () => {
      const fen = legalFen('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
      const a = await analyseMove(engine, fen, 'g1f1');
      const msg = dump(a);
      expect(a.input.best.score.mate, msg).toBe(1);
      expect(a.input.played.score.mate, msg).toBeUndefined();
      expect(a.result.labelReason.missedMate, msg).toEqual({ mateIn: 1 });
      expect(a.result.label, msg).toBe('miss');
      // the mate itself is Best
      expect((await analyseMove(engine, fen, 'a1a8')).result.label).toBe('best');
    },
    T,
  );

  it(
    'M3 a "hung" piece is en prise right after the move (Opera 10...cxb5: nothing is; Qg5?? at +12: the queen)',
    async () => {
      const cases: [string, string][] = [
        ['rn2kb1r/p3qppp/2p2n2/1N2p1B1/2B1P3/1Q6/PPP2PPP/R3K2R b KQkq - 0 10', 'c6b5'],
        ['r5k1/ppp2pp1/7p/8/8/5N2/PPPQ1PPP/4R1K1 w - - 0 1', 'd2g5'],
      ];
      for (const [fen, uci] of cases) {
        const a = await analyseMove(engine, legalFen(fen), uci);
        const msg = dump(a);
        const m = a.result.labelReason.material;
        if (m?.hung) {
          const after = positionFromFen(playUci(legalFen(fen), [uci]));
          const sq = parseSquare(m.hung.square)!;
          expect(after.board.get(sq), msg).toMatchObject({ role: m.hung.role, color: m.hung.color });
          expect(hangingLoss(after, sq), msg).toBeGreaterThan(0);
        }
        if (uci === 'c6b5') expect(m?.hung, msg).toBeUndefined();
        else expect(m?.hung, msg).toMatchObject({ role: 'queen', square: 'g5' });
      }
    },
    T,
  );
});
