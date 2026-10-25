import { DEFAULT_SETTINGS, type Fact } from '@chess-coach/shared';
import { describe, expect, it } from 'vitest';
import { concreteFacts, judgeCandidate, suggest, type SuggestCandidate } from '../src/analysis/suggest';
import { immediateFacts } from '../src/facts/immediate';
import { cpForWin } from './helpers/classifyHelpers';

const S = DEFAULT_SETTINGS;
const sc = (win: number) => ({ cp: cpForWin(win) });
const quietLine: Fact = { type: 'line', steps: [], materialDelta: 0, result: 'quiet' };
const fork = immediateFacts('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', 'b5c7');

const cand = (over: Partial<SuggestCandidate> = {}): SuggestCandidate => ({
  uci: 'b5c7',
  score: sc(60),
  shallowScore: sc(60),
  material: null,
  facts: [...fork, quietLine],
  ...over,
});

describe('concreteFacts', () => {
  it('accepts tactical facts, winning captures, recaptures, threats with gain, winning / mating lines', () => {
    expect(concreteFacts(fork).map((f) => f.type)).toContain('fork');
    const facts: Fact[] = [
      { type: 'capture', captured: { role: 'pawn', square: 'e5', color: 'black' }, outcome: 'wins-material', net: 1 },
      { type: 'capture', captured: { role: 'knight', square: 'd5', color: 'black' }, outcome: 'recapture', net: 0 },
      { type: 'threat', move: 'b5c7', san: 'Nc7+', gain: 5, facts: [] },
      { type: 'line', steps: [], materialDelta: 2, result: 'wins-material' },
      { type: 'line', steps: [], materialDelta: -3, result: 'mate', mateIn: 2 },
    ];
    expect(concreteFacts(facts)).toHaveLength(5);
  });

  it('rejects even trades, losing captures, development, attacks, quiet lines, gainless threats', () => {
    const facts: Fact[] = [
      { type: 'capture', captured: { role: 'knight', square: 'd5', color: 'black' }, outcome: 'even-trade', net: 0 },
      { type: 'capture', captured: { role: 'pawn', square: 'd5', color: 'black' }, outcome: 'loses-material', net: -2 },
      { type: 'develop', piece: { role: 'knight', square: 'f3', color: 'white' } },
      { type: 'attack', attacker: { role: 'knight', square: 'c3', color: 'white' }, target: { role: 'rook', square: 'b5', color: 'black' }, reason: 'undefended' },
      { type: 'threat', move: 'a1a2', san: 'Ra2', gain: 0, facts: [] },
      quietLine,
      { type: 'line', steps: [], materialDelta: 0, result: 'trade' },
    ];
    expect(concreteFacts(facts)).toEqual([]);
  });
});

describe('judgeCandidate', () => {
  const best = sc(60);
  it('explainable', () => expect(judgeCandidate(cand(), best, S)).toEqual([]));
  it('too-much-loss', () => expect(judgeCandidate(cand({ score: sc(54), shallowScore: sc(58) }), best, S)).toEqual(['too-much-loss']));
  it('material-rule', () => {
    const material = { playedLine: -3, bestLine: 0, loss: 3, evalDropCp: 300, label: 'blunder' as const };
    expect(judgeCandidate(cand({ material }), best, S)).toEqual(['material-rule']);
  });
  it('loses-result (winning -> not winning; drawish -> losing)', () => {
    expect(judgeCandidate(cand({ score: sc(68), shallowScore: sc(72) }), sc(72), S)).toEqual(['loses-result']);
    expect(judgeCandidate(cand({ score: sc(28), shallowScore: sc(31) }), sc(31), S)).toEqual(['loses-result']);
    // an already lost position has no result to keep
    expect(judgeCandidate(cand({ score: sc(20), shallowScore: sc(21) }), sc(22), S)).toEqual([]);
  });
  it('shallow-disagrees (also when unknown)', () => {
    const checkOnly: Fact[] = [{ type: 'check' }, quietLine];
    expect(judgeCandidate(cand({ shallowScore: sc(50), facts: checkOnly }), best, S)).toEqual(['shallow-disagrees']);
    expect(judgeCandidate(cand({ shallowScore: null, facts: checkOnly }), best, S)).toEqual(['shallow-disagrees']);
    // shallow liking it more is fine
    expect(judgeCandidate(cand({ shallowScore: sc(80), facts: checkOnly }), best, S)).toEqual([]);
    // (M5c) a verified tactic shown in the Immediate level (the fork) is near-term whatever the shallow search says
    expect(judgeCandidate(cand({ shallowScore: sc(50) }), best, S)).toEqual([]);
  });
  it('no-concrete-fact', () => expect(judgeCandidate(cand({ facts: [quietLine] }), best, S)).toEqual(['no-concrete-fact']));
  it('several reasons at once', () => {
    expect(judgeCandidate(cand({ score: sc(25), shallowScore: sc(25), facts: [] }), best, S)).toEqual(['too-much-loss', 'loses-result', 'shallow-disagrees', 'no-concrete-fact']);
  });
});

describe('judgeCandidate: absolute safety rules', () => {
  const hang: Fact = { type: 'hangs', piece: { role: 'queen', square: 'd6', color: 'black' }, loss: 4 };
  it('hangs-material unless the own short line pays it back', () => {
    expect(judgeCandidate(cand({ facts: [...fork, hang, quietLine] }), sc(60), S)).toEqual(['hangs-material']);
    const paid: Fact = { type: 'line', steps: [], materialDelta: 2, result: 'wins-material' };
    expect(judgeCandidate(cand({ facts: [...fork, hang, paid] }), sc(60), S)).toEqual([]);
    // a piece that was already hanging before the move doesn't count against this candidate
    expect(judgeCandidate(cand({ facts: [...fork, { ...hang, already: true }, quietLine] }), sc(60), S)).toEqual([]);
    expect(judgeCandidate(cand({ facts: [...fork, { type: 'allows-mate', inMoves: 2 }, quietLine] }), sc(60), S)).toEqual(['hangs-material']);
  });
  it('getting mated by force is loses-result even when win% looks the same (lost position)', () => {
    expect(judgeCandidate(cand({ score: { mate: -2 }, shallowScore: { cp: -1300 } }), { cp: -1340 }, S)).toContain('loses-result');
    expect(judgeCandidate(cand({ score: { mate: -2 }, shallowScore: { mate: -2 } }), { mate: -3 }, S)).not.toContain('loses-result');
  });
  it('stopping a threat is concrete', () => {
    const d: Fact = { type: 'defends-threat', move: 'f3f7', san: 'Qxf7#', gain: 0, mateIn: 1, facts: [] };
    expect(judgeCandidate(cand({ facts: [d, quietLine] }), sc(60), S)).toEqual([]);
  });
});

describe('suggest', () => {
  it('picks the first explainable candidate in engine order', () => {
    const r = suggest([cand({ facts: [quietLine] }), cand({ score: sc(59) }), cand({ score: sc(58) })], sc(60), S);
    expect(r.pick).toBe(1);
    expect(r.reasons).toEqual([['no-concrete-fact'], [], []]);
  });
  it('the best move itself when explainable; null when none is', () => {
    expect(suggest([cand(), cand()], sc(60), S).pick).toBe(0);
    expect(suggest([cand({ facts: [] }), cand({ score: sc(40) })], sc(60), S).pick).toBeNull();
  });
});
