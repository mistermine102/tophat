// Immediate facts: what a move does right now, verified on the board (before vs after). No engine.
//
// Precision over recall: every tactical fact (fork, skewer) is only emitted after checking that the mover
// really wins material against *every* legal reply (one ply of brute force + SEE). Static facts (pin, attack,
// discovered attack) are emitted only when the target can actually be won (SEE > 0) or is more valuable.
//
// Definitions (all "new" facts compare the position before and after the move, tracking piece identity):
// - stalemate: the opponent has no legal move and is not in check (the game is drawn).
// - check / checkmate: the opponent is in check (mated); `discovered` if a checker is not the moved piece (the
//   castling rook counts as moved), `double` if ≥ 2 checkers. `check` is not emitted together with `checkmate`.
// - capture: outcome from SEE net (`seeMove`): < 0 loses-material; otherwise recapture (if `prev` shows the
//   opponent just captured on this square), > 0 wins-material, 0 even-trade.
// - develop: a knight/bishop leaves its original square (b1 c1 f1 g1 / b8 c8 f8 g8) for a square off the back
//   rank, while the game is in the opening (fullmove ≤ OPENING_MAX_FULLMOVE).
// - attack: the moved piece newly attacks an enemy non-king piece it can win: undefended (no defenders, SEE > 0)
//   or worth more than the attacker. Attacks on the king are `check`.
// - fork: the moved piece attacks ≥ 2 real targets — the king when it gives check, or non-pawn pieces it can
//   capture with SEE > 0 — at least one of them newly attacked, and against every legal reply the mover still
//   wins material with that piece or by capturing the piece that just replied, net of anything the reply captured
//   (so a forking piece that is simply taken, or a fork answered by one move, is not a fork).
// - pin: a mover slider newly attacks an enemy piece (not a pawn) with the enemy king (absolute) or a more
//   valuable piece that the slider would then win (relative) directly behind it. The pinner must not be hanging
//   and the pinned piece must not be able to take the pinner without losing material.
// - skewer: a mover slider newly attacks the enemy king (giving check) or a piece worth more than both the slider
//   and the piece behind it; behind it stands a non-pawn piece the slider wins once the front piece steps away
//   (SEE > 0), and the mover wins material with that slider against every legal reply.
// - discovered-attack: a mover piece other than the moved one newly attacks an enemy non-pawn, non-king piece
//   through the vacated square and could win it (SEE > 0). (Discovered attacks on the king: `check.discovered`.)
// - escape: a mover piece that was hanging before (opponent SEE > 0 if it were their move) moved and is not
//   hanging any more. defend: the moved piece newly defends a hanging mover piece which is now safe.
// - block-check / escape-check: the mover was in check and interposed / moved the king.
// - hangs: after the move (opponent to move, legal captures only — so while in check they may only capture if
//   it also resolves the check) a mover piece can be won (SEE > 0) that couldn't before, or the moved piece itself
//   can be won (quiet moves; for captures the capture outcome `loses-material` says it). Also `already: true`
//   for a piece that was en prise before and still is, when the move wasn't a check evasion and didn't itself
//   win at least as much (loss ≥ HANGS_ALREADY_MIN_LOSS). Not with checkmate.
// - allows-mate: the opponent has a mate in 1 after the move (brute force).
// - castling-lost (M5b): the mover could still castle (either side) before the move and can't at all after it — a
//   king move that isn't castling, or a rook move that gives up the last right — while the opponent still has
//   attacking material (non-pawn material >= CASTLING_MIN_ENEMY_MATERIAL).
// - attack-pinned (M5b): an enemy piece was already pinned before the move (absolute, or relative with the pinner
//   winning the piece behind once it steps away) by a mover slider that stays put; the moved piece newly attacks it,
//   the pinned piece can't take the moved piece / the pinner without losing material, and the mover can now win it
//   by SEE when it couldn't before.
// - trapped (M5b): an enemy knight/bishop/rook/queen (not absolutely pinned) can be won by SEE after the move, and
//   every legal move of it loses material by SEE (no safe square, `noSafeSquare`) — which wasn't the case before.
//   (analyzeMove keeps it only if the engine line really wins the piece.)
// - capture.desperado (M5b): the capturing piece was en prise before the move with no safe square, so taking
//   something before it is lost is better than nothing (the capture's SEE alone may look like a loss).

