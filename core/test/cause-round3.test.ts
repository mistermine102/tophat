// (Feedback round 3) Causes read from the played move's line — a piece chased with tempo, a pawn let run, an
// opening move that develops nothing — and the Miss rule for a Blunder that only missed a concrete win.
import { DEFAULT_SETTINGS, type Fact } from '@chess-coach/shared';
import { describe, expect, it } from 'vitest';
import { type ClassifyResult, missedChanceMiss } from '../src/analysis/classify';
import { allowsText, betterReasonFacts, chasedPhrase, labelText, passerPhrase, undevelopedPhrase } from '../src/analysis/explain';
import { chasedFact, passerFact, undevelopedFact } from '../src/facts/cause';

// mubarakSB–mistermine102: 3.Qf3?! Bg4 4.Qg3 e6 5.Nc3 Bd6 6.Qh4
const QF3_FEN = 'rnbqkb1r/ppp1pppp/5n2/3p4/3P4/4P3/PPP2PPP/RNBQKBNR w KQkq - 1 3';
const QF3_PV = ['d1f3', 'c8g4', 'f3g3', 'e7e6', 'b1c3', 'f8d6', 'g3h4', 'c7c5', 'h2h3', 'g4f5'];
// 12...Nxa2? Ba5 Qc8 cxb6 Rb8 b7 (Nd3+ keeps the pawns back)
const NXA2_FEN = 'r2qkb1r/4pppp/1p3n2/1pP5/1np5/4PQP1/PP1BNP1P/3RK2R b Kkq - 3 12';
const NXA2_PV = ['b4a2', 'd2a5', 'd8c8', 'c5b6', 'a8b8', 'b6b7', 'c8c5', 'e2d4', 'f6d5', 'd4b3'];
const NXA2_BEST = ['b4d3', 'e1f1', 'b6c5', 'f3c6', 'f6d7', 'c6b5', 'a8b8', 'b5c6', 'b8b6', 'c6g2'];
// 3.g4? with four minor pieces at home
const G4_FEN = 'r1bqkbnr/ppp1pppp/2n5/3p4/3P4/7P/PPP1PPP1/RNBQKBNR w KQkq - 1 3';

describe('chasedFact', () => {
  it('3.Qf3: the queen is hit by …Bg4 and …Bd6 and steps away each time', () => {
    const f = chasedFact(QF3_FEN, QF3_PV)!;
    expect(f).toEqual({ type: 'chased', piece: { role: 'queen', square: 'f3', color: 'white' }, hits: [{ attack: 'Bg4', retreat: 'Qg3' }, { attack: 'Bd6', retreat: 'Qh4' }] });
    expect(chasedPhrase(f, 'white')).toBe('puts the queen where Black can chase it with tempo (…Bg4 Qg3, …Bd6 Qh4): Black improves pieces while White moves the queen again');
  });

  it('nothing for the best move, a pawn move, or a piece that takes its attacker', () => {
    expect(chasedFact(QF3_FEN, ['g1f3', 'e7e6', 'f1e2', 'c7c5'])).toBeNull();
    expect(chasedFact(QF3_FEN, ['c2c4', 'e7e6'])).toBeNull();
    expect(chasedFact(QF3_FEN, ['d1f3', 'c8g4', 'f3b7'])).toBeNull();
  });

  it('a king walking up to the piece is no chase', () => {
    // Re7 Kf8 Rd7: the king "attacks" the rook
    expect(chasedFact('6k1/8/8/8/8/8/5PPP/4R1K1 w - - 0 1', ['e1e7', 'g8f8', 'e7d7'])).toBeNull();
  });
});

describe('passerFact', () => {
  it("12...Nxa2: White's pawn reaches b7, which the best line never allows", () => {
    const f = passerFact(NXA2_FEN, NXA2_PV, NXA2_BEST)!;
    expect(f).toEqual({ type: 'passer', pawn: { role: 'pawn', square: 'b7', color: 'white' }, line: ['Ba5', 'Qc8', 'cxb6', 'Rb8', 'b7'] });
    expect(passerPhrase(f, 'black')).toBe("lets White's pawn run to b7, one step from queening (after Ba5 …Qc8 cxb6 …Rb8 b7)");
  });

  it('nothing when the best line lets it run too', () => {
    expect(passerFact(NXA2_FEN, NXA2_PV, NXA2_PV)).toBeNull();
  });
});

