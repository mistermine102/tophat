// Short human sentences for a move's label ("why this label"), built only from MoveAnalysis fields.
//
// POV convention (ARCHITECTURE.md "Conventions", client side): every *signed* eval shown in the UI (eval row, eval
// bar, graph, candidate scores) is White POV. Numbers in these sentences are labelled with their side instead
// ("eval for Black: M9 → +6.7", "Black's win chance 38% → 22%"), so a mover-POV number never appears unlabelled
// next to a White-POV one.
import type { Color, Label, MoveAnalysis } from '@chess-coach/shared';
import { fromWhitePov } from '@chess-coach/shared';
import { parseSquare } from 'chessops/util';
import { isCheckmate, tryPosition } from './chess';
import { formatScore } from './format';
import { LABELS } from './labels';

export interface ReasonContext {
  /** Is the mover the user ("You")? */
  moverIsYou: boolean;
  /** SAN (with number) of the opponent's previous move, for Miss. */
  prevMove?: string | null;
}

export const sideName = (c: Color) => (c === 'white' ? 'White' : 'Black');
const pct = (x: number) => `${x < 10 ? x.toFixed(1) : Math.round(x)}%`;

/** Eval from the mover's point of view, e.g. "+12.0" or "M3" — only for text that names the side. */
export function moverEval(a: MoveAnalysis, which: 'before' | 'after'): string {
  return formatScore(fromWhitePov(which === 'before' ? a.evalBefore : a.evalAfter, a.color));
}

/** True when the material rule (not win chance) decided the label. */
export function isMaterialLabel(a: MoveAnalysis): boolean {
  const m = a.labelReason.material;
  return !!m?.label && a.label === m.label && LABELS[m.label].severity > LABELS[a.labelReason.winChance].severity;
}

/**
 * True when a mate rule (M3: allowed mate in ≤ 3 → Blunder, missed mate in ≤ 3 → Miss), not win chance, decided the
 * label — e.g. a move allowing mate in an already lost position, where the win chance hardly changes.
 */
export function isMateLabel(a: MoveAnalysis): boolean {
  const r = a.labelReason;
  const byMate = (r.allowedMate && a.label === 'blunder') || (r.missedMate && (a.label === 'miss' || a.label === 'blunder'));
  return !!byMate && LABELS[a.label].severity > LABELS[r.winChance].severity;
}

const mateIn = (n: number) => (n === 1 ? 'mate in one' : `a forced mate in ${n}`);

/** The sentence for a mate-rule label (allowed / missed short mate), or null. */
function mateReason(a: MoveAnalysis, ctx: ReasonContext, best: string | null): string | null {
  const r = a.labelReason;
  const who = ctx.moverIsYou ? 'You' : sideName(a.color);
  const am = r.allowedMate;
  if (am && a.label === 'blunder') {
    const avoid = am.bestMatedIn ? `${best ?? 'the best move'} would have lasted ${am.bestMatedIn} moves` : `${best ?? 'the best move'} would have avoided it`;
    const was = ctx.moverIsYou ? 'You were' : `${sideName(a.color)} was`;
    const sentence = `${who} allowed ${mateIn(am.matedIn)}.`;
    return r.winChance !== 'blunder' ? `${sentence} ${was} already losing, but ${avoid} — watch for mating threats.` : `${sentence} ${avoid[0]!.toUpperCase()}${avoid.slice(1)}.`;
  }
  const mm = r.missedMate;
  if (mm && (a.label === 'miss' || a.label === 'blunder')) {
    const lost = a.winLoss >= 0.05 ? ` (${pct(a.winLoss)} win chance given back)` : '';
    return `Missed ${mateIn(mm.mateIn)}: ${a.best.san} forces mate, this move doesn't${lost}.`;
  }
  return null;
}

const points = (n: number) => `${n} ${n === 1 ? 'point' : 'points'}`;

/**
 * The material-rule sentence. A piece is named as "hanging" only when losing it is the whole story (its own
 * exchange loss covers the line's loss); otherwise the loss is told as the line comparison, like the server's
 * labelText ("h5 left a pawn hanging (−8)" would be wrong when the 8 points come from a later promotion).
 */