import { kingCastlesTo, makeUci, opposite, parseUci, type Color, type NormalMove, type Position, type Role, type Square } from 'chessops';
import { castlingSide } from 'chessops/chess';
import { rookCastlesTo } from 'chessops/util';
import type { Fact, PieceRef } from '@chess-coach/shared';
import {
  attackedPieces,
  attackersOf,
  attacksFrom,
  between,
  defendersOf,
  lineBehind,
  pinsAgainst,
  toPieceRef,
  withTurn,
} from '../chess/attacks';
import { PIECE_VALUES, positionFromFen } from '../chess/material';
import { capturedBy, hangingLoss, see, seeCaptureWith, seeMove } from '../chess/see';

export type FactType = Fact['type'];

/** Importance order of immediate facts (most important first). Facts are sorted by this, then by value. */
export const FACT_IMPORTANCE: readonly FactType[] = [
  'checkmate',
  'stalemate',
  'allows-mate',
  'hangs',
  'fork',
  'trapped',
  'skewer',
  'discovered-attack',
  'pin',
  'attack-pinned',
  'capture',
  'promotion',
  'check',
  'attack',
  'escape',
  'defend',
  'escape-check',
  'block-check',
  'castle',
  'castling-lost',
  'develop',
  'threat',
  'line',
  'forced-reply',
  'positional',
  'positional-gain',
  'deep-payoff',
  'necessary',
  'nothing-notable',
];

/**
 * A piece that was already en prise before the move and still is after it is reported as `hangs` (`already`) only
 * if the loss is at least this much (pawns left en prise are usually gambits / deliberate, and very noisy).
 */
export const HANGS_ALREADY_MIN_LOSS = 2;

/** castling-lost is only told while the opponent has at least this much non-pawn material (an attack is possible). */
export const CASTLING_MIN_ENEMY_MATERIAL = 9;

/** Last fullmove number considered "opening" for `develop`. */
export const OPENING_MAX_FULLMOVE = 15;

export interface ImmediateOptions {
  /** The opponent's previous move (position before it + UCI), used to recognise recaptures. */
  prev?: { fenBefore: string; uci: string };
}

const START_MINOR_SQUARES: Record<Color, Square[]> = {
  white: [1, 2, 5, 6], // b1 c1 f1 g1
  black: [57, 58, 61, 62], // b8 c8 f8 g8
};

const SLIDERS: ReadonlySet<Role> = new Set<Role>(['bishop', 'rook', 'queen']);

function legalReplies(pos: Position): NormalMove[] {
  const out: NormalMove[] = [];
  const ctx = pos.ctx();
  for (const [from, dests] of pos.allDests(ctx)) {
    const isPawn = pos.board.pawn.has(from);
    for (const to of dests) {
      const rank = to >> 3;
      if (isPawn && (rank === 0 || rank === 7)) {
        for (const promotion of ['queen', 'knight', 'rook', 'bishop'] as const) out.push({ from, to, promotion });
      } else out.push({ from, to });
    }
  }
  return out;
}

/** Does `pos` (side to move) have a mate in one? */
export function hasMateInOne(pos: Position): boolean {
  for (const m of legalReplies(pos)) {
    if (m.promotion && m.promotion !== 'queen' && m.promotion !== 'knight') continue;
    const p = pos.clone();
    p.play(m);
    if (p.isCheck() && p.isCheckmate()) return true;
  }
  return false;
}

