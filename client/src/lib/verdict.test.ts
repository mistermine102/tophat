import type { Level, MoveAnalysis } from '@chess-coach/shared';
import { describe, expect, it } from 'vitest';
import { levelLines, lowerFirst, storyParts } from './tones';
import { parseUiMode } from './uiMode';
import { keyPoints, moveVerdict } from './verdict';

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
  it('parseUiMode: classic by default', () => {
    expect([parseUiMode(''), parseUiMode('?ui=a'), parseUiMode('?ui=C'), parseUiMode('?ui=x')]).toEqual(['classic', 'a', 'c', 'classic']);
  });
});

describe('verdict', () => {
  const analysis = (label: MoveAnalysis['label'], immediate: Level, short: Level): MoveAnalysis =>
    ({ label, san: 'Nc3', uci: 'b1c3', color: 'white', winLoss: 30, labelReason: { winChance: label }, best: { san: 'e5', uci: 'e4e5' }, played: { explanation: { immediate, short, long: level([]) } } }) as unknown as MoveAnalysis;
  it('a bad move: the first bad sentence, then what hurts first', () => {
    const a = analysis(
      'blunder',
      level(['Allows d4, forking White’s knights on c3 and e3.', 'Attacks Black’s pawn on b5, which is undefended.', 'Develops the knight to c3.'], ['bad', 'good', 'good']),
      level(['Nc3 → d4 forks both knights → White gives a knight for two pawns (−1 point).'], ['bad']),
    );
    const v = moveVerdict(a, { moverIsYou: true });
    expect(v.name).toBe('Blunder');
    expect(v.sentence).toBe('allows d4, forking White’s knights on c3 and e3.');
    expect(keyPoints(a, v).map((l) => l.tone)).toEqual(['bad', 'good', 'good']);
    expect(keyPoints(a, v)[0]!.text).toMatch(/^In the engine line: White gives a knight/);
  });
});
