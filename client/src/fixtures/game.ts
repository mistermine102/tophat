// The fixture game for mock mode: a 36-move beginner game (Italian Game) with clear mistakes on both sides,
// ending in mate. Engine lines are real Stockfish output (engineLines.ts); labels, material checks and facts are
// hand-annotated below. Every MoveAnalysis is assembled with chessops (assemble.ts) so FEN/SAN/UCI are correct.
//
// Coverage (asserted in fixtures.test.ts): every Label (book 1-10, forced 57/69/71, great 23, miss 32, blunder 31,
// material-rule blunders 33 and 52 — 52 is "still winning"), pick ≠ best (21), deepOnly (33), threat arrows
// (20, 62, 64), and the Fact types.
import type { Fact, GameInfo, Label, MaterialCheck, MoveAnalysis, PieceRef, PieceRole, Score } from '@chess-coach/shared';
import { sanLineToUci } from '../lib/chess';
import { assembleAnalysis, type LevelsSpec } from './assemble';
import { boardFacts, lineFact } from './autoFacts';
import { ENGINE_ROWS, type EngineRow } from './engineLines';
import { pgnToGame } from './pgnGame';

export const FIXTURE_USERNAME = 'coach_tester';
export const FIXTURE_ID = 'fixture-italian-1';

const MOVES =
  'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O Bg5 h6 Bh4 g5 Bg3 Bg4 Nbd2 Nh5 h3 Bxf3 Qxf3 Nxg3 Qxg3 Qf6 ' +
  'Nf3 Kg7 d4 exd4 e5 dxe5 Nxe5 Nxe5 Qxe5 Qxe5 Rae1 Qf4 Re4 Qf6 cxd4 Bxd4 Rxd4 Qxd4 Bb3 Rae8 Kh1 Re2 Bd5 b6 ' +
  'Bf3 Re1 Rxe1 Qxf2 Re2 Qf1+ Kh2 Rd8 a3 Rd1 Re4 Rd2 b3 Qxf3 Rg4 Qf2 Kh1 Rd1+ Kh2 Qg1+ Kg3 Rd3#';

function withClocks(sans: string[]): string {
  const out: string[] = [];
  let w = 600;
  let b = 600;
  sans.forEach((san, i) => {
    const spend = 2 + ((i * 7) % 13) + (i > 40 ? 6 : 0);
    if (i % 2 === 0) {
      w -= spend;
      out.push(`${i / 2 + 1}. ${san} {[%clk ${clock(w)}]}`);
    } else {
      b -= spend;
      out.push(`${Math.floor(i / 2) + 1}... ${san} {[%clk ${clock(b)}]}`);
    }
  });
  return out.join(' ');
}
function clock(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `0:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${(s * 7) % 10}`;
}

/** chess.com style export (Share → PGN), incl. clock comments. */
export const FIXTURE_PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.10.18"]
[Round "-"]
[White "BishopBlunder99"]
[Black "${FIXTURE_USERNAME}"]
[Result "0-1"]
[WhiteElo "812"]
[BlackElo "835"]
[TimeControl "600"]
[ECO "C54"]
[Termination "${FIXTURE_USERNAME} won by checkmate"]