/**
 * Against every legal reply of the side to move in `after`, can the other side win material with the piece on
 * `sq` (a capture with SEE > 0) or by recapturing on the reply's destination, net of what the reply captured?
 */
function winsAgainstAllReplies(after: Position, sq: Square): boolean {
  const mover = opposite(after.turn);
  const replies = legalReplies(after);
  if (replies.length === 0) return false;
  for (const r of replies) {
    const cap = capturedBy(after, r);
    const taken = (cap ? PIECE_VALUES[cap.role] : 0) + (r.promotion ? PIECE_VALUES[r.promotion] - 1 : 0);
    const p = after.clone();
    p.play(r);
    if (p.isCheckmate()) return false;
    // capture the piece that just moved (recapture / desperado / checking piece) …
    let best = see(p, r.to, mover);
    const piece = p.board.get(sq);
    if (piece && piece.color === mover) {
      for (const t of attackedPieces(p.board, sq)) {
        const g = seeCaptureWith(p, sq, t);
        if (g !== undefined && g > best) best = g;
      }
    }
    if (best - taken <= 0) return false;
  }
  return true;
}

const ref = (pos: Position, sq: Square): PieceRef => toPieceRef(pos.board.get(sq)!, sq);

/**
 * In `after` (opponent to move) can the opponent capture the mover's piece on `sq` and keep a material gain,
 * even after the mover's best counter-capture elsewhere (a counter-attack created by the move)? Recaptures on
 * `sq` itself are already part of the SEE of the capture.
 */
function opponentReallyWins(after: Position, sq: Square): boolean {
  for (const m of legalReplies(after)) {
    if (m.to !== sq || (m.promotion && m.promotion !== 'queen')) continue;
    const uci = makeUci(m);
    const gain = seeMove(after, uci);
    if (gain <= 0) continue;
    const p = after.clone();
    p.play(m);
    if (p.isCheckmate()) return true;
    let counter = 0;
    for (const c of legalReplies(p)) {
      if (c.to === sq || (c.promotion && c.promotion !== 'queen') || !capturedBy(p, c)) continue;
      const g = seeMove(p, makeUci(c));
      if (g > counter) counter = g;
    }
    if (gain - counter > 0) return true;
  }
  return false;
}

/** Immediate facts of playing `uci` in the position `fenBefore`, sorted by FACT_IMPORTANCE. */
export function immediateFacts(fenBefore: string, uci: string, opts: ImmediateOptions = {}): Fact[] {
  return immediateFactsFromPosition(positionFromFen(fenBefore), uci, opts);
}

