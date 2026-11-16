import type { Level, MoveAnalysis } from '@chess-coach/shared';
import { describe, expect, it } from 'vitest';
import { levelLines, lowerFirst, storyParts } from './tones';
import { parseUiMode } from './uiMode';
import type { Candidate } from '@chess-coach/shared';
import { candidateSentence, moveVerdict, sentenceWithPoints, verdictPoints } from './verdict';
import { labelReasonText } from './reason';

const level = (text: string[], tones?: Level['tones'], extra: Partial<Level> = {}): Level => ({ facts: [{ type: 'check' }], text, ...(tones ? { tones } : {}), ...extra });

describe('tones helpers', () => {
  it('levelLines: tones default to neutral, nothing-notable is empty', () => {
    expect(levelLines(level(['Gives check.']))).toEqual([{ text: 'Gives check.', tone: 'neutral' }]);
    expect(levelLines({ facts: [{ type: 'nothing-notable' }], text: ['Nothing special happens right away.'], tones: ['neutral'] })).toEqual([]);
  });
  it('storyParts: the server parts, else the sentence split at its arrows', () => {
    const story = [{ text: 'Nc3', tone: 'neutral' as const, plies: [0, 0] as [number, number] }, { text: 'White loses a knight (−3 points)', tone: 'bad' as const }];
    expect(storyParts(level(['Nc3 → White loses a knight (−3 points).'], ['bad'], { story }))).toBe(story);
    expect(storyParts(level(['Nc3 → d4 forks both knights → White loses a knight (−3 points).'], ['bad']))).toEqual([
      { text: 'Nc3', tone: 'neutral' },
      { text: 'd4 forks both knights', tone: 'neutral' },
      { text: 'White loses a knight (−3 points)', tone: 'bad' },
    ]);
    expect(storyParts(level(['No forcing follow-up.']))).toEqual([]);
  });
  it('lowerFirst keeps side names and SAN', () => {
    expect(lowerFirst('Allows d4, forking …')).toBe('allows d4, forking …');
    expect(lowerFirst('White loses a knight')).toBe('White loses a knight');
    expect(lowerFirst('Nxe4 wins')).toBe('Nxe4 wins');
    expect(lowerFirst('Defends the pawn')).toBe('defends the pawn');
  });
  it('parseUiMode: layout A by default', () => {
    expect([parseUiMode(''), parseUiMode('?ui=classic'), parseUiMode('?ui=C'), parseUiMode('?ui=x')]).toEqual(['a', 'classic', 'c', 'a']);
  });
});

describe('verdict', () => {
  const analysis = (label: MoveAnalysis['label'], immediate: Level, short: Level): MoveAnalysis =>
    ({ label, san: 'Nc3', uci: 'b1c3', color: 'white', winLoss: 30, labelReason: { winChance: label }, best: { san: 'e5', uci: 'e4e5' }, played: { explanation: { immediate, short, long: level([]) } } }) as unknown as MoveAnalysis;
  it('a bad move: the first bad sentence', () => {
    const a = analysis(
      'blunder',
      level(['Allows d4, forking White’s knights on c3 and e3.', 'Attacks Black’s pawn on b5, which is undefended.', 'Develops the knight to c3.'], ['bad', 'good', 'good']),
      level(['Nc3 → d4 forks both knights → White gives a knight for two pawns (−1 point).'], ['bad']),
    );
    const v = moveVerdict(a, { moverIsYou: true });
    expect(v.name).toBe('Blunder');
    expect(v.sentence).toBe('allows d4, forking White’s knights on c3 and e3.');
    expect(v.usedIndex).toBe(0);
  });
  it('no fitting sentence: a short plain fallback, or the label alone', () => {
    const none = level([]);
    const v = (label: MoveAnalysis['label']) => moveVerdict(analysis(label, none, none), { moverIsYou: false }).sentence;
    expect(v('inaccuracy')).toBe('e5 was better.');
    expect(v('mistake')).toBe('e5 was much better.');
    expect(v('good')).toBe('e5 was a bit better.');
    expect(v('excellent')).toBe('almost as good as e5.');
    const best = { ...analysis('best', none, none), best: { san: 'Nc3', uci: 'b1c3' } } as MoveAnalysis;
    expect(moveVerdict(best, { moverIsYou: false }).sentence).toBe('');
  });
  it('the better move: one sentence, its own good one first, never filler', () => {
    const cand = (text: string[], tones: Level['tones']) => ({ explanation: { immediate: level(text, tones), short: level([]), long: level([]) } }) as unknown as Candidate;
    expect(candidateSentence(cand(['Like c5, it develops the knight.', 'Wins Black’s pawn on e5.'], ['neutral', 'good']))).toEqual({ text: 'Wins Black’s pawn on e5.', tone: 'good' });
    expect(candidateSentence(cand(['Nothing special happens right away (as with c5).'], ['neutral']))).toBeNull();
    expect(candidateSentence(cand(['Leaves the knight on c2 hanging: Black can win it.'], ['bad']))).toBeNull();
  });
});