describe('undevelopedFact', () => {
  it('3.g4: no piece out while four sit at home, and Nf3 / Bf4 would develop one', () => {
    const better = [{ san: 'Nf3', uci: 'g1f3' }, { san: 'c4', uci: 'c2c4' }, { san: 'Bf4', uci: 'c1f4' }];
    const f = undevelopedFact(G4_FEN, 'g2g4', better)!;
    expect(f).toEqual({ type: 'undeveloped', home: 4, moves: ['Nf3', 'Bf4'] });
    expect(undevelopedPhrase(f, 'white')).toBe("doesn't develop a piece while White still has four at home (Nf3 or Bf4 would)");
  });

  it('nothing for a developing move, when no better move develops, or late in the game', () => {
    expect(undevelopedFact(G4_FEN, 'g1f3', [{ san: 'Bf4', uci: 'c1f4' }])).toBeNull();
    expect(undevelopedFact(G4_FEN, 'g2g4', [{ san: 'c4', uci: 'c2c4' }])).toBeNull();
    expect(undevelopedFact(G4_FEN.replace(/ 3$/, ' 20'), 'g2g4', [{ san: 'Nf3', uci: 'g1f3' }])).toBeNull();
  });
});

describe('missedChanceMiss', () => {
  const cr = (reason: ClassifyResult['labelReason'], label: ClassifyResult['label'] = 'blunder'): ClassifyResult => ({ label, labelReason: reason, winBest: 97, winPlayed: 19, winLoss: 78, checkmate: false });
  const free = { gain: 8, piece: { role: 'knight', square: 'c6', color: 'black' }, free: true } as const;

  it('10.Bd2 missing Qxc6+ (free knight), the move itself losing nothing: Miss', () => {
    const r = cr({ winChance: 'blunder', material: { playedLine: 0, bestLine: 0, loss: 0, evalDropCp: 1346 }, missedMaterial: free });
    expect(missedChanceMiss(r, false)).toBe(true);
    expect(r.label).toBe('miss');
    expect(r.labelReason.missedChance).toBe(true);
  });

  it('a concrete tactic counts too; a line that only ends ahead does not', () => {
    expect(missedChanceMiss(cr({ winChance: 'blunder' }), true)).toBe(true);
    expect(missedChanceMiss(cr({ winChance: 'blunder' }), false)).toBe(false);
  });

  it('stays a Blunder when the move leaves a piece hanging, loses material itself or allows mate', () => {
    const hung = cr({ winChance: 'blunder', material: { playedLine: -1, bestLine: 0, loss: 1, evalDropCp: 559, hung: { role: 'knight', square: 'c6', color: 'black' }, hungLoss: 3, hungAlready: true }, missedMaterial: free });
    expect(missedChanceMiss(hung, true)).toBe(false);
    expect(hung.label).toBe('blunder');
    expect(missedChanceMiss(cr({ winChance: 'blunder', material: { playedLine: -3, bestLine: 0, loss: 3, evalDropCp: 400, label: 'blunder' }, missedMaterial: free }), true)).toBe(false);
    expect(missedChanceMiss(cr({ winChance: 'blunder', allowedMate: { matedIn: 2 }, missedMaterial: free }), true)).toBe(false);
  });

  it('only for a Blunder by win chance', () => {
    expect(missedChanceMiss(cr({ winChance: 'mistake', missedMaterial: free }, 'mistake'), true)).toBe(false);
  });
});

