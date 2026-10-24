// Long-term positional features per colour and their meaningful changes (deltas). Pure bitboard work, no
// legal-move generation, so a call costs well under 1 ms.

import {
  SquareSet,
  attacks as pieceAttacks,
  kingAttacks,
  makeSquare,
  opposite,
  pawnAttacks,
  type Board,
  type Color,
  type Position,
} from 'chessops';
import type { Fact, PositionalFeature } from '@chess-coach/shared';
import { PIECE_VALUES, positionFromFen } from '../chess/attacks';

export interface KingSafety {
  square: string;
  /** Own pawns on the king's file and the adjacent files, one or two ranks in front of the king. */
  shield: number;
  /** King on a wing (files a–c or f–h) — the shield only matters there. */
  onWing: boolean;
  /** Enemy pieces (not pawns/king) attacking the king zone (king square, its neighbours, 2 squares ahead). */
  zoneAttackers: number;
  /** King file and adjacent files without own pawns. */
  openFiles: number;
}

export interface PawnStructure {
  passed: string[];
  isolated: string[];
  /** Pawns on files holding more than one own pawn. */
  doubled: string[];
  /** Number of extra pawns on doubled files (sum of n-1). */
  doubledCount: number;
}

export interface ColorFeatures {
  kingSafety: KingSafety;
  pawns: PawnStructure;
  /** Pseudo-legal moves of N/B/R/Q to squares not occupied by own pieces and not attacked by enemy pawns. */
  mobility: number;
  /** Own attacks on d4/e4/d5/e5 plus own occupation of them. */
  centre: number;
  development: { undevelopedMinors: number; castled: boolean; kingMoved: boolean };
  rooks: { open: string[]; semiOpen: string[] };
  bishopPair: boolean;
  /** Squares in the opponent's half attacked by own pieces and not attacked by enemy pawns. */
  space: number;
  /** Non-pawn material (pawn units). */
  pieceMaterial: number;
}

export type PositionalFeatures = Record<Color, ColorFeatures>;

/** Thresholds for `positionalDelta` (net changes smaller than these are not "meaningful"). */
export const POSITIONAL_THRESHOLDS = {
  /** Net mobility change (mover minus opponent). */
  mobility: 6,
  /** Net centre-control change. */
  centre: 2,
  /** Net space change. */
  space: 4,
  /** Change in enemy pieces attacking a king zone. */
  kingZoneAttackers: 2,
  /** King safety is only discussed if the attacking side has at least this much non-pawn material. */
  kingSafetyMinEnemyMaterial: 9,
  /** Development is only discussed up to this fullmove number. */
  developmentMaxFullmove: 20,
} as const;

const FILE_MASKS: SquareSet[] = Array.from({ length: 8 }, (_, f) => SquareSet.fromFile(f));
const CENTRE = SquareSet.empty().with(27).with(28).with(35).with(36); // d4 e4 d5 e5
const HALF: Record<Color, SquareSet> = {
  // the opponent's half for each colour
  white: [4, 5, 6, 7].reduce((s, r) => s.union(SquareSet.fromRank(r)), SquareSet.empty()),
  black: [0, 1, 2, 3].reduce((s, r) => s.union(SquareSet.fromRank(r)), SquareSet.empty()),
};
const START_MINORS: Record<Color, SquareSet> = {
  white: SquareSet.empty().with(1).with(2).with(5).with(6),
  black: SquareSet.empty().with(57).with(58).with(61).with(62),
};

/** Squares strictly in front of `sq` (from `color`'s view) on files f-1..f+1 — the passed-pawn span. */
const PASSED_SPAN: Record<Color, SquareSet[]> = { white: [], black: [] };
for (let sq = 0; sq < 64; sq++) {
  const f = sq & 7;
  const r = sq >> 3;
  for (const color of ['white', 'black'] as const) {
    let s = SquareSet.empty();
    for (let df = -1; df <= 1; df++) {
      const ff = f + df;
      if (ff < 0 || ff > 7) continue;
      for (let rr = 0; rr < 8; rr++) {
        if ((color === 'white' && rr > r) || (color === 'black' && rr < r)) s = s.with(rr * 8 + ff);
      }
    }
    PASSED_SPAN[color][sq] = s;
  }
}

