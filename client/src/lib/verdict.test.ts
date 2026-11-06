import type { Level, MoveAnalysis } from '@chess-coach/shared';
import { describe, expect, it } from 'vitest';
import { levelLines, lowerFirst, storyParts } from './tones';
import { parseUiMode } from './uiMode';
import type { Candidate } from '@chess-coach/shared';
import { candidateSentence, moveVerdict } from './verdict';

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
