// Engine-backed analyzeMove scenarios (real Stockfish). Auto-skipped without the binary.
// Each scenario prints the analysis summary on failure (`dump`), so it's clear whether the position or the code is wrong.
import { DEFAULT_SETTINGS, type MoveAnalysis } from '@chess-coach/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeMove, type AnalyzeInput } from '../src/analysis/analyzeMove';
import { SearchCache } from '../src/analysis/searchCache';
import { Engine, engineAvailable } from '../src/engine/uci';
import { legalFen, playUci } from './helpers/classifyHelpers';

const T = 180_000;
const S = DEFAULT_SETTINGS;

function dump(a: MoveAnalysis): string {
  const c = (x: MoveAnalysis['played'] | null) =>
    x ? `${x.san} rank ${x.rank} wl ${x.winLoss.toFixed(1)} ${x.explainable ? 'explainable' : x.notExplainableReasons?.join(',')}\n    ${x.explanation ? [...x.explanation.immediate.text, '|', ...x.explanation.short.text, '|', ...x.explanation.long.text].join(' ') : ''}` : 'none';
  return [
    `${a.fenBefore} ${a.san}: ${a.label} — ${a.labelText}`,
    `  played: ${c(a.played)}`,
    `  best: ${c(a.best)}`,
    `  pick: ${c(a.pick)}`,
    `  candidates: ${a.candidates.map((x) => `${x.san} ${JSON.stringify(x.score)} ${x.explainable ? '✓' : x.notExplainableReasons}`).join(' · ')}`,
  ].join('\n');
}
const allText = (c: MoveAnalysis['played'] | null) => (c?.explanation ? [...c.explanation.immediate.text, ...c.explanation.short.text, ...c.explanation.long.text].join(' ') : '');