export function immediateFactsFromPosition(before: Position, uci: string, opts: ImmediateOptions = {}): Fact[] {
  const parsed = parseUci(uci);
  if (!parsed || !('from' in parsed)) throw new Error(`bad uci ${uci}`);
  const move = parsed as NormalMove;
  if (!before.isLegal(move)) throw new Error(`illegal move ${uci}`);

  const mover = before.turn;
  const opp = opposite(mover);
  const piece = before.board.get(move.from)!;
  const castle = castlingSide(before, move);
  let toSq = move.to;
  let rookFrom: Square | undefined;
  let rookTo: Square | undefined;
  if (castle) {
    toSq = kingCastlesTo(mover, castle);
    rookFrom = before.castles.rook[mover][castle];
    rookTo = rookCastlesTo(mover, castle);
  }
  const after = before.clone();
  after.play(move);
  const facts: Fact[] = [];

  /** Square of a mover piece after the move, given its square before. */
  const fwd = (sq: Square): Square => (sq === move.from ? toSq : sq === rookFrom ? (rookTo as Square) : sq);
  /** Square of a mover piece before the move, given its square after. */
  const back = (sq: Square): Square => (sq === toSq ? move.from : sq === rookTo ? (rookFrom as Square) : sq);
  const movedAfter = new Set<Square>([toSq]);
  if (rookTo !== undefined) movedAfter.add(rookTo);

  const afterCtx = after.ctx();
  const mate = after.isCheckmate(afterCtx);
  const over = mate || after.isStalemate(afterCtx); // no reply: nothing can hang or be won
  const checkers = afterCtx.checkers;

  // --- check / checkmate ---
  if (checkers.nonEmpty()) {
    const f: Fact = mate ? { type: 'checkmate' } : { type: 'check' };
    if (checkers.moreThanOne()) f.double = true;
    if ([...checkers].some((s) => !movedAfter.has(s))) f.discovered = true;
    facts.push(f);
  } else if (after.isStalemate(afterCtx)) {
    facts.push({ type: 'stalemate' });
  }

  // --- capture ---
  const cap = capturedBy(before, move);
  let net: number | undefined;
  if (cap) {
    net = seeMove(before, uci);
    let outcome: 'wins-material' | 'even-trade' | 'recapture' | 'loses-material';
    if (net < 0) outcome = 'loses-material';
    else if (isRecapture(opts.prev, cap.square)) outcome = 'recapture';
    else outcome = net > 0 ? 'wins-material' : 'even-trade';
    const f: Fact = { type: 'capture', captured: { role: cap.role, square: sqName(cap.square), color: opp }, outcome, net };
    // desperado: the piece was lost anyway (en prise, no safe square), so the capture gains compared with doing nothing
    if (outcome === 'loses-material' && piece.role !== 'king' && hangingLoss(before, move.from) > 0 && noSafeSquare(before, move.from) && -net < hangingLoss(before, move.from)) f.desperado = true;
    facts.push(f);
  }

  // --- promotion / castle / develop ---
  if (move.promotion) facts.push({ type: 'promotion', to: move.promotion });
  if (castle) facts.push({ type: 'castle', side: castle === 'h' ? 'king' : 'queen' });
  else {
    const lost = castlingSides(before, mover);
    if (lost.length && castlingSides(after, mover).length === 0 && pieceMaterial(after, opp) >= CASTLING_MIN_ENEMY_MATERIAL) {
      facts.push({ type: 'castling-lost', color: mover, sides: lost });
    }
  }
  if (
    (piece.role === 'knight' || piece.role === 'bishop')
    && START_MINOR_SQUARES[mover].includes(move.from)
    && (toSq >> 3) !== (mover === 'white' ? 0 : 7)
    && before.fullmoves <= OPENING_MAX_FULLMOVE
  ) {
    facts.push({ type: 'develop', piece: ref(after, toSq) });
  }

  // --- check evasion ---
  if (before.isCheck()) {
    if (piece.role === 'king') facts.push({ type: 'escape-check' });
    else {
      const ch = before.ctx().checkers;
      if (!(ch.size() === 1 && cap && ch.has(cap.square))) facts.push({ type: 'block-check' });
    }
  }

  // --- hanging before/after (mover pieces) ---
  const lossBefore = new Map<Square, number>();
  for (const sq of before.board[mover].diff(before.board.king)) lossBefore.set(sq, hangingLoss(before, sq));
  const lossAfter = new Map<Square, number>();
  for (const sq of after.board[mover].diff(after.board.king)) lossAfter.set(sq, hangingLoss(after, sq));

  if (!over) {
    // hangs
    const gained = Math.max(0, net ?? 0);
    const wasInCheck = before.isCheck();
    for (const [sq, loss] of lossAfter) {
      if (loss <= 0) continue;
      if (!opponentReallyWins(after, sq)) continue; // e.g. taking it walks into a bigger counter-capture
      if (sq === toSq) {
        if (cap) continue; // a losing capture is reported by its outcome
        const l = -seeMove(before, uci);
        if (l > 0) facts.push({ type: 'hangs', piece: ref(after, sq), loss: l });
      } else if ((lossBefore.get(back(sq)) ?? 0) <= 0) {
        facts.push({ type: 'hangs', piece: ref(after, sq), loss });
      } else if (!wasInCheck && loss >= HANGS_ALREADY_MIN_LOSS && loss > gained) {
        // it was already en prise and the move neither saved it nor won at least as much elsewhere
        facts.push({ type: 'hangs', piece: ref(after, sq), loss, already: true });
      }
    }

    // allows-mate
    if (!after.isEnd(afterCtx) && hasMateInOne(after)) facts.push({ type: 'allows-mate', inMoves: 1 });
  }

  // --- escape / defend ---
  for (const [sqB, loss] of lossBefore) {
    if (loss <= 0) continue;
    const sqA = fwd(sqB);
    if (!after.board[mover].has(sqA)) continue;
    if ((lossAfter.get(sqA) ?? 0) > 0) continue;
    // while the opponent is in check a piece may look safe only because capturing it is illegal for one move
    if (checkers.nonEmpty() && !checkers.has(sqA)) continue;
    if (sqA === toSq) {
      if (sqA !== sqB) facts.push({ type: 'escape', piece: ref(after, sqA), from: sqName(sqB) });
    } else if (
      !movedAfter.has(sqA)
      && attackersOf(after.board, sqA, mover).has(toSq)
      && !attackersOf(before.board, sqB, mover).has(move.from)
    ) {
      facts.push({ type: 'defend', defender: ref(after, toSq), piece: ref(after, sqA) });
    }
  }

  if (!over) tacticalFacts(before, after, move, mover, toSq, movedAfter, back, checkers.has(toSq), facts);

  return sortFacts(facts);
}

