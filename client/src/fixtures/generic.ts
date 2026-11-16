// Mock-only: a plausible generic MoveAnalysis for any legal move, built from chessops (no engine).
// Eval = material balance; label 'good' (or 'forced' when it was the only legal move).
import type { MoveAnalysis, Score, TopMovesResult } from '@chess-coach/shared';
import type { AnalyseRequest } from '../api/types';
import { isCheckmate, legalDests, materialBalance, playUci } from '../lib/chess';
import { assembleAnalysis } from './assemble';
import { boardFacts } from './autoFacts';

export function genericAnalysis(req: AnalyseRequest): MoveAnalysis {
  const played = playUci(req.fenBefore, req.uci);
  if (!played) throw new Error(`Illegal move ${req.uci}`);
  let after: Score = { cp: materialBalance(played.fenAfter) * 100 + (played.color === 'white' ? 15 : -15) };
  if (isCheckmate(played.fenAfter)) after = played.color === 'white' ? { cp: 1000 } : { mate: 0 };
  const facts = boardFacts(req.fenBefore, played.uci, req.prev?.uci);
  const a = assembleAnalysis({
    fenBefore: req.fenBefore,
    san: played.san,
    lines: [{ pv: [played.san], score: after }],
    label: 'good',
    pick: played.san,
    explain: {
      played: {
        immediate: facts.length ? facts : [{ type: 'nothing-notable' }],
        short: [],
        long: [{ type: 'nothing-notable' }],
      },
    },
  });
  // "Show best move": any legal move in the position after it stands in for the engine's best
  const [from, tos] = [...legalDests(played.fenAfter)].find(([, d]) => d.length) ?? [];
  const next = from && tos ? playUci(played.fenAfter, from + tos[0]) : null;
  if (next) a.nextBest = { uci: next.uci, san: next.san };
  return a;
}

/** Win-chance losses of the generic "top moves": one clear best, a close second, then weaker ones. */
const GENERIC_LOSSES = [0, 1, 4, 12, 25];

/** Mock-only "Show best move" arrows: the first legal moves (one per piece where possible), fading. */
export function genericTopMoves(fen: string): TopMovesResult {
  const moves: TopMovesResult['moves'] = [];
  for (const [from, tos] of legalDests(fen)) {
    const to = tos[tos.length - 1];
    const m = to ? playUci(fen, from + to) : null;
    if (!m || moves.length >= GENERIC_LOSSES.length) continue;
    const loss = GENERIC_LOSSES[moves.length]!;
    moves.push({ uci: m.uci, san: m.san, score: { cp: (m.color === 'white' ? 1 : -1) * (30 - loss * 10) }, winLoss: loss, gap: loss });
  }
  return { fen, moves, depth: 14 };
}
