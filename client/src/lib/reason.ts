// Short human sentences for a move's label ("why this label"), built only from MoveAnalysis fields.
//
// POV convention (ARCHITECTURE.md "Conventions", client side): every *signed* eval shown in the UI (eval row, eval
// bar, graph, candidate scores) is White POV. Numbers in these sentences are labelled with their side instead
// ("eval for Black: M9 → +6.7", "Black's win chance 38% → 22%"), so a mover-POV number never appears unlabelled
// next to a White-POV one.
import type { Color, Label, MoveAnalysis } from '@chess-coach/shared';
import { fromWhitePov } from '@chess-coach/shared';
import { isCheckmate } from './chess';
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

export function labelReasonText(a: MoveAnalysis, ctx: ReasonContext): string {
  const r = a.labelReason;
  const who = ctx.moverIsYou ? 'You' : sideName(a.color);
  const loss = a.winLoss;
  const best = a.best.uci !== a.uci ? a.best.san : null;
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
      ? `left the ${m.hung.role} on ${m.hung.square} hanging (−${m.loss})`
      : `gave up ${m.loss} ${m.loss === 1 ? 'pawn' : 'pawns'} of material compared with the best line`;
    const sentence = `${who} ${what}.`;
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
      return a.played.rank === 1 || !best ? 'The engine’s top choice.' : `As good as the engine’s top move (${best}).`;
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