function tacticalFacts(
  before: Position,
  after: Position,
  move: NormalMove,
  mover: Color,
  toSq: Square,
  movedAfter: Set<Square>,
  back: (sq: Square) => Square,
  movedGivesCheck: boolean,
  facts: Fact[],
): void {
  const opp = opposite(mover);
  const covered = new Set<string>(); // "attacker-target" pairs already explained by a stronger fact
  const key = (a: Square, t: Square) => `${a}-${t}`;

  /** Did the mover piece now on `a` attack `t` before the move? */
  const attackedBefore = (a: Square, t: Square) => {
    const b = back(a);
    return before.board.get(b)?.color === mover && attacksFrom(before.board, b).has(t);
  };
  // (M5b) the target can take the attacker and win material (…e7 opening f7-d5 for both queen and bishop)
  const hitsBack = (t: Square, a: Square) => {
    if (!attacksFrom(after.board, t).has(a)) return false;
    const g = seeCaptureWith(after, t, a);
    return g !== undefined && g > 0;
  };
  const canWin = (a: Square, t: Square) => {
    const g = seeCaptureWith(after, a, t);
    return g !== undefined && g > 0;
  };

  // --- fork (moved piece) ---
  {
    const targets: Square[] = [];
    let anyNew = false;
    if (movedGivesCheck) {
      targets.push(after.board.kingOf(opp)!);
      anyNew = true;
    }
    for (const t of attackedPieces(after.board, toSq)) {
      if (after.board.king.has(t) || after.board.pawn.has(t)) continue; // pawns are not fork targets
      if (!canWin(toSq, t)) continue;
      targets.push(t);
      if (!attackedBefore(toSq, t)) anyNew = true;
    }
    if (targets.length >= 2 && anyNew && winsAgainstAllReplies(after, toSq)) {
      const sorted = targets.sort((a, b) => targetOrder(after, b) - targetOrder(after, a));
      facts.push({ type: 'fork', attacker: ref(after, toSq), targets: sorted.map((t) => ref(after, t)) });
      for (const t of targets) covered.add(key(toSq, t));
    }
  }

  // --- pins and skewers (any mover slider; new only) ---
  const checkersAfter = after.ctx().checkers;
  const pinsBefore = pinsAgainst(before.board, opp, { relative: true });
  const sliders = after.board[mover].intersect(after.board.bishopsAndQueens().union(after.board.rooksAndQueens()));
  for (const s of sliders) {
    for (const p of attackedPieces(after.board, s)) {
      const x = lineBehind(after.board, s, p);
      if (x === undefined || after.board.getColor(x) !== opp) continue;
      const pRole = after.board.getRole(p)!;
      const xRole = after.board.getRole(x)!;
      // New? The same slider (by identity) had the same front+behind before the move.
      const sb = back(s);
      const existedBefore = before.board.get(sb)?.color === mover
        && SLIDERS.has(before.board.getRole(sb)!)
        && lineBehind(before.board, sb, p) === x
        && before.board.get(p)?.color === opp;
      if (existedBefore) continue;

      if (pRole !== 'king' && pRole !== 'pawn' && (xRole === 'king' || PIECE_VALUES[xRole] > PIECE_VALUES[pRole])) {
        // pin candidate
        if ((hangingLoss(after, s)) > 0) continue;
        const pinnedTakes = attacksFrom(after.board, p).has(s) ? seeCaptureWith(after, p, s) : undefined;
        if (pinnedTakes !== undefined && pinnedTakes >= 0) continue;
        const absolute = xRole === 'king';
        if (!absolute) {
          // moving the pinned piece must expose the piece behind to a winning capture by the pinner
          const g = exchangeBehind(after, s, p, x);
          if (g <= 0) continue;
        }
        // (round 7) already pinned to the same piece by another slider (Re8 through d8, then Rdd8): not a new pin —
        // the move adds an attacker (told as attack-pinned when the piece can now be won)
        const old = pinsBefore.find((q) => q.pinned === p && q.behind === x);
        if (old) {
          if (see(after, p, mover) > 0 && see(before, p, mover) <= 0 && !facts.some((f) => f.type === 'attack-pinned' && f.pinned.square === sqName(p))) {
            facts.push({ type: 'attack-pinned', attacker: ref(after, s), pinned: ref(after, p), pinner: ref(before, old.pinner), behind: ref(after, x), absolute });
          }
          covered.add(key(s, p));
          continue;
        }
        facts.push({ type: 'pin', pinner: ref(after, s), pinned: ref(after, p), behind: ref(after, x), absolute });
        covered.add(key(s, p));
      } else if (
        xRole !== 'king' && xRole !== 'pawn'
        && (pRole === 'king' || (PIECE_VALUES[pRole] > PIECE_VALUES[xRole] && PIECE_VALUES[pRole] > PIECE_VALUES[after.board.getRole(s)!]))
      ) {
        // skewer candidate: the front piece must move (king in check / attacked by a cheaper piece), the slider
        // then wins the piece behind, and it wins material whatever the opponent does
        if (pRole === 'king' && !checkersAfter.has(s)) continue;
        if (exchangeBehind(after, s, p, x) <= 0) continue;
        if (!winsAgainstAllReplies(after, s)) continue;
        facts.push({ type: 'skewer', attacker: ref(after, s), front: ref(after, p), behind: ref(after, x) });
        covered.add(key(s, p));
        covered.add(key(s, x));
      }
    }
  }

  // --- discovered attacks (mover pieces other than the moved one, line through a vacated square) ---
  const vacated: Square[] = [move.from];
  const cap = capturedBy(before, move);
  if (cap && cap.square !== move.to) vacated.push(cap.square); // en passant
  for (const a of after.board[mover]) {
    if (movedAfter.has(a)) continue;
    for (const t of attackedPieces(after.board, a)) {
      if (after.board.king.has(t) || after.board.pawn.has(t)) continue;
      if (attacksFrom(before.board, a).has(t)) continue;
      if (!vacated.some((v) => between(a, t).has(v))) continue;
      if (!canWin(a, t) || hitsBack(t, a)) continue;
      if (covered.has(key(a, t))) continue;
      facts.push({ type: 'discovered-attack', moved: ref(after, toSq), attacker: ref(after, a), target: ref(after, t) });
      covered.add(key(a, t));
    }
  }

  // --- adding an attacker to an already pinned piece ---
  for (const pin of pinsAgainst(before.board, opp, { relative: true })) {
    if (pin.pinner === move.from || movedAfter.has(pin.pinner)) continue;
    if (before.board.pawn.has(pin.pinned)) continue; // pinned pawns: minor, noisy
    if (hangingLoss(after, toSq) > 0) continue; // the new attacker can simply be taken
    if (after.board.get(pin.pinner)?.color !== mover || lineBehind(after.board, pin.pinner, pin.pinned) !== pin.behind) continue;
    if (after.board.get(pin.pinned)?.color !== opp || after.board.get(pin.behind)?.color !== opp) continue;
    if (!attacksFrom(after.board, toSq).has(pin.pinned) || attackedBefore(toSq, pin.pinned)) continue;
    if (covered.has(key(toSq, pin.pinned))) continue;
    if (!pin.absolute && exchangeBehind(after, pin.pinner, pin.pinned, pin.behind) <= 0) continue;
    // the pinned piece must not simply take the new attacker or the pinner
    const takes = [toSq, pin.pinner].some((t) => {
      if (!attacksFrom(after.board, pin.pinned).has(t)) return false;
      const g = seeCaptureWith(after, pin.pinned, t);
      return g !== undefined && g >= 0;
    });
    if (takes) continue;
    if (see(after, pin.pinned, mover) <= 0 || see(before, pin.pinned, mover) > 0) continue;
    facts.push({
      type: 'attack-pinned',
      attacker: ref(after, toSq),
      pinned: ref(after, pin.pinned),
      pinner: ref(after, pin.pinner),
      behind: ref(after, pin.behind),
      absolute: pin.absolute,
    });
    covered.add(key(toSq, pin.pinned));
  }

  // --- trapped enemy pieces (no safe square, can be won) ---
  {
    const pinnedNow = pinsAgainst(after.board, opp, { relative: true }).map((p) => p.pinned); // a pinned piece: the pin is the story
    let beforeOpp: Position | null = null;
    try {
      beforeOpp = withTurn(before, opp);
    } catch {
      beforeOpp = null;
    }
    for (const t of after.board[opp].diff(after.board.pawn).diff(after.board.king)) {
      if (pinnedNow.includes(t)) continue;
      if (hangingLoss(after, t) <= 0 || !noSafeSquare(after, t)) continue;
      // new: before the move it was not both en prise and without a safe square
      if (before.board.get(t)?.color === opp && hangingLoss(before, t) > 0 && beforeOpp && noSafeSquare(beforeOpp, t)) continue;
      const attackers = [...attackersOf(after.board, t, mover)].sort((a, b) => PIECE_VALUES[after.board.getRole(a)!] - PIECE_VALUES[after.board.getRole(b)!]);
      const a = attackers.find((x) => movedAfter.has(x)) ?? attackers[0];
      if (a === undefined) continue;
      facts.push({ type: 'trapped', piece: ref(after, t), attacker: ref(after, a) });
      for (const x of attackers) covered.add(key(x, t));
    }
  }

  // --- simple new attacks by the moved piece(s) ---
  for (const a of movedAfter) {
    const aRole = after.board.getRole(a)!;
    for (const t of attackedPieces(after.board, a)) {
      if (after.board.king.has(t)) continue;
      if (covered.has(key(a, t)) || attackedBefore(a, t)) continue;
      if (!canWin(a, t) || hitsBack(t, a)) continue;
      const tRole = after.board.getRole(t)!;
      let reason: 'undefended' | 'higher-value' | undefined;
      if (defendersOf(after.board, t).isEmpty()) reason = 'undefended';
      else if (aRole !== 'king' && PIECE_VALUES[tRole] > PIECE_VALUES[aRole]) reason = 'higher-value';
      if (!reason) continue;
      facts.push({ type: 'attack', attacker: ref(after, a), target: ref(after, t), reason });
    }
  }
}

