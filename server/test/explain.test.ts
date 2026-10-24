// Rendered text of representative facts (inline snapshots: review the text when they change).
import { DEFAULT_SETTINGS, type Fact } from '@chess-coach/shared';
import { describe, expect, it } from 'vitest';
import { formatEval, labelText, lineText, piecesPhrase, positionalText, renderExplanation, signed } from '../src/analysis/explain';
import { immediateFacts } from '../src/facts/immediate';
import { narrateLine } from '../src/facts/line';
import { legalFen } from './helpers/classifyHelpers';

const S = DEFAULT_SETTINGS;
const W = { mover: 'white' as const };
const B = { mover: 'black' as const };
const imm = (fen: string, uci: string, ctx: { mover: 'white' | 'black' } = W, extra: Fact[] = []) =>
  renderExplanation({ immediate: [...immediateFacts(legalFen(fen), uci), ...extra], short: [], long: [] }, ctx).immediate.text;

describe('helpers', () => {
  it('numbers and evals', () => {
    expect([signed(3), signed(-2), signed(0), signed(1.25)]).toEqual(['+3', '−2', '0', '+1.3']);
    expect([formatEval({ cp: 123 }), formatEval({ cp: -50 }), formatEval({ cp: 0 }), formatEval({ mate: 3 }), formatEval({ mate: -2 })]).toEqual(['+1.2', '−0.5', '0.0', '#3', '#−2']);
    expect([piecesPhrase(['rook']), piecesPhrase(['pawn', 'pawn']), piecesPhrase(['knight', 'pawn']), piecesPhrase(['exchange' as never])]).toEqual(['a rook', 'two pawns', 'a knight and a pawn', 'an exchange']);
  });
});

