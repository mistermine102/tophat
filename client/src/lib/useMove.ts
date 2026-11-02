// The viewed move for the prototype layouts: its analysis state, verdict, key points, the better move, eval change,
// and helpers to preview / play a candidate's line. Presentation-free (shared by layouts A, B and C).
import type { Candidate } from '@chess-coach/shared';
import { computed } from 'vue';
import type { Session } from '../stores/session';
import { isCheckmate, isStalemate, moveNumberLabel, sideToMove } from './chess';
import { formatPositionEval } from './format';
import { LABELS } from './labels';
import { pvSteps } from './pv';
import { isMateLabel, isMaterialLabel, labelReasonText, sideName } from './reason';
import { betterMove, keyPoints, moveVerdict } from './verdict';

export function useMove(session: Session) {
  const node = computed(() => session.current.value);
  const a = computed(() => session.currentAnalysis.value);
  const pending = computed(() => session.isPending(node.value));
  const error = computed(() => session.errorFor(node.value));
  const moverIsYou = computed(() => !!node.value && node.value.color === session.state.you);
  const prevMove = computed(() => {
    const p = node.value?.parent;
    return p && p.ply > 0 && p.fenBefore ? `${moveNumberLabel(p.fenBefore)} ${p.san}` : null;
  });
  // sentences name the side ("White gave away …"), never "you": the viewer may be neither player
  const ctx = computed(() => ({ moverIsYou: false, prevMove: prevMove.value }));
  const verdict = computed(() => (a.value ? moveVerdict(a.value, ctx.value) : null));
  const points = computed(() => (a.value && verdict.value ? keyPoints(a.value, verdict.value) : []));
  const better = computed(() => betterMove(a.value));
  const meta = computed(() => (a.value ? LABELS[a.value.label] : null));
  const moveName = computed(() => (node.value?.fenBefore ? `${moveNumberLabel(node.value.fenBefore)} ${node.value.san}` : ''));
  const moverName = computed(() => (node.value?.color ? sideName(node.value.color) : ''));
  const mated = computed(() => (a.value && isCheckmate(a.value.fenAfter) ? sideToMove(a.value.fenAfter) : null));
  const evalChange = computed(() => {
    const x = a.value;
    if (!x) return null;
    const stale = !mated.value && isStalemate(x.fenAfter);
    return { before: formatPositionEval(x.evalBefore, null), after: stale ? '½-½' : formatPositionEval(x.evalAfter, mated.value) };
  });
  const reason = computed(() => (a.value ? labelReasonText(a.value, ctx.value) : ''));
  /** Why the label is harsher than the win-chance drop (material / mate rule), or null. */
  const ruleNote = computed(() => {
    const x = a.value;
    if (!x) return null;
    if (isMateLabel(x)) return `Marked ${LABELS[x.label].name} because it ${x.labelReason.allowedMate && x.label === 'blunder' ? 'allows' : 'misses'} a quick forced mate — worth noticing even when the game is decided.`;
    if (isMaterialLabel(x)) return `Marked ${LABELS[x.label].name} because it gives away material for nothing — a habit worth fixing even when the game is decided.`;
    return null;
  });

  function retry() {
    const n = node.value;
    if (!n) return;
    if (n.mainPly !== null) session.retryPly(n.mainPly);
    else session.retrySide(n);
  }

  /** Show the first i+1 moves of a candidate's line on the board (hover). */
  function previewCandidate(c: Candidate, i = 0) {
    const x = a.value;
    if (!x) return;
    const steps = pvSteps(x.fenBefore, c.pvUci);
    const s = steps[i];
    if (!s) return;
    const line = steps
      .slice(0, i + 1)
      .map((st) => (st.number ? `${st.number} ${st.san}` : st.san))
      .join(' ');
    session.setPreview({ fen: s.fenAfter, uci: s.uci, caption: `Preview: ${line}` });
  }

  /** Play a candidate's line (its first `count` moves) as a side line. */
  function playCandidate(c: Candidate, count = 1) {
    const from = node.value?.parent;
    if (!from) return;
    session.setPreview(null);
    session.playLine(from, c.pvUci, count);
  }

  return { node, a, pending, error, moverIsYou, verdict, points, better, meta, moveName, moverName, evalChange, reason, ruleNote, retry, previewCandidate, playCandidate };
}