/** Gain for the pinner capturing the piece behind once the pinned piece has stepped off the line. */
function exchangeBehind(after: Position, s: Square, p: Square, x: Square): number {
  const pos = after.clone();
  pos.board.take(p);
  const g = seeCaptureWith(pos, s, x);
  return g ?? 0;
}

function targetOrder(pos: Position, sq: Square): number {
  const r = pos.board.getRole(sq)!;
  return r === 'king' ? 100 : PIECE_VALUES[r];
}

/** Castling sides `color` still has the right to (not whether castling is legal right now). */
export function castlingSides(pos: Position, color: Color): ('king' | 'queen')[] {
  const out: ('king' | 'queen')[] = [];
  if (pos.castles.rook[color].h !== undefined) out.push('king');
  if (pos.castles.rook[color].a !== undefined) out.push('queen');
  return out;
}

/** Non-pawn, non-king material of `color` (pawn units). */
export function pieceMaterial(pos: Position, color: Color): number {
  let s = 0;
  for (const sq of pos.board[color].diff(pos.board.pawn).diff(pos.board.king)) s += PIECE_VALUES[pos.board.getRole(sq)!];
  return s;
}

/**
 * The piece on `sq` has no safe square: every legal move of it (as if its side were to move) loses material by
 * SEE (net < 0, captures included). A piece without legal moves has none either.
 */
