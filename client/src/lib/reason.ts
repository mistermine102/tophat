// Short human sentences for a move's label ("why this label"), built only from MoveAnalysis fields.
import type { Color, Label, MoveAnalysis, PieceRole } from '@chess-coach/shared';
import { fromWhitePov } from '@chess-coach/shared';
import { PIECE_VALUE } from './chess';
import { formatScore } from './format';
import { LABELS } from './labels';

export interface ReasonContext {
  /** Is the mover the user ("You")? */
  moverIsYou: boolean;
  /** SAN (with number) of the opponent's previous move, for Miss. */
  prevMove?: string | null;
}

const sideName = (c: Color) => (c === 'white' ? 'White' : 'Black');
const pct = (x: number) => `${x < 10 ? x.toFixed(1) : Math.round(x)}%`;

/** Mover-POV eval text, e.g. "+12.0" or "M3". */
export function moverEval(a: MoveAnalysis, which: 'before' | 'after'): string {
  return formatScore(fromWhitePov(which === 'before' ? a.evalBefore : a.evalAfter, a.color));
}

/** True when the material rule (not win chance) decided the label. */
export function isMaterialLabel(a: MoveAnalysis): boolean {
  const m = a.labelReason.material;
  return !!m?.label && a.label === m.label && LABELS[m.label].severity > LABELS[a.labelReason.winChance].severity;
}

export function labelReasonText(a: MoveAnalysis, ctx: ReasonContext): string {
  const r = a.labelReason;
  const who = ctx.moverIsYou ? 'You' : sideName(a.color);
  const loss = a.winLoss;
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
    const m = r.material!;
    const what = m.hung
      ? `left the ${m.hung.role} on ${m.hung.square} hanging (−${PIECE_VALUE[m.hung.role as PieceRole] || m.loss})`
      : `gave up ${m.loss} ${m.loss === 1 ? 'pawn' : 'pawns'} of material compared with the best line`;
    const sentence = `${ctx.moverIsYou ? 'You' : sideName(a.color)} ${what}.`;
    if (a.winAfter >= 70) {
      const are = ctx.moverIsYou ? "You're" : `${sideName(a.color)} is`;
      return `${sentence} ${are} still winning (${moverEval(a, 'before')} → ${moverEval(a, 'after')}), but this is the habit to fix.`;
    }
    return sentence;
  }
  if (loss < 0.05 && a.label !== 'best') return LABELS[a.label].blurb;
  switch (a.label) {
    case 'best':
      return a.played.rank === 1 ? 'The engine’s top choice.' : 'As good as the engine’s top move.';
    case 'excellent':
      return `Almost as good as the best move (${pct(loss)} win chance lost).`;
    case 'good':
      return `A decent move — ${pct(loss)} win chance worse than the best.`;
    case 'inaccuracy':
      return `${who} lost ${pct(loss)} win chance — a better move was available.`;
    case 'mistake':
      return `${who} gave away ${pct(loss)} win chance.`;
    case 'blunder':
      return `A serious error: ${pct(loss)} win chance lost.`;
  }
  return LABELS[a.label as Label].blurb;
}
