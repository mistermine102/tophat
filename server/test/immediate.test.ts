import { describe, expect, it } from 'vitest';
import type { Fact } from '@chess-coach/shared';
import { FACT_IMPORTANCE, immediateFacts } from '../src/facts/immediate';

type T = Fact['type'];
const facts = (fen: string, uci: string, opts?: Parameters<typeof immediateFacts>[2]) => immediateFacts(fen, uci, opts);
const types = (fs: Fact[]) => fs.map((f) => f.type);
function one<K extends T>(fs: Fact[], type: K): Extract<Fact, { type: K }> {
  const found = fs.filter((f) => f.type === type);
  expect(found, `expected exactly one ${type} in ${JSON.stringify(fs)}`).toHaveLength(1);
  return found[0] as Extract<Fact, { type: K }>;
}
const none = (fs: Fact[], type: T) => expect(types(fs), JSON.stringify(fs)).not.toContain(type);

describe('check / checkmate', () => {
  it('direct check', () => {
    const fs = facts('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'a1a8');
    expect(one(fs, 'check')).toEqual({ type: 'check' });
    none(fs, 'checkmate');
  });

  it('discovered check', () => {
    expect(one(facts('4k3/8/8/8/4N3/8/8/4R1K1 w - - 0 1', 'e4c5'), 'check')).toEqual({ type: 'check', discovered: true });
  });

  it('double check', () => {
    expect(one(facts('4k3/8/8/8/4N3/8/8/4R1K1 w - - 0 1', 'e4d6'), 'check')).toEqual({ type: 'check', double: true, discovered: true });
  });

  it('back-rank mate (no separate check fact)', () => {
    const fs = facts('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1a8');
    expect(one(fs, 'checkmate')).toEqual({ type: 'checkmate' });
    none(fs, 'check');
    none(fs, 'allows-mate');
  });

  it('smothered mate', () => {
    expect(one(facts('6rk/6pp/7N/8/8/8/8/6K1 w - - 0 1', 'h6f7'), 'checkmate')).toEqual({ type: 'checkmate' });
  });

  it('no check: quiet move; check with escape squares is not mate', () => {
    const quiet = facts('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'a1a2');
    none(quiet, 'check');
    none(quiet, 'checkmate');
    none(facts('6k1/5pp1/8/8/8/8/8/R5K1 w - - 0 1', 'a1a8'), 'checkmate');
  });
});

describe('capture', () => {
  it('wins material (undefended knight)', () => {
    expect(one(facts('4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1', 'd1d5'), 'capture')).toEqual({
      type: 'capture', captured: { role: 'knight', square: 'd5', color: 'black' }, outcome: 'wins-material', net: 3,
    });
  });

  it('even trade (knight for knight)', () => {
    const c = one(facts('4k3/8/4p3/3n4/8/4N3/8/4K3 w - - 0 1', 'e3d5'), 'capture');
    expect(c.outcome).toBe('even-trade');
    expect(c.net).toBe(0);
  });

  it('loses material (rook takes pawn-defended knight)', () => {
    const fs = facts('4k3/8/4p3/3n4/8/8/8/3RK3 w - - 0 1', 'd1d5');
    const c = one(fs, 'capture');
    expect(c.outcome).toBe('loses-material');
    expect(c.net).toBe(-2);
    none(fs, 'hangs'); // the losing capture says it already
  });

  it('recapture needs the previous move', () => {
    const prev = { fenBefore: '6k1/8/8/8/1b6/2N5/1P6/6K1 b - - 0 1', uci: 'b4c3' };
    const fen = '6k1/8/8/8/8/2b5/1P6/6K1 w - - 0 2';
    const c = one(facts(fen, 'b2c3', { prev }), 'capture');
    expect(c.outcome).toBe('recapture');
    expect(c.net).toBe(3);
    expect(one(facts(fen, 'b2c3'), 'capture').outcome).toBe('wins-material');
    // previous move landed on another square: not a recapture
    expect(one(facts(fen, 'b2c3', { prev: { fenBefore: prev.fenBefore, uci: 'b4a5' } }), 'capture').outcome).toBe('wins-material');
  });

  it('en passant captures the pawn behind the target square', () => {
    const c = one(facts('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5d6'), 'capture');
    expect(c.captured).toEqual({ role: 'pawn', square: 'd5', color: 'black' });
    expect(c.outcome).toBe('wins-material');
  });

  it('no capture on quiet moves or castling', () => {
    none(facts('4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1', 'd1d2'), 'capture');
    none(facts('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1g1'), 'capture');
  });
});

describe('promotion', () => {
  it('queen promotion with check', () => {
    const fs = facts('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7a8q');
    expect(one(fs, 'promotion')).toEqual({ type: 'promotion', to: 'queen' });
    one(fs, 'check');
  });

  it('under-promotion with capture', () => {
    const fs = facts('1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7b8n');
    expect(one(fs, 'promotion').to).toBe('knight');
    expect(one(fs, 'capture')).toMatchObject({ captured: { role: 'rook', square: 'b8' }, outcome: 'wins-material', net: 7 });
  });

  it('no promotion on normal pawn moves', () => {
    none(facts('4k3/8/P7/8/8/8/8/4K3 w - - 0 1', 'a6a7'), 'promotion');
    none(facts('4k3/8/8/8/8/8/P7/4K3 w - - 0 1', 'a2a4'), 'promotion');
  });
});

describe('castle', () => {
  const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  it('both sides, both colours, both UCI forms', () => {
    expect(one(facts(fen, 'e1g1'), 'castle').side).toBe('king');
    expect(one(facts(fen, 'e1h1'), 'castle').side).toBe('king');
    expect(one(facts(fen, 'e1c1'), 'castle').side).toBe('queen');
    expect(one(facts('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', 'e8c8'), 'castle').side).toBe('queen');
  });

  it('king steps are not castling', () => {
    none(facts(fen, 'e1f1'), 'castle');
    none(facts(fen, 'e1d2'), 'castle');
  });
});

describe('develop', () => {
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  it('minor piece leaves its original square in the opening', () => {
    expect(one(facts(start, 'g1f3'), 'develop').piece).toEqual({ role: 'knight', square: 'f3', color: 'white' });
    const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    expect(one(facts(afterE4, 'b8c6'), 'develop').piece.square).toBe('c6');
    expect(one(facts('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2', 'f1c4'), 'develop').piece.role).toBe('bishop');
  });

  it('not from a non-original square, not late in the game, not for pawns', () => {
    none(facts('rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 2 2', 'f3g5'), 'develop');
    none(facts('4k3/8/8/8/8/8/8/4K1N1 w - - 0 30', 'g1f3'), 'develop');
    none(facts(start, 'e2e4'), 'develop');
  });
});

describe('attack', () => {
  it('new attack on an undefended piece', () => {
    expect(one(facts('4k3/8/8/1r6/8/8/8/1N2K3 w - - 0 1', 'b1c3'), 'attack')).toEqual({
      type: 'attack', attacker: { role: 'knight', square: 'c3', color: 'white' }, target: { role: 'rook', square: 'b5', color: 'black' }, reason: 'undefended',
    });
  });

  it('new attack on a defended higher-value piece', () => {
    const a = one(facts('4k3/8/2p5/3q4/8/8/8/1N2K3 w - - 0 1', 'b1c3'), 'attack');
    expect(a.reason).toBe('higher-value');
    expect(a.target.role).toBe('queen');
  });

  it('no attack fact for defended pieces of equal/lower value or for attacks that already existed', () => {
    // knight attacks a pawn-defended pawn and a pawn-defended knight
    none(facts('4k3/8/2p1p3/3n4/1p6/8/8/1N2K3 w - - 0 1', 'b1c3'), 'attack');
    // rook slides along the file: still attacks the same rook
    none(facts('r3k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'a1a4'), 'attack');
    // attacks on the king are checks
    none(facts('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'a1a8'), 'attack');
  });
});

describe('fork', () => {
  it('knight forks king and rook', () => {
    const f = one(facts('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', 'b5c7'), 'fork');
    expect(f.attacker).toEqual({ role: 'knight', square: 'c7', color: 'white' });
    expect(f.targets.map((t) => t.role)).toEqual(['king', 'rook']);
  });

  it('queen forks king and an undefended bishop', () => {
    const f = one(facts('4k3/8/8/b7/8/8/8/3Q1K2 w - - 0 1', 'd1a4'), 'fork');
    expect(f.targets.map((t) => `${t.role}@${t.square}`)).toEqual(['king@e8', 'bishop@a5']);
  });

  it('protected pawn forks two pieces', () => {
    // (with the king on e1 Nd3+ / Bg3+ would escape with check, which the 1-ply check conservatively rejects)
    const f = one(facts('4k3/8/8/2n1b3/8/2PP4/8/7K w - - 0 1', 'd3d4'), 'fork');
    expect(f.targets.map((t) => t.role).sort()).toEqual(['bishop', 'knight']);
  });

  it('not a fork: the unprotected forking pawn is just taken', () => {
    const fs = facts('4k3/8/8/2n1b3/8/3P4/8/4K3 w - - 0 1', 'd3d4');
    none(fs, 'fork');
    // (M5b) the bishop can simply take the pawn: that attack is marked 'offered' (analyzeMove checks it with the PV)
    expect(types(fs)).toEqual(['hangs', 'attack', 'attack']);
    expect(fs.filter((f) => f.type === 'attack' && f.offered)).toHaveLength(1);
  });

  it('not a fork: second target is only a pawn', () => {
    const fs = facts('4k3/1p6/8/8/4N3/8/8/4K3 w - - 0 1', 'e4d6');
    none(fs, 'fork');
    one(fs, 'check');
  });

  it('not a fork: the forking knight is simply captured', () => {
    const fs = facts('r2qk3/8/8/1N6/8/8/8/4K3 w - - 0 1', 'b5c7');
    none(fs, 'fork');
    expect(one(fs, 'hangs')).toMatchObject({ piece: { role: 'knight', square: 'c7' }, loss: 3 });
  });

  it('not a fork: both targets defended and not worth more than the attacker', () => {
    none(facts('4k3/8/1n3n2/p3p1p1/8/3N4/8/4K3 w - - 0 1', 'd3e5'), 'fork');
  });

  it('not a fork: a forked piece escapes with check (Qd5 hits a8 and e4, but ...Ra1+)', () => {
    const fs = facts('r3k3/8/8/8/4n3/2p5/8/3QK3 w - - 0 1', 'd1d5');
    none(fs, 'fork');
    expect(types(fs)).toEqual(['attack', 'attack']); // the two attacks are still true statements
  });
});

describe('pin', () => {
  it('absolute pin: bishop pins knight to king', () => {
    expect(one(facts('4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1', 'f1b5'), 'pin')).toEqual({
      type: 'pin',
      pinner: { role: 'bishop', square: 'b5', color: 'white' },
      pinned: { role: 'knight', square: 'c6', color: 'black' },
      behind: { role: 'king', square: 'e8', color: 'black' },
      absolute: true,
    });
  });

  it('relative pin: rook pins knight to queen', () => {
    const p = one(facts('3qk3/8/8/3n4/8/8/8/R3K3 w - - 0 1', 'a1d1'), 'pin');
    expect(p).toMatchObject({ pinned: { role: 'knight', square: 'd5' }, behind: { role: 'queen', square: 'd8' }, absolute: false });
  });

  it('no pin of a pawn, nor with a hanging pinner', () => {
    none(facts('4k3/3p4/8/8/8/8/8/4KB2 w - - 0 1', 'f1b5'), 'pin');
    const fs = facts('4k3/8/p1n5/8/8/8/8/4KB2 w - - 0 1', 'f1b5');
    none(fs, 'pin');
    expect(one(fs, 'hangs').piece.role).toBe('bishop');
  });

  it('an existing pin is not new', () => {
    none(facts('4k3/8/2n5/1B6/8/8/7P/4K3 w - - 0 1', 'h2h3'), 'pin');
  });

  it('no pin when the pinned piece can take the pinner', () => {
    // rook "pins" a rook to the king on the file, but the black rook simply takes it
    none(facts('4k3/4r3/8/8/8/8/8/R5K1 w - - 0 1', 'a1e1'), 'pin');
  });
});

describe('skewer', () => {
  it('bishop skewers king and queen', () => {
    expect(one(facts('8/7B/4k3/8/8/1q6/8/4K3 w - - 0 1', 'h7g8'), 'skewer')).toEqual({
      type: 'skewer',
      attacker: { role: 'bishop', square: 'g8', color: 'white' },
      front: { role: 'king', square: 'e6', color: 'black' },
      behind: { role: 'queen', square: 'b3', color: 'black' },
    });
  });

  it('rook skewers king and rook along a rank', () => {
    const s = one(facts('8/8/8/1k5r/1P6/8/8/R5K1 w - - 0 1', 'a1a5'), 'skewer');
    expect(s.behind).toEqual({ role: 'rook', square: 'h5', color: 'black' });
  });

  it('no skewer: a pawn behind, or a defended piece behind', () => {
    none(facts('8/7B/4k3/8/8/1p6/8/4K3 w - - 0 1', 'h7g8'), 'skewer');
    none(facts('8/8/6p1/1k5r/1P6/8/8/R5K1 w - - 0 1', 'a1a5'), 'skewer');
  });
});

describe('discovered attack', () => {
  it('knight move uncovers rook attack on the queen', () => {
    expect(one(facts('3k4/4q3/8/8/4N3/8/8/4RK2 w - - 0 1', 'e4c3'), 'discovered-attack')).toEqual({
      type: 'discovered-attack',
      moved: { role: 'knight', square: 'c3', color: 'white' },
      attacker: { role: 'rook', square: 'e1', color: 'white' },
      target: { role: 'queen', square: 'e7', color: 'black' },
    });
  });

  it('pawn move uncovers bishop attack on an undefended rook', () => {
    const d = one(facts('4k3/8/8/4r3/8/2P5/1B6/6K1 w - - 0 1', 'c3c4'), 'discovered-attack');
    expect(d.attacker.square).toBe('b2');
    expect(d.target.square).toBe('e5');
  });

  it('no discovered attack on pawns, defended equal pieces or the king (that is a discovered check)', () => {
    none(facts('4k3/8/8/4p3/8/2P5/1B6/6K1 w - - 0 1', 'c3c4'), 'discovered-attack');
    none(facts('4k3/8/3p4/4n3/8/2P5/1B6/6K1 w - - 0 1', 'c3c4'), 'discovered-attack');
    const fs = facts('4k3/8/8/8/4N3/8/8/4R1K1 w - - 0 1', 'e4c5');
    none(fs, 'discovered-attack');
    expect(one(fs, 'check').discovered).toBe(true);
  });
});

describe('escape / defend', () => {
  it('attacked knight moves to safety', () => {
    expect(one(facts('4k3/8/8/3p4/4N3/8/8/4K3 w - - 0 1', 'e4c3'), 'escape')).toEqual({
      type: 'escape', piece: { role: 'knight', square: 'c3', color: 'white' }, from: 'e4',
    });
  });

  it('queen attacked by a bishop steps away', () => {
    expect(one(facts('7k/8/8/1b6/8/8/4Q3/4K3 w - - 0 1', 'e2e3'), 'escape').from).toBe('e2');
  });

  it('no escape when moving to another attacked square or when nothing was attacked', () => {
    const fs = facts('4k3/8/8/3p4/1p2N3/8/8/4K3 w - - 0 1', 'e4c3');
    none(fs, 'escape');
    expect(one(fs, 'hangs').piece.square).toBe('c3');
    none(facts('4k3/8/8/8/4N3/8/8/4K3 w - - 0 1', 'e4c3'), 'escape');
  });

  it('rook defends an attacked knight', () => {
    expect(one(facts('4k3/8/8/8/1b6/2N5/8/R5K1 w - - 0 1', 'a1c1'), 'defend')).toEqual({
      type: 'defend', defender: { role: 'rook', square: 'c1', color: 'white' }, piece: { role: 'knight', square: 'c3', color: 'white' },
    });
  });

  it('king defends an attacked knight', () => {
    expect(one(facts('4k3/8/8/8/8/1b6/2N5/4K3 w - - 0 1', 'e1d1'), 'defend').defender.role).toBe('king');
  });

  it('no defend when the piece was not attacked or stays lost', () => {
    none(facts('4k3/8/8/8/8/2N5/8/R5K1 w - - 0 1', 'a1c1'), 'defend');
    // queen attacked by a pawn: a defender does not help
    none(facts('4k3/8/8/2p5/1Q6/8/8/R5K1 w - - 0 1', 'a1b1'), 'defend');
  });
});

describe('block-check / escape-check', () => {
  const fen = '4r1k1/8/8/8/8/2N5/8/4K3 w - - 0 1';
  it('interposing and moving the king', () => {
    one(facts(fen, 'c3e2'), 'block-check');
    one(facts(fen, 'e1d1'), 'escape-check');
    none(facts(fen, 'e1d1'), 'block-check');
  });

  it('capturing the checker is neither; no evasion facts when not in check', () => {
    const fs = facts('4r1k1/8/8/8/B7/8/8/4K3 w - - 0 1', 'a4e8');
    none(fs, 'block-check');
    none(fs, 'escape-check');
    none(facts('6k1/8/8/8/8/2N5/8/4K3 w - - 0 1', 'e1d1'), 'escape-check');
  });
});

describe('hangs', () => {
  it('hangs the queen', () => {
    expect(one(facts('4k3/8/8/3p4/8/8/8/4KQ2 w - - 0 1', 'f1c4'), 'hangs')).toEqual({
      type: 'hangs', piece: { role: 'queen', square: 'c4', color: 'white' }, loss: 9,
    });
  });

  it('removing a defender hangs the knight', () => {
    expect(one(facts('3rk3/8/8/8/3N4/2B5/8/4K3 w - - 0 1', 'c3b4'), 'hangs')).toEqual({
      type: 'hangs', piece: { role: 'knight', square: 'd4', color: 'white' }, loss: 3,
    });
  });

  it('leaving an attacked rook en prise is reported as already hanging', () => {
    expect(one(facts('4k3/8/8/1b6/8/8/7P/3K1R2 w - - 0 1', 'h2h3'), 'hangs')).toEqual({
      type: 'hangs', piece: { role: 'rook', square: 'f1', color: 'white' }, loss: 5, already: true,
    });
  });

  it('not reported when taking it walks into a bigger counter-capture (b4 hits the queen)', () => {
    const fen = '4k3/8/4b3/q1pN4/8/P7/1P6/6K1 w - - 0 1';
    const hangsKnight = (fs: Fact[]) => fs.some((f) => f.type === 'hangs' && f.piece.square === 'd5');
    expect(hangsKnight(facts(fen, 'b2b4'))).toBe(false);
    expect(hangsKnight(facts(fen, 'g1h2'))).toBe(true); // a pass leaves it en prise
  });

  it('not reported after checkmate, after an even trade, or when the opponent must answer a check', () => {
    none(facts('6k1/5ppp/8/8/8/2N5/3b4/R5K1 w - - 0 1', 'a1a8'), 'hangs');
    none(facts('4k3/8/4p3/3n4/8/4N3/8/4K3 w - - 0 1', 'e3d5'), 'hangs');
    // Ra8+ : the b4 bishop may not take c3 while Black is in check
    none(facts('7k/8/8/8/1b6/2N5/8/R5K1 w - - 0 1', 'a1a8'), 'hangs');
  });
});

describe('allows-mate', () => {
  it('queen stops guarding f2: smothered mate', () => {
    expect(one(facts('6k1/8/8/8/6n1/8/6PP/5QRK w - - 0 1', 'f1a6'), 'allows-mate')).toEqual({ type: 'allows-mate', inMoves: 1 });
  });

  it("fool's mate (both colours)", () => {
    one(facts('rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq e6 0 2', 'g2g4'), 'allows-mate');
    one(facts('rnbqkbnr/pppppp1p/8/6p1/3PP3/8/PPP2PPP/RNBQKBNR b KQkq d3 0 2', 'f7f6'), 'allows-mate');
  });

  it('not when the check can be blocked, nor for mating moves', () => {
    none(facts('rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq e6 0 2', 'e2e4'), 'allows-mate');
    none(facts('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1a8'), 'allows-mate');
    none(facts('6k1/8/8/8/6n1/8/6PP/5QRK w - - 0 1', 'f1f3'), 'allows-mate');
  });
});

describe('ordering', () => {
  it('facts are sorted by FACT_IMPORTANCE', () => {
    const fs = facts('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', 'b5c7');
    const idx = fs.map((f) => FACT_IMPORTANCE.indexOf(f.type));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(fs[0].type).toBe('fork');
  });

  it('hangs before capture, checkmate first', () => {
    expect(FACT_IMPORTANCE[0]).toBe('checkmate');
    expect(FACT_IMPORTANCE.indexOf('hangs')).toBeLessThan(FACT_IMPORTANCE.indexOf('capture'));
  });

  it('rejects illegal moves', () => {
    expect(() => facts('4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'e1e3')).toThrow();
  });
});