describe('immediate level', () => {
  it('fork with check: one sentence (check is implied)', () => {
    expect(imm('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', 'b5c7')).toMatchInlineSnapshot(`
      [
        "Fork: the knight on c7 attacks Black's king on e8 and rook on a8 at once.",
      ]
    `);
  });
  it('hanging the queen', () => {
    expect(imm('r5k1/ppp2pp1/7p/8/8/2N2N2/PPPQ1PPP/4R1K1 w - - 0 1', 'd2g5')).toMatchInlineSnapshot(`
      [
        "Leaves the queen on g5 hanging: Black can win it (−8 points).",
      ]
    `);
  });
  it('free capture; capture with check is one sentence', () => {
    expect(imm('4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1', 'd1d5')).toMatchInlineSnapshot(`
      [
        "Wins Black's knight on d5 for free (+3 points).",
      ]
    `);
    expect(imm('4k3/8/8/8/8/8/8/R2qK3 w - - 0 1', 'a1d1')).toMatchInlineSnapshot(`
      [
        "Wins Black's queen on d1 for free (+9 points).",
      ]
    `);
  });
  it('losing capture and even trade', () => {
    expect(imm('4k3/8/4p3/3n4/8/8/8/3RK3 w - - 0 1', 'd1d5')).toMatchInlineSnapshot(`
      [
        "Takes Black's knight on d5, but loses material when the pieces are traded off (−2 points).",
      ]
    `);
    expect(imm('4k3/8/4p3/3n4/8/4N3/8/4K3 w - - 0 1', 'e3d5')).toMatchInlineSnapshot(`
      [
        "Takes Black's knight on d5 — an even trade.",
      ]
    `);
  });
  it('pin, skewer, discovered check', () => {
    expect(imm('4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1', 'f1b5')).toMatchInlineSnapshot(`
      [
        "Pins Black's knight on c6 to the king — it is not allowed to move.",
        "Develops the bishop to b5.",
      ]
    `);
    expect(imm('8/7B/4k3/8/8/1q6/8/4K3 w - - 0 1', 'h7g8')).toMatchInlineSnapshot(`
      [
        "Skewers Black's king on e6: when it moves, the queen on b3 can be taken.",
      ]
    `);
    expect(imm('4k3/8/8/8/4N3/8/8/4R1K1 w - - 0 1', 'e4c5')).toMatchInlineSnapshot(`
      [
        "Discovered check: moving this piece opens a line to the king.",
      ]
    `);
  });
  it('checkmate says only that; promotion; castling; development (Black to move: colour names flip)', () => {
    expect(imm('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1a8')).toMatchInlineSnapshot(`
      [
        "Checkmate — White wins.",
      ]
    `);
    expect(imm('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7a8q')).toMatchInlineSnapshot(`
      [
        "Promotes the pawn to a queen, with check.",
      ]
    `);
    expect(imm('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', 'e8g8', B)).toMatchInlineSnapshot(`
      [
        "Castles kingside.",
      ]
    `);
    expect(imm('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2', 'b8c6', B)).toMatchInlineSnapshot(`
      [
        "Defends the pawn on e5, which was under attack.",
        "Develops the knight to c6.",
      ]
    `);
  });
  it('attack on an undefended piece; threats (gain, fork, mate)', () => {
    expect(imm('4k3/8/8/1r6/8/8/8/1N2K3 w - - 0 1', 'b1c3')).toMatchInlineSnapshot(`
      [
        "Attacks Black's rook on b5, which is undefended.",
        "Saves the knight: it was under attack on b1 and is safe on c3.",
        "Develops the knight to c3.",
      ]
    `);
    const fork: Fact = { type: 'fork', attacker: { role: 'knight', square: 'c7', color: 'white' }, targets: [{ role: 'king', square: 'e8', color: 'black' }, { role: 'rook', square: 'a8', color: 'black' }] };
    const threats: Fact[] = [
      { type: 'threat', move: 'b5c7', san: 'Nc7+', gain: 5, facts: [{ type: 'check' }, fork] },
      { type: 'threat', move: 'h5h7', san: 'Qxh7#', gain: 0, mateIn: 1, facts: [] },
    ];
    expect(renderExplanation({ immediate: threats, short: [], long: [] }, W).immediate.text).toMatchInlineSnapshot(`
      [
        "Threatens Nc7+, forking Black's king on e8 and rook on a8 (+5 points).",
        "Threatens checkmate with Qxh7#.",
      ]
    `);
  });
  it('allows mate; nothing notable', () => {
    expect(renderExplanation({ immediate: [{ type: 'allows-mate', inMoves: 1 }], short: [], long: [] }, B).immediate.text).toMatchInlineSnapshot(`
      [
        "Allows checkmate: White can mate next move.",
      ]
    `);
    expect(renderExplanation({ immediate: [], short: [], long: [] }, W)).toMatchInlineSnapshot(`
      {
        "immediate": {
          "facts": [
            {
              "type": "nothing-notable",
            },
          ],
          "text": [
            "Nothing special happens right away.",
          ],
        },
        "long": {
          "facts": [
            {
              "type": "nothing-notable",
            },
          ],
          "text": [
            "No notable long-term change.",
          ],
        },
        "short": {
          "facts": [
            {
              "type": "nothing-notable",
            },
          ],
          "text": [
            "No forcing follow-up.",
          ],
        },
      }
    `);
  });
  it('caps a level at 4 sentences', () => {
    const many: Fact[] = Array.from({ length: 6 }, (_, i) => ({ type: 'develop', piece: { role: 'knight', square: `${'abcdef'[i]}3`, color: 'white' } }));
    expect(renderExplanation({ immediate: many, short: [], long: [] }, W).immediate.text).toHaveLength(4);
  });
});