function pawnAttackSet(board: Board, color: Color): SquareSet {
  let s = SquareSet.empty();
  for (const sq of board.pieces(color, 'pawn')) s = s.union(pawnAttacks(color, sq));
  return s;
}

function pawnStructure(board: Board, color: Color): PawnStructure {
  const own = board.pieces(color, 'pawn');
  const enemy = board.pieces(opposite(color), 'pawn');
  const passed: string[] = [];
  const isolated: string[] = [];
  const doubled: string[] = [];
  let doubledCount = 0;
  for (let f = 0; f < 8; f++) {
    const n = own.intersect(FILE_MASKS[f]).size();
    if (n > 1) {
      doubledCount += n - 1;
      for (const sq of own.intersect(FILE_MASKS[f])) doubled.push(makeSquare(sq));
    }
  }
  for (const sq of own) {
    const f = sq & 7;
    // passed: no enemy pawn ahead on this or an adjacent file, and not behind an own pawn (rear doubled pawn)
    if (PASSED_SPAN[color][sq].isDisjoint(enemy) && PASSED_SPAN[color][sq].intersect(FILE_MASKS[f]).isDisjoint(own)) {
      passed.push(makeSquare(sq));
    }
    const adj = (f > 0 ? FILE_MASKS[f - 1] : SquareSet.empty()).union(f < 7 ? FILE_MASKS[f + 1] : SquareSet.empty());
    if (adj.isDisjoint(own)) isolated.push(makeSquare(sq));
  }
  return { passed, isolated, doubled, doubledCount };
}

function kingSafety(board: Board, color: Color): KingSafety {
  const k = board.kingOf(color)!;
  const kf = k & 7;
  const kr = k >> 3;
  const dir = color === 'white' ? 1 : -1;
  const ownPawns = board.pieces(color, 'pawn');
  let shield = 0;
  let openFiles = 0;
  let zone = kingAttacks(k).with(k);
  for (let f = Math.max(0, kf - 1); f <= Math.min(7, kf + 1); f++) {
    for (const dr of [1, 2]) {
      const r = kr + dir * dr;
      if (r < 0 || r > 7) continue;
      const sq = r * 8 + f;
      if (ownPawns.has(sq)) shield++;
      if (dr === 2) zone = zone.with(sq);
    }
    if (ownPawns.isDisjoint(FILE_MASKS[f])) openFiles++;
  }
  let zoneAttackers = 0;
  const enemy = opposite(color);
  const enemyPieces = board[enemy].diff(board.pawn).diff(board.king);
  for (const sq of enemyPieces) {
    if (pieceAttacks(board.get(sq)!, sq, board.occupied).intersects(zone)) zoneAttackers++;
  }
  return { square: makeSquare(k), shield, onWing: kf <= 2 || kf >= 5, zoneAttackers, openFiles };
}

/** Positional features of both colours. */
export function positionalFeatures(fenOrPos: string | Position): PositionalFeatures {
  const pos = typeof fenOrPos === 'string' ? positionFromFen(fenOrPos) : fenOrPos;
  const board = pos.board;
  return { white: colorFeatures(board, 'white'), black: colorFeatures(board, 'black') };
}