${withClocks(MOVES.split(' '))} 0-1
`;

// --- helpers for writing facts -------------------------------------------------------------------------------

const ROLE: Record<string, PieceRole> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };
/** W('Nf3') = white knight on f3. */
const W = (s: string): PieceRef => ({ role: ROLE[s[0]!]!, square: s.slice(1), color: 'white' });
const Bk = (s: string): PieceRef => ({ role: ROLE[s[0]!]!, square: s.slice(1), color: 'black' });

const pos = (feature: Extract<Fact, { type: 'positional' }>['feature'], delta: number, detail?: string): Fact => ({
  type: 'positional', feature, delta, ...(detail ? { detail } : {}),
});

/** Per-level spec in notes: facts, or 'auto' (chessops board facts / engine-line narration). */
interface NoteLevels {
  immediate?: Fact[] | 'auto';
  short?: Fact[] | 'auto';
  long?: Fact[];
  /** Extra facts injected into steps of an auto short line (1-based step index). */
  stepFacts?: Record<number, Fact[]>;
}

interface PlyNote {
  label?: Label;
  book?: { eco: string; name: string };
  material?: MaterialCheck;
  pick?: string | null;
  played?: NoteLevels;
  pickEx?: NoteLevels;
  bestEx?: NoteLevels;
  notExplainable?: Record<string, string[]>;
}

const book = (eco: string, name: string, long: Fact[] = [], immediate: Fact[] | 'auto' = 'auto'): PlyNote => ({
  book: { eco, name },
  played: { immediate, short: [], long },
});

const NOTES: Record<number, PlyNote> = {
  1: book('B00', "King's Pawn Game", [pos('centre-control', 1, 'the e4-pawn controls d5 and f5')]),
  2: book('C20', "King's Pawn Game", [pos('centre-control', 1, 'the e5-pawn controls d4 and f4')]),
  3: book('C40', "King's Knight Opening", [], [
    { type: 'develop', piece: W('Nf3') },
    { type: 'attack', attacker: W('Nf3'), target: Bk('Pe5'), reason: 'undefended' },
  ]),
  4: book('C44', "King's Knight Opening: Normal Variation", [], [
    { type: 'develop', piece: Bk('Nc6') },
    { type: 'defend', defender: Bk('Nc6'), piece: Bk('Pe5') },
  ]),
  5: book('C50', 'Italian Game', [pos('mobility', 1, 'the bishop eyes f7')]),
  6: book('C50', 'Italian Game: Giuoco Piano', [pos('mobility', 1, 'the bishop eyes f2')]),
  7: book('C53', 'Italian Game: Classical Variation', [pos('centre-control', 1, 'prepares d4')]),
  8: book('C53', 'Italian Game: Classical Variation', [], [
    { type: 'develop', piece: Bk('Nf6') },
    { type: 'attack', attacker: Bk('Nf6'), target: W('Pe4'), reason: 'undefended' },
  ]),
  9: book('C54', 'Italian Game: Giuoco Pianissimo', [], [{ type: 'defend', defender: W('Pd3'), piece: W('Pe4') }]),
  10: book('C54', 'Italian Game: Giuoco Pianissimo, Normal', [], [{ type: 'defend', defender: Bk('Pd6'), piece: Bk('Pe5') }]),
  11: { played: { long: [pos('king-safety', 1, 'the king is tucked away on g1')] } },
  12: { played: { long: [pos('king-safety', 1)] } },
  13: {
    played: {
      immediate: [
        { type: 'develop', piece: W('Bg5') },
        { type: 'pin', pinner: W('Bg5'), pinned: Bk('Nf6'), behind: Bk('Qd8'), absolute: false },
      ],
    },
  },
  14: { played: { immediate: [{ type: 'attack', attacker: Bk('Ph6'), target: W('Bg5'), reason: 'higher-value' }] } },
  15: {
    played: {
      immediate: [
        { type: 'escape', piece: W('Bh4'), from: 'g5' },
        { type: 'pin', pinner: W('Bh4'), pinned: Bk('Nf6'), behind: Bk('Qd8'), absolute: false },
      ],
    },
  },
  16: {
    played: {
      immediate: [{ type: 'attack', attacker: Bk('Pg5'), target: W('Bh4'), reason: 'higher-value' }],
      long: [pos('king-safety', -1, 'the pawns in front of the king are pushed')],
    },
  },
  17: { played: { immediate: [{ type: 'escape', piece: W('Bg3'), from: 'h4' }] } },
  18: {
    played: {
      immediate: [
        { type: 'develop', piece: Bk('Bg4') },
        { type: 'pin', pinner: Bk('Bg4'), pinned: W('Nf3'), behind: W('Qd1'), absolute: false },
      ],
    },
    pickEx: { long: [pos('space', 1, 'a5 gains queenside space and makes room for Ba7')] },
  },
  19: {
    played: {
      immediate: [
        { type: 'develop', piece: W('Nd2') },
        { type: 'defend', defender: W('Nd2'), piece: W('Nf3') },
      ],
    },
  },
  20: {
    played: {
      immediate: [
        {
          type: 'threat', move: 'h5g3', san: 'Nxg3', gain: 0,
          facts: [{ type: 'capture', captured: W('Bg3'), outcome: 'even-trade', net: 0 }],
        },
      ],
      long: [pos('bishop-pair', 1, 'Nxg3 would take away White’s bishop pair')],
    },
  },
  21: {
    played: {
      immediate: [{ type: 'attack', attacker: W('Ph3'), target: Bk('Bg4'), reason: 'higher-value' }],
      stepFacts: { 3: [{ type: 'discovered-attack', moved: W('Ne5'), attacker: W('Qd1'), target: Bk('Nh5') }] },
      long: [pos('king-safety', -1, 'h3 loosens g3 while f2 is pinned by Bc5')],
    },
    pick: 'b4',
    pickEx: { immediate: [{ type: 'attack', attacker: W('Pb4'), target: Bk('Bc5'), reason: 'higher-value' }] },
    bestEx: {
      immediate: [{ type: 'defend', defender: W('Pf2'), piece: W('Bg3') }],
      long: [pos('king-safety', 1, 'the king leaves the a7–g1 diagonal, so f2 is no longer pinned')],
    },
    notExplainable: { Kh1: ['shallow-disagrees'] },
  },
  22: {
    played: {
      immediate: [{ type: 'capture', captured: W('Nf3'), outcome: 'even-trade', net: 0 }],
      long: [pos('bishop-pair', -1, 'gives up the light-squared bishop')],
    },
    pickEx: {
      immediate: [
        { type: 'capture', captured: W('Ph3'), outcome: 'wins-material', net: 1 },
        { type: 'pin', pinner: Bk('Bc5'), pinned: W('Pf2'), behind: W('Kg1'), absolute: true },
      ],
    },
  },
  23: {
    label: 'great',
    played: {
      immediate: [
        { type: 'capture', captured: Bk('Bf3'), outcome: 'recapture', net: 0 },
        { type: 'attack', attacker: W('Qf3'), target: Bk('Nh5'), reason: 'undefended' },
      ],
      long: [{ type: 'necessary' }],
    },
  },
  26: { played: { long: [pos('mobility', 1, 'the queen joins the kingside')] } },
  28: { played: { long: [pos('king-safety', 1, 'the king guards h6 and the dark squares')] } },
  29: {
    played: {
      immediate: [{ type: 'attack', attacker: W('Pd4'), target: Bk('Bc5'), reason: 'higher-value' }],
      long: [pos('centre-control', -1, 'opens the centre while Black’s pieces are better placed')],
    },
    pickEx: { immediate: [{ type: 'attack', attacker: W('Pb4'), target: Bk('Bc5'), reason: 'higher-value' }] },
  },
  31: {
    played: {
      immediate: [
        { type: 'fork', attacker: W('Pe5'), targets: [Bk('Qf6'), Bk('Pd6')] },
        { type: 'hangs', piece: W('Pe5'), loss: 1 },
      ],
    },
    pickEx: { immediate: [{ type: 'attack', attacker: W('Pb4'), target: Bk('Bc5'), reason: 'higher-value' }] },
  },
  32: {
    label: 'miss',
    played: { immediate: [{ type: 'capture', captured: W('Pe5'), outcome: 'wins-material', net: 1 }] },
    pickEx: {
      immediate: [
        { type: 'capture', captured: W('Pe5'), outcome: 'wins-material', net: 1 },
        { type: 'fork', attacker: Bk('Ne5'), targets: [W('Bc4'), W('Nf3')] },
      ],
      long: [pos('passed-pawn', 1, 'the d4-pawn becomes a strong passer')],
    },
  },
  33: {
    material: { playedLine: -4, bestLine: -1, loss: 3, evalDropCp: 387, label: 'blunder', hung: W('Ne5') },
    played: {
      immediate: [
        { type: 'capture', captured: Bk('Pe5'), outcome: 'loses-material', net: -2 },
        { type: 'hangs', piece: W('Ne5'), loss: 3 },
      ],
    },
    pick: null,
    bestEx: {
      immediate: [],
      long: [{ type: 'deep-payoff' }, pos('space', 1, 'the h-pawn starts to pry open Black’s king')],
    },
    notExplainable: {
      h4: ['no-concrete-fact'], Bd5: ['shallow-disagrees'], Rae1: ['no-concrete-fact'], Bb5: ['no-concrete-fact'],
      Nd2: ['too-much-loss'],
    },
  },
  35: {
    material: { playedLine: -10, bestLine: -5, loss: 5, evalDropCp: 200, label: 'mistake', hung: W('Qe5') },
    played: {
      immediate: [
        { type: 'capture', captured: Bk('Ne5'), outcome: 'loses-material', net: -6 },
        { type: 'hangs', piece: W('Qe5'), loss: 9 },
      ],
    },
    pickEx: { immediate: [{ type: 'escape', piece: W('Bb3'), from: 'c4' }] },
  },
  37: {
    played: {
      immediate: [{ type: 'attack', attacker: W('Re1'), target: Bk('Qe5'), reason: 'higher-value' }],
      long: [pos('open-file-rook', 1, 'the rook takes the open e-file')],
    },
  },
  38: { played: { immediate: [{ type: 'escape', piece: Bk('Qf4'), from: 'e5' }] } },
  39: {
    material: { playedLine: -15, bestLine: -10, loss: 5, evalDropCp: 153, label: 'mistake', hung: W('Re4') },
    played: {
      immediate: [
        { type: 'attack', attacker: W('Re4'), target: Bk('Qf4'), reason: 'higher-value' },
        { type: 'hangs', piece: W('Re4'), loss: 5 },
      ],
    },
  },
  40: {
    material: { playedLine: 10, bestLine: 15, loss: 5, evalDropCp: 219, label: 'mistake' },
    played: { immediate: [{ type: 'escape', piece: Bk('Qf6'), from: 'f4' }] },
    pickEx: { immediate: [{ type: 'capture', captured: W('Re4'), outcome: 'wins-material', net: 5 }] },
  },
  49: { played: { immediate: [{ type: 'allows-mate', inMoves: 8 }] } },
  50: { pickEx: { immediate: [{ type: 'capture', captured: W('Pf2'), outcome: 'wins-material', net: 1 }] } },
  52: {
    material: { playedLine: 8, bestLine: 13, loss: 5, evalDropCp: 333, label: 'blunder', hung: Bk('Re1') },
    played: { immediate: [{ type: 'hangs', piece: Bk('Re1'), loss: 5 }] },
    pickEx: {
      immediate: [
        { type: 'capture', captured: W('Pf2'), outcome: 'wins-material', net: 1 },
        { type: 'attack', attacker: Bk('Rf2'), target: W('Bf3'), reason: 'higher-value' },
      ],
    },
  },
  57: { played: { immediate: [{ type: 'escape-check' }], short: [], long: [{ type: 'necessary' }] } },
  62: {
    played: {
      immediate: [
        { type: 'pin', pinner: Bk('Rd2'), pinned: W('Pg2'), behind: W('Kh2'), absolute: true },
        {
          type: 'threat', move: 'f1f3', san: 'Qxf3', gain: 3,
          facts: [{ type: 'capture', captured: W('Bf3'), outcome: 'wins-material', net: 3 }],
        },
      ],
    },
  },
  63: { played: { immediate: [{ type: 'allows-mate', inMoves: 7 }] } },
  64: {
    played: {
      immediate: [
        { type: 'capture', captured: W('Bf3'), outcome: 'wins-material', net: 3 },
        { type: 'pin', pinner: Bk('Rd2'), pinned: W('Pg2'), behind: W('Kh2'), absolute: true },
        { type: 'threat', move: 'f3g2', san: 'Qxg2#', gain: 0, mateIn: 1, facts: [{ type: 'checkmate' }] },
      ],
    },
  },
  65: { played: { immediate: [{ type: 'defend', defender: W('Rg4'), piece: W('Pg2') }] } },
  67: { played: { immediate: [{ type: 'allows-mate', inMoves: 3 }] } },
  69: {
    played: {
      immediate: [{ type: 'escape-check' }],
      short: [{ type: 'forced-reply', san: 'Kh2', alternatives: 0 }],
      long: [{ type: 'necessary' }],
    },
  },
  71: { played: { immediate: [{ type: 'escape-check' }], short: [], long: [{ type: 'nothing-notable' }] } },
};

// Extra facts on otherwise auto-explained plies, to exercise the remaining Fact types.
NOTES[24] = { played: { long: [pos('doubled-pawn', 1, 'after Qxg3 White avoids doubled g-pawns')] } };
NOTES[27] = { played: { immediate: [], long: [pos('development', 1, 'the last minor piece comes back into play')] } };
NOTES[30] = {
  played: {
    long: [pos('isolated-pawn', -1, 'the d4-pawn can become a target'), { type: 'positional-gain', cp: 80 }],
  },
};
NOTES[34] = { played: { long: [{ type: 'nothing-notable' }] } };

// --- engine data adjustments (fixture only) -----------------------------------------------------------------

/**
 * Plies 37-56: centipawn scores scaled by 0.6. Raw Stockfish says "-10 to -25" there, which the win% clamp turns
 * into "every move is Best"; the scaled values make the material-rule cases (39, 40, 52 "still winning") visible.
 */
function adjust(row: EngineRow): EngineRow {
  if (row.ply < 37 || row.ply > 56) return row;
  const scale = (s: string) => (s.startsWith('#') ? s : String(Math.round(Number(s) * 0.6)));
  return {
    ...row,
    lines: row.lines.map(([s, pv]) => [scale(s), pv]),
    ...(row.played ? { played: [scale(row.played[0]), row.played[1]] as [string, string] } : {}),
  };
}

export function parseScore(s: string): Score {
  return s.startsWith('#') ? { mate: Number(s.slice(1)) } : { cp: Number(s) };
}

// --- builder ----------------------------------------------------------------------------------------------------

export interface Fixture {
  game: GameInfo;
  analyses: Record<number, MoveAnalysis>;
}

let cached: Fixture | null = null;

export function fixtureGame(): Fixture {
  if (cached) return cached;
  const parsed = pgnToGame(FIXTURE_PGN, FIXTURE_USERNAME);
  const game: GameInfo = { ...parsed, id: FIXTURE_ID };
  const analyses: Record<number, MoveAnalysis> = {};
  for (const m of game.moves) {
    const row = adjust(ENGINE_ROWS[m.ply - 1]!);
    const note = NOTES[m.ply] ?? {};
    const lines = row.lines.map(([s, pv]) => ({ score: parseScore(s), pv: pv.split(' ') }));
    const playedLine = row.played ? { score: parseScore(row.played[0]), pv: row.played[1].split(' ') } : undefined;
    const prevUci = game.moves[m.ply - 2]?.uci;

    const lineOf = (san: string) => lines.find((l) => l.pv[0] === san) ?? (playedLine?.pv[0] === san ? playedLine : undefined);
    const resolve = (spec: NoteLevels | undefined, san: string): LevelsSpec => {
      const line = lineOf(san);
      const ucis = sanLineToUci(m.fenBefore, line?.pv ?? [san]).uci;
      let short: Fact[] = [];
      if (spec?.short === undefined || spec.short === 'auto') {
        const lf = lineFact(m.fenBefore, ucis, m.color);
        if (lf && lf.type === 'line') {
          for (const [i, extra] of Object.entries(spec?.stepFacts ?? {})) lf.steps[Number(i) - 1]?.facts.push(...extra);
          // The engine sees a forced mate beyond the narrated plies: say so instead of counting material.
          const mate = line?.score.mate;
          if (mate !== undefined && mate !== 0 && mate > 0 === (m.color === 'white') && lf.result !== 'mate') {
            lf.result = 'mate';
            lf.mateIn = Math.abs(mate);
          }
          short = [lf];
        }
      } else short = spec.short;
      const immediate =
        spec?.immediate === undefined || spec.immediate === 'auto' ? boardFacts(m.fenBefore, ucis[0] ?? '', prevUci) : spec.immediate;
      return { immediate, short, long: spec?.long ?? [] };
    };

    const best = lines[0]!.pv[0]!;
    const pickSan = note.pick === undefined ? undefined : note.pick;
    analyses[m.ply] = assembleAnalysis({
      fenBefore: m.fenBefore,
      san: m.san,
      lines,
      playedLine,
      label: note.label,
      material: note.material,
      book: note.book,
      pick: pickSan,
      notExplainable: note.notExplainable,
      explain: {
        played: resolve(note.played, m.san),
        pick: resolve(note.pickEx, pickSan ?? best),
        best: resolve(note.bestEx ?? (pickSan && pickSan !== best ? undefined : note.pickEx), best),
      },
    });
  }
  cached = { game, analyses };
  return cached;
}