describe('short level', () => {
  it('fork line with a forced reply', () => {
    const fen = legalFen('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1');
    const { line } = narrateLine(fen, ['b5c7', 'e8d7', 'c7a8', 'd7c6'], { settings: S, plies: 4, forced: new Map([[1, { forced: true, alternatives: 4 }]]) });
    expect(lineText(line, W)).toMatchInlineSnapshot(`"Nc7+ forks the king and rook → Kd7 attacks the knight (forced) → Nxa8 wins the rook → Kc6 → White wins a rook (+5 points)."`);
  });
  it('hung queen line, mate line, quiet line', () => {
    const q = narrateLine(legalFen('r5k1/ppp2pp1/7p/8/8/2N2N2/PPPQ1PPP/4R1K1 w - - 0 1'), ['d2g5', 'h6g5', 'f3g5', 'a8d8'], { settings: S }).line;
    expect(lineText(q, W)).toMatchInlineSnapshot(`"Qg5 → hxg5 takes the queen → Nxg5 takes back → White gives a queen for a pawn (−8 points)."`);
    const m = narrateLine(legalFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1'), ['a1a8'], { settings: S }).line;
    expect(lineText(m, W)).toMatchInlineSnapshot(`"Ra8# is checkmate."`);
    const quiet = narrateLine(legalFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'), ['g1f3', 'g8f6', 'g2g3', 'g7g6'], { settings: S }).line;
    expect(lineText(quiet, W)).toMatchInlineSnapshot(`"No forcing follow-up."`);
  });
  it('exchange won; mate announced from the score', () => {
    const line: Fact = { type: 'line', steps: [{ ply: 1, san: 'Nc7+', uci: 'b5c7', color: 'white', facts: [] }], materialDelta: 2, result: 'wins-material', won: ['rook'], lost: ['knight'] };
    expect(lineText(line, W)).toMatchInlineSnapshot(`"Nc7+ → White wins the exchange — a rook for a knight (+2 points)."`);
    const mate: Fact = { type: 'line', steps: [{ ply: 1, san: 'Qh5', uci: 'd1h5', color: 'white', facts: [] }], materialDelta: 0, result: 'mate', mateIn: 4 };
    expect(lineText(mate, W)).toMatchInlineSnapshot(`"Qh5 → White forces mate in 4."`);
  });
});

describe('sacrifices and defended threats', () => {
  it('a hang / losing capture that the short line justifies is worded as a sacrifice', () => {
    const fen = legalFen('4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16'); // Opera game before 16.Qb8+
    const facts = immediateFacts(fen, 'b3b8');
    const mate: Fact = { type: 'line', steps: [], materialDelta: -4, result: 'mate', mateIn: 2 };
    expect(renderExplanation({ immediate: facts, short: [mate], long: [] }, W).immediate.text).toMatchInlineSnapshot(`
      [
        "Sacrifices the queen on b8 (−9 points) — it leads to mate.",
        "Gives check.",
      ]
    `);
    // without the paying line it is a plain hang
    expect(renderExplanation({ immediate: facts, short: [], long: [] }, W).immediate.text[0]).toMatch(/^Leaves the queen on b8 hanging/);
    const win: Fact = { type: 'line', steps: [], materialDelta: 2, result: 'wins-material' };
    const cap: Fact = { type: 'capture', captured: { role: 'pawn', square: 'b5', color: 'black' }, outcome: 'loses-material', net: -1 };
    expect(renderExplanation({ immediate: [cap], short: [win], long: [] }, W).immediate.text).toMatchInlineSnapshot(`
      [
        "Takes Black's pawn on b5 as a sacrifice (−1 point) — the follow-up wins it back with interest.",
      ]
    `);
  });
  it('stopping the opponent\'s threat (mate, mating attack, material)', () => {
    const fork: Fact = { type: 'fork', attacker: { role: 'knight', square: 'c2', color: 'black' }, targets: [{ role: 'king', square: 'e1', color: 'white' }, { role: 'rook', square: 'a1', color: 'white' }] };
    const ds: Fact[] = [
      { type: 'defends-threat', move: 'f3f7', san: 'Qxf7#', gain: 0, mateIn: 1, facts: [] },
      { type: 'defends-threat', move: 'c4f7', san: 'Bxf7+', gain: 0, mateIn: 2, facts: [] },
      { type: 'defends-threat', move: 'd4c2', san: 'Nc2+', gain: 5, facts: [{ type: 'check' }, fork] },
      { type: 'defends-threat', move: 'b3b7', san: 'Qxb7', gain: 6, facts: [{ type: 'capture', captured: { role: 'pawn', square: 'b7', color: 'black' }, outcome: 'wins-material', net: 1 }] },
    ];
    expect(ds.map((d) => renderExplanation({ immediate: [d], short: [], long: [] }, (d as { move: string }).move === 'd4c2' ? W : B).immediate.text[0])).toMatchInlineSnapshot(`
      [
        "Stops White's threat of checkmate with Qxf7#.",
        "Stops White's mating attack (it would start with Bxf7+).",
        "Stops Black's threat Nc2+, which would fork White's king on e1 and rook on a1 (+5 points for Black).",
        "Stops White's threat Qxb7, which would win material (+6 points for White).",
      ]
    `);
  });
  it('only legal move', () => {
    expect(renderExplanation({ immediate: [], short: [], long: [{ type: 'necessary', onlyMove: true }] }, B).long.text).toEqual(['It was the only legal move.']);
  });
});

describe('long level', () => {
  const pos = (f: Partial<Extract<Fact, { type: 'positional' }>>): Extract<Fact, { type: 'positional' }> => ({ type: 'positional', feature: 'mobility', delta: 1, ...f });
  it('positional features, both sides, line end', () => {
    const texts = [
      pos({ feature: 'king-safety', delta: -2, side: 'own', detail: 'shield 3->1, open files 0->1', squares: ['g1'] }),
      pos({ feature: 'king-safety', delta: 1, side: 'opponent', detail: 'attackers 0->2', squares: ['g8'] }),
      pos({ feature: 'passed-pawn', delta: 1, side: 'own', squares: ['d5'] }),
      pos({ feature: 'isolated-pawn', delta: 1, side: 'opponent', squares: ['e6'] }),
      pos({ feature: 'doubled-pawn', delta: 1, side: 'opponent', squares: ['c6', 'c7'], at: 'line-end' }),
      pos({ feature: 'bishop-pair', delta: -1, side: 'own' }),
      pos({ feature: 'bishop-pair', delta: 1, side: 'opponent' }),
      pos({ feature: 'open-file-rook', delta: 1, side: 'own', squares: ['d1'] }),
      pos({ feature: 'centre-control', delta: 3 }),
      pos({ feature: 'space', delta: -5 }),
    ].map((f) => positionalText(f, W));
    expect(texts).toMatchInlineSnapshot(`
      [
        "White's king is more exposed (fewer pawns in front of it and more open files next to it).",
        "Black's king is more exposed (more enemy pieces aim at it).",
        "White gets a passed pawn on d5 (no enemy pawn stands in its way).",
        "Black gets an isolated pawn on e6 (no pawn of the same colour on the files next to it).",
        "After these moves, Black gets doubled pawns on the c-file (two pawns on one file).",
        "White gives up the bishop pair (both bishops).",
        "Black loses the bishop pair (both bishops).",
        "White's rook on d1 gets a file without its own pawns in the way.",
        "White gains control of the centre.",
        "White gives up some space.",
      ]
    `);
  });
  it('gain, payoff, necessary', () => {
    const lost: Fact = { type: 'line', steps: [], materialDelta: -1, result: 'loses-material', lost: ['pawn'] };
    const e = renderExplanation({ immediate: [], short: [lost], long: [{ type: 'positional-gain', cp: 120 }, { type: 'deep-payoff' }] }, B);
    expect(e.long.text).toMatchInlineSnapshot(`
      [
        "Black gives up material, but the engine sees about 1.2 pawns' worth of compensation in the position.",
        "The payoff is far away: a quick engine look rates this move lower — only a deep search sees why it works.",
      ]
    `);
    expect(renderExplanation({ immediate: [], short: [], long: [{ type: 'necessary' }] }, B).long.text).toMatchInlineSnapshot(`
      [
        "Black just had to play this — every other move is much worse.",
      ]
    `);
  });
});

describe('label text', () => {
  const base = { color: 'white' as const, uci: 'd2g5', bestUci: 'c3d5', bestSan: 'Nd5', evalBefore: { cp: 1780 }, evalAfter: { cp: 850 }, winBefore: 99.9, winAfter: 95.8, winLoss: 1.9 };
  it('material blunder while still winning', () => {
    const t = labelText({ ...base, label: 'blunder', labelReason: { winChance: 'excellent', material: { playedLine: 3, bestLine: 11, loss: 8, evalDropCp: 930, label: 'blunder', hung: { role: 'queen', square: 'g5', color: 'white' } } } }, S);
    expect(t).toMatchInlineSnapshot(`"Blunder ?? — leaves the queen on g5 hanging (−8 points). White is still winning (engine eval +17.8 → +8.5), but this is the habit to fix."`);
  });
  it('win-chance labels', () => {
    const r = (label: 'best' | 'great' | 'good' | 'inaccuracy' | 'mistake' | 'miss' | 'blunder' | 'book' | 'forced', extra = {}) =>
      labelText({ ...base, color: 'black', evalBefore: { cp: -20 }, evalAfter: { cp: 250 }, winBefore: 52, winAfter: 27, winLoss: 25, label, labelReason: { winChance: label, ...extra } }, S);
    expect([
      r('best'),
      r('great', { great: { secondBestLoss: 18.4 } }),
      r('good'),
      r('inaccuracy'),
      r('mistake'),
      r('miss', { miss: true }),
      r('blunder'),
      r('book', { book: { eco: 'C60', name: 'Ruy Lopez' } }),
      r('forced'),
    ]).toMatchInlineSnapshot(`
      [
        "Best — as good as the engine's top move (Nd5).",
        "Great ! — the only good move here: the next best loses 18% winning chances.",
        "Good — a little weaker than Nd5 (−25% winning chances).",
        "Inaccuracy ?! — Nd5 was better (−25% winning chances).",
        "Mistake ? — Nd5 was much better. Black's winning chances go from 52% to 27%.",
        "Miss — White's last move was a mistake, and Nd5 would have punished it (−25% winning chances).",
        "Blunder ?? — Nd5 was much better. Black's winning chances go from 52% to 27%.",
        "Book — a known opening move (Ruy Lopez, C60).",
        "Forced — the only legal move.",
      ]
    `);
  });
});