describe.skipIf(!engineAvailable())('analyzeMove on real positions (Stockfish)', () => {
  let engine: Engine;
  const cache = new SearchCache(null);
  const run = (input: AnalyzeInput) => analyzeMove({ searcher: engine, cache, settings: S }, input);
  beforeAll(async () => {
    engine = await Engine.start({ threads: 4, hashMb: 128 });
  });
  afterAll(async () => {
    await engine?.quit();
  });

  it(
    'a) a fork: the played explanation mentions it (Immediate and Short term)',
    async () => {
      // middlegame (queens off): the knight jumps to c7, forking the king on e8 and the rook on a8
      const fen = legalFen('r3kb1r/pp3ppp/2p1pn2/1N6/3P4/8/PPP2PPP/R1B1KB1R w KQkq - 0 1');
      const a = await run({ fenBefore: fen, uci: 'b5c7' });
      const msg = dump(a);
      expect(a.played.explanation!.immediate.facts.some((f) => f.type === 'fork'), msg).toBe(true);
      expect(a.played.explanation!.immediate.text.join(' '), msg).toMatch(/Fork/);
      expect(a.played.explanation!.short.text.join(' '), msg).toMatch(/forks the king and rook/);
      expect(['best', 'great', 'excellent'], msg).toContain(a.label);
      expect(a.pickIsBest || a.pick !== null, msg).toBe(true);
    },
    T,
  );

  it(
    'b) hangs the queen at ~+17: Blunder with the material reason, still-winning wording',
    async () => {
      const fen = legalFen('r5k1/ppp2pp1/7p/8/8/2N2N2/PPPQ1PPP/4R1K1 w - - 0 1');
      const a = await run({ fenBefore: fen, uci: 'd2g5' });
      const msg = dump(a);
      expect(a.label, msg).toBe('blunder');
      expect(a.labelReason.material, msg).toMatchObject({ label: 'blunder', hung: { role: 'queen', square: 'g5' } });
      expect(a.labelText, msg).toMatch(/leaves the queen on g5 hanging/);
      expect(a.labelText, msg).toMatch(/still winning/);
      expect(a.played.explanation!.immediate.text.join(' '), msg).toMatch(/queen on g5 hanging/);
      expect(a.played.notExplainableReasons, msg).toContain('material-rule');
      expect(a.evalBefore.cp ?? 0, msg).toBeGreaterThan(a.evalAfter.cp ?? 0);
    },
    T,
  );

  it(
    'c) engine #1 is a quiet move with no concrete point, a lower-ranked move has a tactic: pick = that move, best = #1',
    async () => {
      // Kasparov-Topalov 1999 after 17...Kb8: #1 is a quiet queen/pawn move (varies between runs: Qf4 / g4 / Qe3),
      // Qh4 (pinning Nf6 to the queen on e7) is within the Good margin and the shallow search agrees.
      const fen = legalFen(PICK_FEN);
      const a = await run({ fenBefore: fen, uci: PICK_PLAYED });
      const msg = dump(a);
      expect(a.best.uci, msg).not.toBe(a.pick?.uci);
      expect(a.pickIsBest, msg).toBe(false);
      expect(a.deepOnly, msg).toBe(false);
      expect(a.best.explainable, msg).toBe(false);
      expect(a.pick!.rank, msg).toBeGreaterThan(1);
      expect(a.pick!.winLoss, msg).toBeLessThanOrEqual(S.suggest.pickMaxLoss);
      expect(allText(a.pick), msg).toMatch(/[Pp]ins|[Ww]ins|Takes|[Ff]ork|Threatens/);
      expect(a.best.notExplainableReasons, msg).toContain('no-concrete-fact');
      expect(a.arrows.map((x) => x.kind).sort(), msg).toEqual(expect.arrayContaining(['best', 'pick', 'played']));
    },
    T,
  );

  it(
    'd) mate in 1 available, something else played: best = the mate, explained, and suggested',
    async () => {
      const fen = legalFen('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
      const a = await run({ fenBefore: fen, uci: 'g1f1' });
      const msg = dump(a);
      expect(a.best.uci, msg).toBe('a1a8');
      expect(a.best.explanation!.immediate.text, msg).toContain('Checkmate — White wins.');
      expect(a.pick?.uci, msg).toBe('a1a8');
      expect(a.pickIsBest, msg).toBe(true);
      expect(['best', 'great'], msg).not.toContain(a.label);
      expect(a.evalBefore, msg).toEqual({ mate: 1 });
    },
    T,
  );

  it(
    'e) checkmate delivered: Best, "Checkmate", no threat, mate eval after',
    async () => {
      const fen = legalFen('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
      const a = await run({ fenBefore: fen, uci: 'a1a8' });
      const msg = dump(a);
      expect(a.label, msg).toBe('best');
      expect(a.labelText, msg).toMatch(/checkmate/);
      expect(a.played.explanation!.immediate.text, msg).toEqual(['Checkmate — White wins.']);
      expect(a.arrows.some((x) => x.kind === 'threat'), msg).toBe(false);
      expect(a.winAfter, msg).toBeGreaterThan(97); // mate = +1000 cp in the Lichess formula
      expect(a.accuracy, msg).toBe(100);
    },
    T,
  );

  it(
    'f) stalemate: a winning position thrown away',
    async () => {
      const fen = legalFen('k7/8/8/8/8/8/8/1Q5K w - - 0 1');
      const a = await run({ fenBefore: fen, uci: 'b1b6' });
      const msg = dump(a);
      expect(a.evalAfter, msg).toEqual({ cp: 0 });
      expect(a.label, msg).toBe('blunder');
      expect(a.played.explanation!.immediate.text.join(' '), msg).toMatch(/Stalemate/);
      expect(a.best.uci, msg).not.toBe('b1b6');
    },
    T,
  );

  it(
    'g) promotion',
    async () => {
      const fen = legalFen('8/4P1k1/8/8/8/8/6K1/8 w - - 0 1');
      const a = await run({ fenBefore: fen, uci: 'e7e8q' });
      const msg = dump(a);
      expect(a.san, msg).toBe('e8=Q');
      expect(a.label, msg).toBe('best');
      expect(a.played.explanation!.immediate.text.join(' '), msg).toMatch(/Promotes the pawn to a queen/);
      // under-promotion is much worse (a knight can't win alone)
      const n = await run({ fenBefore: fen, uci: 'e7e8n' });
      expect(['mistake', 'blunder'], dump(n)).toContain(n.label);
    },
    T,
  );

  it(
    'h) single legal move: Forced, "had to play this"; few legal moves are fine',
    async () => {
      const fen = legalFen('7k/8/8/8/8/8/6q1/7K w - - 0 1');
      const a = await run({ fenBefore: fen, uci: 'h1g2' });
      const msg = dump(a);
      expect(a.label, msg).toBe('forced');
      expect(a.candidates, msg).toHaveLength(1);
      expect(a.played.explanation!.long.facts[0], msg).toEqual({ type: 'necessary', onlyMove: true });
    },
    T,
  );

  it(
    'previous-move context: a recapture after the opponent captured is a recapture, and prev is computed when missing',
    async () => {
      const p0 = legalFen('rnbqkb1r/pppp1ppp/5n2/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 2 3');
      const p1 = playUci(p0, ['f1c4']);
      const p2 = playUci(p1, ['f6e4']);
      const a = await run({ fenBefore: p2, uci: 'c3e4', prev: { fenBefore: p1, uci: 'f6e4' } });
      const msg = dump(a);
      const cap = a.played.explanation!.immediate.facts.find((f) => f.type === 'capture');
      expect(cap, msg).toMatchObject({ outcome: 'recapture' });
      expect(a.played.explanation!.immediate.text.join(' '), msg).toMatch(/Recaptures/);
    },
    T,
  );
});

// (c) premise: found by scanning the bench/games reports for pick != best; stable over repeated cold runs.
const PICK_FEN = '1k1r3r/1b2qp1p/pn1p1npQ/1pp5/4P3/PNN2PP1/1PP4P/1K1R1B1R w - - 1 18';
const PICK_PLAYED = 'b3a5'; // the game move 18.Na5