function colorFeatures(board: Board, color: Color): ColorFeatures {
  const enemy = opposite(color);
  const own = board[color];
  const enemyPawnAtt = pawnAttackSet(board, enemy);
  let mobility = 0;
  let attacked = SquareSet.empty();
  let centre = 0;
  let pieceMaterial = 0;
  for (const sq of own) {
    const piece = board.get(sq)!;
    const att = pieceAttacks(piece, sq, board.occupied);
    attacked = attacked.union(att);
    centre += att.intersect(CENTRE).size();
    if (piece.role === 'knight' || piece.role === 'bishop' || piece.role === 'rook' || piece.role === 'queen') {
      mobility += att.diff(own).diff(enemyPawnAtt).size();
      pieceMaterial += PIECE_VALUES[piece.role];
    }
  }
  centre += own.intersect(CENTRE).size();
  const space = attacked.intersect(HALF[color]).diff(enemyPawnAtt).size();

  const k = board.kingOf(color)!;
  const homeRank = color === 'white' ? 0 : 7;
  const kingMoved = k !== homeRank * 8 + 4;
  const castled = (k >> 3) === homeRank && ((k & 7) >= 6 || (k & 7) <= 2);
  const undevelopedMinors = START_MINORS[color].intersect(own).intersect(board.knight.union(board.bishop)).size();

  const ownPawns = board.pieces(color, 'pawn');
  const enemyPawns = board.pieces(enemy, 'pawn');
  const open: string[] = [];
  const semiOpen: string[] = [];
  for (const sq of board.pieces(color, 'rook')) {
    const file = FILE_MASKS[sq & 7];
    if (ownPawns.isDisjoint(file)) (enemyPawns.isDisjoint(file) ? open : semiOpen).push(makeSquare(sq));
  }
  const bishops = board.pieces(color, 'bishop');
  const bishopPair = bishops.intersects(SquareSet.lightSquares()) && bishops.intersects(SquareSet.darkSquares());

  return {
    kingSafety: kingSafety(board, color),
    pawns: pawnStructure(board, color),
    mobility,
    centre,
    development: { undevelopedMinors, castled, kingMoved },
    rooks: { open, semiOpen },
    bishopPair,
    space,
    pieceMaterial,
  };
}

const added = (before: string[], after: string[]) => after.filter((s) => !before.includes(s));
const removed = (before: string[], after: string[]) => before.filter((s) => !after.includes(s));

/**
 * Meaningful positional changes caused by a move, from `mover`'s point of view (delta > 0 = good for the mover).
 * Structural features are reported per side (`side: 'own' | 'opponent'`); mobility, centre and space as the net
 * (mover minus opponent) change.
 */
