// (UI round) Tones: every rendered sentence is marked good / bad / neutral for the mover; bad moves lead with what
// hurts; the Short-term story comes split into toned parts; the balance wording no longer contradicts the change.
import { factTone, lineTone, type Fact, type PieceRef } from '@chess-coach/shared';
import { describe, expect, it } from 'vitest';
import { balanceAfter, contrastWithPlayed, lineStory, lineText, renderExplanation } from '../src/analysis/explain';

type LineF = Extract<Fact, { type: 'line' }>;
const W = { mover: 'white' as const };
const p = (role: PieceRef['role'], square: string, color: PieceRef['color']): PieceRef => ({ role, square, color });

describe('factTone (mover POV)', () => {
  const wn = p('knight', 'c3', 'white');
  const bp = p('pawn', 'b5', 'black');
  it('bad facts', () => {
    const bad: Fact[] = [
      { type: 'hangs', piece: wn, loss: 3 },
      { type: 'allows', reply: { san: 'd4', uci: 'd5d4' }, facts: [] },
      { type: 'allows-mate', inMoves: 2 },
      { type: 'misses-mate', mateIn: 2, best: 'Qh7+', line: ['Qh7+', 'Kf8', 'Qh8#'] },
      { type: 'misses', san: 'e5', uci: 'e4e5', facts: [] },
      { type: 'castling-lost', color: 'white', sides: ['king', 'queen'] },
      { type: 'capture', captured: bp, outcome: 'loses-material', net: -2 },
      { type: 'positional', feature: 'king-safety', delta: -1, side: 'own' },
      { type: 'positional', feature: 'passed-pawn', delta: -1, side: 'opponent' },
    ];
    expect(bad.map((f) => factTone(f, 'white'))).toEqual(bad.map(() => 'bad'));
  });
  it('good facts', () => {
    const good: Fact[] = [
      { type: 'checkmate' },
      { type: 'capture', captured: bp, outcome: 'wins-material', net: 1 },
      { type: 'capture', captured: bp, outcome: 'recapture', net: 1 },
      { type: 'fork', attacker: wn, targets: [p('rook', 'a8', 'black'), p('king', 'e8', 'black')] },
      { type: 'pin', pinner: p('bishop', 'b5', 'white'), pinned: p('knight', 'c6', 'black'), behind: p('king', 'e8', 'black'), absolute: true },
      { type: 'threat', move: 'c3b5', san: 'Nxb5', gain: 1, facts: [] },
      { type: 'defends-threat', move: 'd4e3', san: 'dxe3', gain: 3, facts: [] },
      { type: 'defend', defender: wn, piece: p('pawn', 'e4', 'white') },
      { type: 'escape', piece: wn, from: 'e4' },
      { type: 'develop', piece: wn },
      { type: 'castle', side: 'king' },
      { type: 'attack', attacker: wn, target: bp, reason: 'undefended' },
      { type: 'castling-lost', color: 'black', sides: ['king'] },
      { type: 'positional', feature: 'passed-pawn', delta: 1, side: 'own' },
      { type: 'positional-gain', cp: 120 },
    ];
    expect(good.map((f) => factTone(f, 'white'))).toEqual(good.map(() => 'good'));
  });
  it('neutral facts', () => {
    const neutral: Fact[] = [
      { type: 'check' },
      { type: 'capture', captured: bp, outcome: 'even-trade', net: 0 },
      { type: 'capture', captured: bp, outcome: 'loses-material', net: -2, desperado: true },
      { type: 'escape-check' },
      { type: 'deep-payoff' },
      { type: 'necessary' },
      { type: 'nothing-notable' },
    ];
    expect(neutral.map((f) => factTone(f, 'white'))).toEqual(neutral.map(() => 'neutral'));
  });
  it('a line by its result', () => {
    const base = { type: 'line' as const, steps: [], materialDelta: 0 };
    expect((['wins-material', 'mate', 'loses-material', 'mated', 'trade', 'quiet', 'unclear'] as const).map((result) => lineTone({ ...base, result }))).toEqual(['good', 'good', 'bad', 'bad', 'neutral', 'neutral', 'neutral']);
    expect(lineTone({ ...base, result: 'wins-material', draw: 'perpetual', drawBy: 'black' })).toBe('neutral');
  });
});

