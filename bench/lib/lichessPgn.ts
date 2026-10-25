// Lichess server-analysed PGNs (bench/games/lichess/*.pgn): per-ply eval and judgement.
//
// Format (export with evals=true&literate=true): after each move `{ [%eval 0.18] }` or `{ [%eval #-3] }` (White
// POV, pawns / mate in moves); judged moves carry a NAG ($6 ?!, $2 ?, $4 ??) and a comment
// `{ (-0.81 → 0.91) Blunder. Bf5 was best. }` (or "Checkmate is now unavoidable", "Lost forced checkmate" ...).
//
// Lichess' rules (lila modules/tree/src/main/Advice.scala, scalachess eval.scala), quoted for the benchmark:
//   winningChances(cp) = 2 / (1 + exp(-0.00368208 * cp)) - 1, in [-1, 1]   (win% = 50 + 50 * winningChances)
//   CpAdvice: both evals are cp; delta = mover's drop in winningChances between the position before and after the
//     move; delta >= 0.3 Blunder, >= 0.2 Mistake, >= 0.1 Inaccuracy — i.e. win% drops of 15 / 10 / 5.
//   MateAdvice (only if CpAdvice gave nothing): cp -> mate against the mover ("MateCreated"): Inaccuracy if the
//     mover's cp before < -999, Mistake if < -700, else Blunder; mate for the mover -> cp or mate against
//     ("MateLost"): Inaccuracy if the mover's cp after > 999, Mistake if > 700, else Blunder. A longer mate
//     ("MateDelayed") is not judged.

import { makeFen } from 'chessops/fen';
import { parsePgn, startingPosition } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import type { Chess } from 'chessops/chess';

export type Judgement = 'inaccuracy' | 'mistake' | 'blunder';

export interface LichessScore {
  cp?: number;
  mate?: number;
}

export interface LichessPly {
  ply: number;
  san: string;
  uci: string;
  color: 'white' | 'black';
  fenBefore: string;
  /** Eval after the move (White POV), as printed by Lichess; undefined after checkmate or when missing. */
  evalAfter?: LichessScore;
  judgement?: Judgement;
  /** The judgement comment, e.g. "(-0.81 → 0.91) Blunder. Bf5 was best." */
  comment?: string;
  /** "Bf5" from "... Bf5 was best." */
  lichessBest?: string;
}

export interface LichessGame {
  id: string;
  headers: Record<string, string>;
  plies: LichessPly[];
  pgn: string;
}

const NAG_JUDGEMENT: Record<number, Judgement> = { 6: 'inaccuracy', 2: 'mistake', 4: 'blunder' };

function parseEval(text: string): LichessScore | undefined {
  const m = /\[%eval\s+(#?)(-?[\d.]+)/.exec(text);
  if (!m) return undefined;
  if (m[1] === '#') return { mate: Number(m[2]) };
  return { cp: Math.round(Number(m[2]) * 100) };
}

export function parseLichessGame(pgn: string): LichessGame {
  const g = parsePgn(pgn)[0];
  if (!g) throw new Error('no game');
  const pos = startingPosition(g.headers).unwrap() as Chess;
  const headers: Record<string, string> = {};
  for (const [k, v] of g.headers) headers[k] = v;
  const plies: LichessPly[] = [];
  let ply = 0;
  for (const node of g.moves.mainline()) {
    ply++;
    const move = parseSan(pos, node.san);
    if (!move) throw new Error(`illegal ${node.san} at ply ${ply}`);
    const fenBefore = makeFen(pos.toSetup());
    const color = pos.turn;
    pos.play(move);
    const p: LichessPly = { ply, san: node.san, uci: makeUci(move), color, fenBefore };
    for (const c of node.comments ?? []) {
      const e = parseEval(c);
      if (e) p.evalAfter = e;
      const j = /(Inaccuracy|Mistake|Blunder)\.\s*(\S+) was best/.exec(c);
      if (/(Inaccuracy|Mistake|Blunder)\./.test(c) || /Checkmate is now unavoidable|Lost forced checkmate/.test(c)) {
        p.comment = c.trim();
        if (j) p.lichessBest = j[2];
      }
    }
    for (const n of node.nags ?? []) if (NAG_JUDGEMENT[n]) p.judgement = NAG_JUDGEMENT[n];
    plies.push(p);
  }
  return { id: headers.GameId ?? headers.Site?.split('/').pop() ?? '?', headers, plies, pgn };
}

// --- Lichess' judgement rules (for checking the parse and as the validation profile) --------------------------

/**
 * Lichess' winningChances WITHOUT the +-1000 cp ceiling: CpAdvice passes the raw cp (current lila master), and the
 * 60 benchmark games confirm it (e.g. -6.87 -> -45.62 is judged an Inaccuracy, which needs the unceiled -45.62).
 * Our own win% (shared/winchance.ts) clamps at +-1000 as SPEC says — a deliberate difference in decided positions.
 */
export function winningChances(cp: number): number {
  return Math.max(-1, Math.min(1, 2 / (1 + Math.exp(-0.00368208 * cp)) - 1));
}

/** Lichess judgement of a move from the evals before/after it (White POV), mover `color`. */
export function lichessJudgement(before: LichessScore, after: LichessScore, color: 'white' | 'black'): Judgement | undefined {
  const sign = color === 'white' ? 1 : -1;
  if (before.cp !== undefined && after.cp !== undefined) {
    const delta = sign * (winningChances(before.cp) - winningChances(after.cp));
    if (delta >= 0.3) return 'blunder';
    if (delta >= 0.2) return 'mistake';
    if (delta >= 0.1) return 'inaccuracy';
    return undefined;
  }
  const mb = before.mate !== undefined ? sign * before.mate : undefined; // mover POV
  const ma = after.mate !== undefined ? sign * after.mate : undefined;
  const cb = before.cp !== undefined ? sign * before.cp : 0;
  const ca = after.cp !== undefined ? sign * after.cp : 0;
  const created = mb === undefined && ma !== undefined && ma < 0;
  const lost = mb !== undefined && mb > 0 && (ma === undefined || ma < 0);
  if (created) return cb < -999 ? 'inaccuracy' : cb < -700 ? 'mistake' : 'blunder';
  if (lost) return ca > 999 ? 'inaccuracy' : ca > 700 ? 'mistake' : 'blunder';
  return undefined;
}
