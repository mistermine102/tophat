// Fixture/mock-only: simple board facts computed with chessops, used where the fixture has no hand-written facts
// and for mock side-line analyses. (The real fact detectors live on the server.)
import type { Color, Fact, LineStep, PieceRef } from '@chess-coach/shared';
import { makeSquare, parseSquare, parseUci } from 'chessops/util';
import { materialBalance, playUci, positionFromFen, PIECE_VALUE } from '../lib/chess';

function pieceAt(fen: string, square: string): PieceRef | null {
  const pos = positionFromFen(fen);
  const sq = parseSquare(square);
  if (sq === undefined) return null;
  const p = pos.board.get(sq);
  return p ? { role: p.role, square, color: p.color } : null;
}

/** Can the side to move in `fen` capture on `square`? */
function attackedBySideToMove(fen: string, square: string): boolean {
  const pos = positionFromFen(fen);
  const sq = parseSquare(square)!;
  for (const [, dests] of pos.allDests()) if (dests.has(sq)) return true;
  return false;
}

/** Immediate facts for (fenBefore, uci): check/mate, capture, promotion, castling, development. */
export function boardFacts(fenBefore: string, uci: string, prevUci?: string): Fact[] {
  const played = playUci(fenBefore, uci);
  if (!played) return [];
  const facts: Fact[] = [];
  const move = parseUci(played.uci)!;
  if (!('from' in move)) return facts;
  const from = makeSquare(move.from);
  const to = makeSquare(move.to);
  const mover = pieceAt(fenBefore, from)!;
  const after = positionFromFen(played.fenAfter);
  const before = positionFromFen(fenBefore);
  const capturesSomething = !!before.board.get(move.to) && before.board.get(move.to)!.color !== mover.color;
  if (before.isCheck()) {
    if (mover.role === 'king') facts.push({ type: 'escape-check' });
    else if (!capturesSomething) facts.push({ type: 'block-check' });
  }

  if (after.isCheckmate()) facts.push({ type: 'checkmate' });
  else if (after.isCheck()) facts.push({ type: 'check' });

  let captured = pieceAt(fenBefore, to);
  if (captured && captured.color === mover.color) captured = null; // castling notation safety
  if (!captured && mover.role === 'pawn' && from[0] !== to[0]) {
    captured = { role: 'pawn', square: to, color: mover.color === 'white' ? 'black' : 'white' }; // en passant
  }
  if (captured) {
    const recapture = !!prevUci && prevUci.slice(2, 4) === to;
    const defended = attackedBySideToMove(played.fenAfter, to);
    const gain = PIECE_VALUE[captured.role] - (defended ? PIECE_VALUE[mover.role] : 0);
    const outcome = recapture ? 'recapture' : gain > 0 ? 'wins-material' : gain === 0 ? 'even-trade' : 'loses-material';
    facts.push({ type: 'capture', captured, outcome, net: recapture ? 0 : gain });
  }
  if (move.promotion) facts.push({ type: 'promotion', to: move.promotion });
  if (mover.role === 'king' && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2) {
    facts.push({ type: 'castle', side: to[0] === 'g' ? 'king' : 'queen' });
  }
  const backRank = mover.color === 'white' ? '1' : '8';
  if ((mover.role === 'knight' || mover.role === 'bishop') && from[1] === backRank && !captured) {
    facts.push({ type: 'develop', piece: { role: mover.role, square: to, color: mover.color } });
  }
  return facts;
}

/** A Short-term `line` fact from a UCI line starting at `fenBefore` (the first move is the analysed move). */
export function lineFact(fenBefore: string, ucis: readonly string[], mover: Color, maxPlies = 8): Fact | null {
  if (ucis.length < 2) return null;
  const steps: LineStep[] = [];
  let fen = fenBefore;
  let prev: string | undefined;
  let anyCapture = false;
  let mated = false;
  let lastWasCapture = false;
  for (let i = 0; i < ucis.length; i++) {
    const m = playUci(fen, ucis[i]!);
    if (!m) break;
    const facts = boardFacts(fen, m.uci, prev).filter((f) => f.type !== 'develop');
    const isCapture = facts.some((f) => f.type === 'capture');
    // Stop at maxPlies, but finish a capture/recapture sequence (up to 2 extra plies) so the material count
    // describes a quiet point.
    if (i >= maxPlies && !(lastWasCapture && isCapture && i < maxPlies + 2)) break;
    if (isCapture) anyCapture = true;
    if (facts.some((f) => f.type === 'checkmate')) mated = true;
    steps.push({ ply: i + 1, san: m.san, uci: m.uci, color: m.color, facts });
    prev = m.uci;
    fen = m.fenAfter;
    lastWasCapture = isCapture;
    if (mated) break;
  }
  const sign = mover === 'white' ? 1 : -1;
  const materialDelta = sign * (materialBalance(fen) - materialBalance(fenBefore));
  const lastMover = steps[steps.length - 1]?.color;
  const result: Extract<Fact, { type: 'line' }>['result'] = mated
    ? lastMover === mover
      ? 'mate'
      : 'mated'
    : materialDelta >= 1
      ? 'wins-material'
      : materialDelta <= -1
        ? 'loses-material'
        : anyCapture
          ? 'trade'
          : 'quiet';
  return { type: 'line', steps, materialDelta, result, ...(mated ? { mateIn: Math.ceil(steps.length / 2) } : {}) };
}