export function positionalDelta(fenBefore: string, fenAfter: string, mover: Color): Fact[] {
  const posB = positionFromFen(fenBefore);
  const b = positionalFeatures(posB);
  const a = positionalFeatures(fenAfter);
  const opp = opposite(mover);
  const facts: Fact[] = [];
  const T = POSITIONAL_THRESHOLDS;

  const push = (feature: PositionalFeature, delta: number, side: 'own' | 'opponent' | undefined, detail?: string, squares?: string[]) => {
    if (delta === 0) return;
    const f: Fact = { type: 'positional', feature, delta };
    if (side) f.side = side;
    if (detail) f.detail = detail;
    if (squares && squares.length) f.squares = squares;
    facts.push(f);
  };

  for (const color of [mover, opp] as const) {
    const side = color === mover ? 'own' : 'opponent';
    const sign = color === mover ? 1 : -1;
    const fb = b[color];
    const fa = a[color];

    // pawn structure
    const pb = fb.pawns;
    const pa = fa.pawns;
    const dPassed = pa.passed.length - pb.passed.length;
    if (dPassed !== 0) {
      push('passed-pawn', sign * dPassed, side, `${pb.passed.length}->${pa.passed.length}`, dPassed > 0 ? added(pb.passed, pa.passed) : removed(pb.passed, pa.passed));
    }
    const dIso = pa.isolated.length - pb.isolated.length;
    if (dIso !== 0) {
      push('isolated-pawn', -sign * dIso, side, `${pb.isolated.length}->${pa.isolated.length}`, dIso > 0 ? added(pb.isolated, pa.isolated) : removed(pb.isolated, pa.isolated));
    }
    const dDbl = pa.doubledCount - pb.doubledCount;
    if (dDbl !== 0) {
      push('doubled-pawn', -sign * dDbl, side, `${pb.doubledCount}->${pa.doubledCount}`, dDbl > 0 ? added(pb.doubled, pa.doubled) : removed(pb.doubled, pa.doubled));
    }

    // king safety (only while the other side has attacking material)
    const enemyMaterial = Math.min(b[opposite(color)].pieceMaterial, a[opposite(color)].pieceMaterial);
    if (enemyMaterial >= T.kingSafetyMinEnemyMaterial) {
      const kb = fb.kingSafety;
      const ka = fa.kingSafety;
      const parts: string[] = [];
      let score = 0;
      if (ka.onWing && kb.onWing && ka.shield !== kb.shield) {
        score += ka.shield - kb.shield;
        parts.push(`shield ${kb.shield}->${ka.shield}`);
      } else if (!kb.onWing && ka.onWing && ka.shield >= 2) {
        // king went to a wing behind pawns (castled)
        score += 1;
        parts.push(`shield ${ka.shield}`);
      }
      if (ka.openFiles !== kb.openFiles) {
        score -= ka.openFiles - kb.openFiles;
        parts.push(`open files ${kb.openFiles}->${ka.openFiles}`);
      }
      const dAtt = ka.zoneAttackers - kb.zoneAttackers;
      if (Math.abs(dAtt) >= T.kingZoneAttackers) {
        score -= Math.sign(dAtt);
        parts.push(`attackers ${kb.zoneAttackers}->${ka.zoneAttackers}`);
      }
      if (score !== 0) push('king-safety', sign * score, side, parts.join(', '), [ka.square]);
    }

    // rooks on open / semi-open files
    const rb = fb.rooks.open.length + fb.rooks.semiOpen.length;
    const ra = fa.rooks.open.length + fa.rooks.semiOpen.length;
    if (ra !== rb) {
      const before = [...fb.rooks.open, ...fb.rooks.semiOpen];
      const after = [...fa.rooks.open, ...fa.rooks.semiOpen];
      push('open-file-rook', sign * (ra - rb), side, `${rb}->${ra}`, ra > rb ? added(before, after) : removed(before, after));
    } else if (color === mover && fa.rooks.open.length > fb.rooks.open.length) {
      // semi-open -> open
      push('open-file-rook', 1, side, 'open', added(fb.rooks.open, fa.rooks.open));
    }

    // bishop pair
    if (fa.bishopPair !== fb.bishopPair) push('bishop-pair', sign * (fa.bishopPair ? 1 : -1), side);
  }

  // development (own, opening only)
  if (posB.fullmoves <= T.developmentMaxFullmove) {
    const db = b[mover].development;
    const da = a[mover].development;
    const scoreB = 4 - db.undevelopedMinors + (db.castled ? 1 : 0);
    const scoreA = 4 - da.undevelopedMinors + (da.castled ? 1 : 0);
    if (scoreA !== scoreB) push('development', scoreA - scoreB, 'own', `${scoreB}->${scoreA}`);
  }

  // net features
  const net = (f: (c: ColorFeatures) => number) => f(a[mover]) - f(a[opp]) - (f(b[mover]) - f(b[opp]));
  const dMob = net((c) => c.mobility);
  if (Math.abs(dMob) >= T.mobility) push('mobility', dMob, undefined, `${b[mover].mobility - b[opp].mobility}->${a[mover].mobility - a[opp].mobility}`);
  const dCen = net((c) => c.centre);
  if (Math.abs(dCen) >= T.centre) push('centre-control', dCen, undefined, `${b[mover].centre - b[opp].centre}->${a[mover].centre - a[opp].centre}`);
  const dSpace = net((c) => c.space);
  if (Math.abs(dSpace) >= T.space) push('space', dSpace, undefined, `${b[mover].space - b[opp].space}->${a[mover].space - a[opp].space}`);

  return facts;
}