function materialSentence(a: MoveAnalysis, who: string, best: string | null): string {
  const m = a.labelReason.material!;
  const hung = m.hung && m.hung.color === a.color ? m.hung : null;
  const hungLoss = m.hungLoss ?? m.loss;
  if (hung && hungLoss >= m.loss) {
    const to = a.uci.slice(2, 4);
    const captured = a.san.includes('x') ? capturedRole(a.fenBefore, to, a.uci) : null;
    if (captured && hung.square === to) {
      return `${who} took a ${captured} with the ${hung.role}, but the ${hung.role} can be taken back (−${points(hungLoss)}).`;
    }
    return `${who} left the ${hung.role} on ${hung.square} hanging (−${points(hungLoss)}).`;
  }
  return `${who} lost material: with best play it ends ${points(m.loss)} worse than after ${best ?? 'the best move'}.`;
}

/** Role of the piece a capture takes (en passant: pawn). */
function capturedRole(fenBefore: string, to: string, uci: string): string | null {
  const pos = tryPosition(fenBefore);
  if (!pos) return null;
  const sq = parseSquare(to);
  if (sq === undefined) return null;
  const piece = pos.board.get(sq);
  if (piece) return piece.role;
  const from = parseSquare(uci.slice(0, 2));
  return from !== undefined && pos.board.get(from)?.role === 'pawn' ? 'pawn' : null;
}

export function labelReasonText(a: MoveAnalysis, ctx: ReasonContext): string {
  const r = a.labelReason;
  const who = ctx.moverIsYou ? 'You' : sideName(a.color);
  const loss = a.winLoss;
  const best = a.best.uci !== a.uci ? a.best.san : null;
  // mate rules first: "allows mate in 2" / "missed mate in 2" is the reason even when win% hardly moves
  const mate = mateReason(a, ctx, best);
  if (mate) return mate;
  switch (a.label) {
    case 'book':
      return r.book ? `Opening theory: ${r.book.name} (${r.book.eco}).` : 'A known opening move.';
    case 'forced':
      return 'The only legal move.';
    case 'great': {
      const second = a.candidates.find((c) => c.rank === 2);
      const l = r.great?.secondBestLoss ?? second?.winLoss;
      return second && l !== undefined
        ? `The only good move — the next best, ${second.san}, would have thrown away ${pct(l)} win chance.`
        : 'The only good move here.';
    }
    case 'miss': {
      const prev = ctx.prevMove ? ` ${ctx.prevMove}` : ' the previous move';
      return `Missed the chance to punish${prev}: ${a.best.san} would have kept the advantage (${pct(loss)} win chance given back).`;
    }
    default:
      break;
  }
  if (isMaterialLabel(a)) {
    const sentence = materialSentence(a, who, best);
    if (a.winAfter >= 70) {
      const are = ctx.moverIsYou ? "You're" : `${sideName(a.color)} is`;
      return `${sentence} ${are} still winning (eval for ${sideName(a.color)}: ${moverEval(a, 'before')} → ${moverEval(a, 'after')}), but this is the habit to fix.`;
    }
    return sentence;
  }
  if (a.label === 'best' && isCheckmate(a.fenAfter)) return 'Checkmate!';
  if (loss < 0.05 && a.label !== 'best') return LABELS[a.label].blurb;
  switch (a.label) {
    case 'best':
      return a.played.rank === 1 || !best ? 'The best move.' : `As good as the best move (${best}).`;
    case 'excellent':
      return `Almost as good as the best move${best ? `, ${best}` : ''} (${pct(loss)} win chance lost).`;
    case 'good':
      return `A decent move — ${pct(loss)} win chance worse than ${best ?? 'the best'}.`;
    case 'inaccuracy':
      return `${who} lost ${pct(loss)} win chance — ${best ? `${best} was better` : 'a better move was available'}.`;
    case 'mistake':
      return `${who} gave away ${pct(loss)} win chance${best ? ` — ${best} was much better` : ''}.`;
    case 'blunder':
      return `A serious error: ${pct(loss)} win chance lost${best ? ` — ${best} was much better` : ''}.`;
  }
  return LABELS[a.label as Label].blurb;
}