describe('(B) Brilliant and missed free material', () => {
  const nothing: Level = { facts: [{ type: 'nothing-notable' }], text: ['Nothing special happens right away.'], tones: ['neutral'] };
  const base = (over: Partial<MoveAnalysis>): MoveAnalysis =>
    ({ san: 'O-O', uci: 'e1g1', color: 'white', winLoss: 3, winAfter: 94, best: { san: 'Nxh4', uci: 'f3h4' }, candidates: [], played: { rank: 5, explanation: { immediate: nothing, short: nothing, long: nothing } }, ...over }) as unknown as MoveAnalysis;
  const queen = { role: 'queen' as const, square: 'h4', color: 'black' as const };
  it('a Miss for a free piece says what was missed', () => {
    const a = base({ label: 'miss', labelReason: { winChance: 'good', missedMaterial: { gain: 9, piece: queen, free: true } } });
    expect(moveVerdict(a, { moverIsYou: true })).toMatchObject({ name: 'Miss', sentence: 'misses Nxh4, which wins the queen for free.', tone: 'bad' });
    expect(labelReasonText(a, { moverIsYou: true })).toBe("Missed a free queen: Nxh4 wins the queen on h4, this move doesn't.");
  });
  it('a Brilliant move names the sacrificed piece', () => {
    const a = base({ label: 'brilliant', san: 'Qb8+', uci: 'b3b8', winLoss: 0, winAfter: 100, best: { san: 'Qb8+', uci: 'b3b8' } as MoveAnalysis['best'], labelReason: { winChance: 'best', brilliant: { sacrifice: 9, piece: { role: 'queen', square: 'b8', color: 'white' } } } });
    expect(moveVerdict(a, { moverIsYou: true })).toMatchObject({ name: 'Brilliant', sentence: 'a sound sacrifice of the queen.', tone: 'good' });
    expect(labelReasonText(a, { moverIsYou: true })).toBe('A sound sacrifice: Qb8+ gives up the queen on b8, and you stay winning.');
  });
});

describe('verdictPoints (Points)', () => {
  const pt = (text: string, tone: 'good' | 'bad' | 'neutral' = 'good') => ({ key: text, text, tone });
  const base = (label: MoveAnalysis['label'], points: MoveAnalysis['points']) => ({ label, labelReason: { winChance: label }, points }) as unknown as MoveAnalysis;
  const nf3 = { uci: 'g1f3', san: 'Nf3', points: [pt('Attacks the pawn on e5'), pt('Develops the knight')] };

  it('the played move: its own points, pros first, then cons', () => {
    expect(verdictPoints(base('best', { played: nf3 }))).toEqual({ lines: nf3.points });
    const h3 = { uci: 'h2h3', san: 'h3', points: [pt('Blocks the bishop on f1', 'bad'), pt('Keeps the bishop off g4')] };
    expect(verdictPoints(base('mistake', { played: h3, best: nf3 }))!.lines.map((l) => l.text)).toEqual(['Keeps the bishop off g4', 'Blocks the bishop on f1']);
    expect(verdictPoints(base('good', { played: { ...h3, points: [] }, best: nf3 }))).toBeNull();
  });
  it('the same idea as the best move: its own points plus what it has or lacks next to it, never the best move itself', () => {
    const nc3 = { uci: 'b1c3', san: 'Nc3', points: [pt('Develops the knight')], like: 0, plus: [pt('Keeps the c-pawn free')], minus: [pt("Doesn't attack the pawn on e5", 'bad')] };
    expect(verdictPoints(base('excellent', { played: nc3, best: nf3 }))!.lines.map((l) => l.text)).toEqual([
      'Develops the knight',
      'Keeps the c-pawn free',
      "Doesn't attack the pawn on e5",
    ]);
  });
  it('nothing for book / forced moves, quick results and older analyses', () => {
    expect(verdictPoints(base('book', { played: nf3 }))).toBeNull();
    expect(verdictPoints(base('best', undefined))).toBeNull();
    expect(verdictPoints({ ...base('best', { played: nf3 }), provisional: true } as MoveAnalysis)).toBeNull();
  });
  it('the sentence goes when the points already say what a good move does; a bad move keeps it', () => {
    const v = { name: 'Best', sentence: 'develops the knight.', tone: 'good' as const, usedIndex: 0 };
    const a = base('best', { played: nf3 });
    expect(sentenceWithPoints(a, v, verdictPoints(a))).toBe('');
    const bad = base('mistake', { played: nf3, best: nf3 });
    expect(sentenceWithPoints(bad, { ...v, sentence: 'allows d4.' }, verdictPoints(bad))).toBe('allows d4.');
    expect(sentenceWithPoints(a, v, null)).toBe('develops the knight.');
    // Great: its own plain reason stays, a sentence the points repeat goes
    const great = base('great', { played: nf3 });
    expect(sentenceWithPoints(great, { ...v, name: 'Great', sentence: 'the only good move here.', usedIndex: null }, verdictPoints(great))).toBe('the only good move here.');
    expect(sentenceWithPoints(great, { ...v, name: 'Great', sentence: 'castles queenside.', usedIndex: 0 }, verdictPoints(great))).toBe('');
  });
});