describe('betterReasonFacts with laterGain (only reasons the lines bear out)', () => {
  const quiet = (delta = 0): Fact => ({ type: 'line', steps: [], materialDelta: delta, result: delta > 0 ? 'wins-material' : delta < 0 ? 'loses-material' : 'quiet', balance: delta });
  const knight = { role: 'knight', square: 'e5', color: 'black' } as const;
  // f4 hitting a knight that steps away: the threat isn't carried out
  const threat: Fact = { type: 'threat', move: 'f4e5', san: 'fxe5', gain: 3, facts: [{ type: 'capture', captured: knight, outcome: 'wins-material', net: 3 }] };
  const disc: Fact = { type: 'discovered-attack', moved: { role: 'pawn', square: 'e5', color: 'black' }, attacker: { role: 'bishop', square: 'b7', color: 'black' }, target: { role: 'queen', square: 'g2', color: 'white' } };
  const rook = { role: 'rook', square: 'a1', color: 'white' } as const;
  const escape: Fact = { type: 'escape', piece: { ...rook, square: 'a2' }, from: 'a1' };

  it('an attack or discovered attack that wins nothing later is no reason', () => {
    expect(betterReasonFacts([threat, disc, quiet()], [quiet()], 'white', 'f2f4', { laterGain: 0 })).toEqual([]);
    expect(betterReasonFacts([threat, quiet()], [quiet()], 'white', 'f2f4', { laterGain: 2 }).map((r) => r.phrase)).toEqual(["attacks Black's knight on e5"]);
    // without laterGain (re-rendering stored facts) nothing is filtered
    expect(betterReasonFacts([threat, quiet()], [quiet()], 'white', 'f2f4').length).toBe(1);
  });

  it('saving a piece the played line never loses is no reason', () => {
    expect(betterReasonFacts([escape, quiet()], [quiet()], 'white', 'a1a2', { laterGain: 0 })).toEqual([]);
    expect(betterReasonFacts([escape, quiet()], [quiet(-5)], 'white', 'a1a2', { laterGain: 0 }).map((r) => r.phrase)).toEqual(['saves the rook on a1']);
  });
});

describe('allowsText: a quiet reply whose line costs material', () => {
  it('says what the follow-up move does', () => {
    const fork: Fact = { type: 'fork', attacker: { role: 'knight', square: 'd3', color: 'black' }, targets: [{ role: 'king', square: 'e1', color: 'white' }, { role: 'bishop', square: 'd2', color: 'white' }] };
    const f: Fact = { type: 'allows', reply: { san: 'Qc8', uci: 'd8c8' }, facts: [], gain: 3, follow: 'Nd3+', followFact: fork };
    expect(allowsText(f as Extract<Fact, { type: 'allows' }>, { mover: 'white' })).toBe("After …Qc8, …Nd3+ forks White's king on e1 and bishop on d2, and White loses material");
  });
});

describe('labelText (round 3)', () => {
  const base = {
    color: 'white' as const, evalBefore: { cp: 0 }, evalAfter: { cp: -300 }, winBefore: 70, winAfter: 7, winLoss: 63, uci: 'e2c3', bestSan: 'Bxb4', bestUci: 'd2b4',
  };

  it('a missed tactic after a move that was no mistake names the chance', () => {
    const t = labelText({ ...base, label: 'miss', labelReason: { winChance: 'blunder', missedChance: true }, better: ["uncovers an attack on Black's queen on d8"] }, DEFAULT_SETTINGS);
    expect(t).toBe("Miss — Bxb4 was the chance here (−63% winning chances). Bxb4 uncovers an attack on Black's queen on d8.");
  });

  it("the played move's refutation leads when the better move has no reason", () => {
    const t = labelText({ ...base, label: 'blunder', winBefore: 70, winLoss: 50, labelReason: { winChance: 'blunder' }, san: 'Kg2', bestSan: 'Kg1', refutation: 'Allows Qf3+ (check), and White soon loses a lot of material', fine: ['Kg1'] }, DEFAULT_SETTINGS);
    expect(t).toBe("Blunder ?? — Kg2 allows Qf3+ (check), and White soon loses a lot of material. White's winning chances go from 70% to 20%; Kg1 would have kept them.");
    // a told reason for the better move keeps the old form
    const u = labelText({ ...base, label: 'blunder', winBefore: 70, winLoss: 50, labelReason: { winChance: 'blunder' }, san: 'Kg2', bestSan: 'Kg1', refutation: 'Allows Qf3+ (check)', better: ['defends the pawn on h3'] }, DEFAULT_SETTINGS);
    expect(u).toBe("Blunder ?? — Kg1 was much better. Kg1 defends the pawn on h3. White's winning chances go from 70% to 20%.");
  });

  it('a chased piece leads the text, with the moves that keep the balance', () => {
    const cause = chasedFact(QF3_FEN, QF3_PV)!;
    const t = labelText({ ...base, label: 'mistake', winBefore: 51, winLoss: 11, labelReason: { winChance: 'mistake' }, san: 'Qf3', cause, fine: ['Nf3', 'Nd2', 'c4'] }, DEFAULT_SETTINGS);
    expect(t).toBe("Mistake ? — Qf3 puts the queen where Black can chase it with tempo (…Bg4 Qg3, …Bd6 Qh4). White's winning chances go from 51% to 40%; Nf3, Nd2 or c4 would have kept them.");
  });
});