// The user's example: 9. Nc3?? develops and attacks b5, but allows …d4 forking the knights on c3 and e3.
const NC3_LINE: LineF = {
  type: 'line',
  steps: [
    { ply: 1, san: 'Nc3', uci: 'b1c3', color: 'white', facts: [] },
    { ply: 2, san: 'd4', uci: 'd5d4', color: 'black', facts: [{ type: 'fork', attacker: p('pawn', 'd4', 'black'), targets: [p('knight', 'c3', 'white'), p('knight', 'e3', 'white')] }] },
    { ply: 3, san: 'Nxb5', uci: 'c3b5', color: 'white', facts: [{ type: 'capture', captured: p('pawn', 'b5', 'black'), outcome: 'wins-material', net: 1 }] },
    { ply: 4, san: 'dxe3', uci: 'd4e3', color: 'black', facts: [{ type: 'capture', captured: p('knight', 'e3', 'white'), outcome: 'wins-material', net: 3 }] },
    { ply: 5, san: 'dxe3', uci: 'd2e3', color: 'white', facts: [{ type: 'capture', captured: p('pawn', 'e3', 'black'), outcome: 'recapture', net: 1 }] },
  ],
  materialDelta: -1,
  result: 'loses-material',
  won: ['pawn', 'pawn'],
  lost: ['knight'],
  balance: 0,
};
const NC3_IMMEDIATE: Fact[] = [
  { type: 'develop', piece: p('knight', 'c3', 'white') },
  { type: 'attack', attacker: p('knight', 'c3', 'white'), target: p('pawn', 'b5', 'black'), reason: 'undefended' },
  { type: 'defend', defender: p('knight', 'c3', 'white'), piece: p('pawn', 'e4', 'white') },
  { type: 'allows', reply: { san: 'd4', uci: 'd5d4' }, facts: [{ type: 'fork', attacker: p('pawn', 'd4', 'black'), targets: [p('knight', 'c3', 'white'), p('knight', 'e3', 'white')] }], gain: 1 },
];