export function noSafeSquare(pos: Position, sq: Square): boolean {
  const piece = pos.board.get(sq);
  if (!piece) return false;
  let p: Position = pos;
  if (pos.turn !== piece.color) {
    try {
      p = withTurn(pos, piece.color);
    } catch {
      return false;
    }
  }
  const ctx = p.ctx();
  if (ctx.checkers.nonEmpty()) return false; // its side is in check: its moves are about the check, not about safety
  for (const to of p.dests(sq, ctx)) {
    const rank = to >> 3;
    const promo = piece.role === 'pawn' && (rank === 0 || rank === 7) ? 'q' : '';
    if (seeMove(p, makeUci({ from: sq, to }) + promo) >= 0) return false;
  }
  return true;
}

function isRecapture(prev: ImmediateOptions['prev'], square: Square): boolean {
  if (!prev) return false;
  try {
    const pos = positionFromFen(prev.fenBefore);
    const m = parseUci(prev.uci);
    if (!m || !('from' in m)) return false;
    return m.to === square && capturedBy(pos, m) !== undefined;
  } catch {
    return false;
  }
}

const FILES = 'abcdefgh';
const sqName = (sq: Square) => `${FILES[sq & 7]}${(sq >> 3) + 1}`;

/** Value used to order facts of the same type (higher first). */
function factWeight(f: Fact): number {
  switch (f.type) {
    case 'hangs': return f.loss;
    case 'capture': return f.net;
    case 'fork': return f.targets.reduce((s, t) => s + (t.role === 'king' ? 10 : PIECE_VALUES[t.role]), 0);
    case 'pin': return (f.absolute ? 10 : 0) + PIECE_VALUES[f.pinned.role];
    case 'attack-pinned': return PIECE_VALUES[f.pinned.role];
    case 'trapped': return PIECE_VALUES[f.piece.role];
    case 'skewer': return PIECE_VALUES[f.behind.role];
    case 'discovered-attack': return PIECE_VALUES[f.target.role];
    case 'attack': return PIECE_VALUES[f.target.role];
    case 'escape': return PIECE_VALUES[f.piece.role];
    case 'defend': return PIECE_VALUES[f.piece.role];
    default: return 0;
  }
}

export function sortFacts(facts: Fact[]): Fact[] {
  const rank = (t: FactType) => {
    const i = FACT_IMPORTANCE.indexOf(t);
    return i < 0 ? FACT_IMPORTANCE.length : i;
  };
  return facts
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f.type) - rank(b.f.type) || factWeight(b.f) - factWeight(a.f) || a.i - b.i)
    .map((x) => x.f);
}