describe('renderExplanation tones', () => {
  it('a blunder: tones parallel to the text, what hurts first', () => {
    const e = renderExplanation({ immediate: NC3_IMMEDIATE, short: [NC3_LINE], long: [{ type: 'nothing-notable' }] }, { mover: 'white', label: 'blunder', uci: 'b1c3' });
    for (const l of [e.immediate, e.short, e.long]) expect(l.tones).toHaveLength(l.text.length);
    expect(e.immediate.tones![0]).toBe('bad');
    expect(e.immediate.text[0]).toMatch(/^Allows d4, forking/);
    // once a good sentence comes, no bad one follows
    const firstGood = e.immediate.tones!.indexOf('good');
    expect(e.immediate.tones!.slice(firstGood)).not.toContain('bad');
    expect(e.short.tones).toEqual(['bad']);
    expect(e.long.tones).toEqual(['neutral']);
  });
  it('a good move keeps its importance order', () => {
    const e = renderExplanation({ immediate: [{ type: 'castling-lost', color: 'white', sides: ['king', 'queen'] }, { type: 'develop', piece: p('knight', 'f3', 'white') }], short: [], long: [] }, { mover: 'white', label: 'good' });
    expect(e.immediate.tones).toEqual(['bad', 'good']);
  });
  it('a sound sacrifice is good, not a hang', () => {
    const line: LineF = { type: 'line', steps: [{ ply: 1, san: 'Bxh7+', uci: 'd3h7', color: 'white', facts: [] }], materialDelta: 0, result: 'mate', mateIn: 3 };
    const e = renderExplanation({ immediate: [{ type: 'hangs', piece: p('bishop', 'h7', 'white'), loss: 3 }], short: [line], long: [] }, { mover: 'white', label: 'best' });
    expect(e.immediate.text.some((t) => t.startsWith('Sacrifices'))).toBe(true);
    expect(e.immediate.tones).not.toContain('bad');
  });
  it('the Short-term story: parts with tones, joined they are the sentence', () => {
    const { text, story } = lineStory(NC3_LINE, W);
    expect(story).toBeDefined();
    expect(`${story!.map((s) => s.text).join(' → ')}.`).toBe(text);
    expect(story!.map((s) => s.tone)).toEqual(['neutral', 'bad', 'good', 'bad', 'good', 'bad']);
    expect(story![1]!.plies).toEqual([1, 1]);
    const e = renderExplanation({ immediate: [], short: [NC3_LINE], long: [] }, { mover: 'white', label: 'blunder' });
    expect(e.short.story).toEqual(story);
  });
  it("a mating line: the losing side's steps are neutral", () => {
    // Opera game 15...Nxd7?? 16.Qb8+! Nxb8 17.Rd8#
    const line: LineF = {
      type: 'line',
      steps: [
        { ply: 1, san: 'Nxd7', uci: 'b8d7', color: 'black', facts: [{ type: 'capture', captured: p('bishop', 'd7', 'white'), outcome: 'recapture', net: 3 }] },
        { ply: 2, san: 'Qb8+', uci: 'b3b8', color: 'white', facts: [{ type: 'check' }] },
        { ply: 3, san: 'Nxb8', uci: 'd7b8', color: 'black', facts: [{ type: 'capture', captured: p('queen', 'b8', 'white'), outcome: 'wins-material', net: 9 }] },
        { ply: 4, san: 'Rd8#', uci: 'd1d8', color: 'white', facts: [{ type: 'checkmate' }] },
      ],
      materialDelta: 0,
      result: 'mated',
      mateIn: 2,
    };
    const { story } = lineStory(line, { mover: 'black' });
    expect(story!.map((s) => s.tone)).toEqual(['neutral', 'bad', 'neutral', 'bad']);
  });
  it('contrastWithPlayed keeps tones parallel to the reordered text', () => {
    const played = renderExplanation({ immediate: [{ type: 'develop', piece: p('knight', 'c3', 'white') }], short: [], long: [] }, W);
    const better = renderExplanation({ immediate: [{ type: 'develop', piece: p('knight', 'c3', 'white') }, { type: 'capture', captured: p('pawn', 'e5', 'black'), outcome: 'wins-material', net: 1 }], short: [], long: [] }, W);
    const c = contrastWithPlayed(better, played, 'Nc3');
    expect(c.immediate.text).toHaveLength(c.immediate.tones!.length);
    expect(c.immediate.text[0]).toMatch(/^Wins/);
    expect(c.immediate.tones).toEqual(['good', 'good']);
  });
});

describe('material balance wording (no "−1 point; material is level" contradiction)', () => {
  it('a lead wiped out names where it started', () => {
    expect(lineText(NC3_LINE, W)).toBe('Nc3 → d4 forks both knights → Nxb5 takes the pawn → dxe3 wins the knight → dxe3 takes back → White gives a knight for two pawns (−1 point); White was a pawn up before, so material is now level.');
    expect(balanceAfter({ balance: -2, materialDelta: -3 }, 'white')).toBe('White was a pawn up before, now Black is 2 points up');
    expect(balanceAfter({ balance: 3, materialDelta: 5 }, 'white')).toBe('Black was 2 points up before, now White is 3 points up');
  });
  it('other cases', () => {
    expect(balanceAfter({ balance: 0, materialDelta: 0 }, 'white')).toBeNull(); // level before: no balance
    expect(balanceAfter({ balance: 2, materialDelta: -1 }, 'white')).toBe('White is still 2 points up');
    expect(balanceAfter({ balance: 0, materialDelta: 3 }, 'white')).toBe('material is level'); // "wins back a bishop (+3); material is level"
    expect(balanceAfter({ balance: 4, materialDelta: 1 }, 'white')).toBe('White is 4 points up');
  });
});
