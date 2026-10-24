// Mock-only: a plausible generic MoveAnalysis for any legal move, built from chessops (no engine).
// Eval = material balance; label 'good' (or 'forced' when it was the only legal move).
import type { MoveAnalysis, Score } from '@chess-coach/shared';
import type { AnalyseRequest } from '../api/types';
import { isCheckmate, materialBalance, playUci } from '../lib/chess';
import { assembleAnalysis } from './assemble';
import { boardFacts } from './autoFacts';

export function genericAnalysis(req: AnalyseRequest): MoveAnalysis {
  const played = playUci(req.fenBefore, req.uci);
  if (!played) throw new Error(`Illegal move ${req.uci}`);
  let after: Score = { cp: materialBalance(played.fenAfter) * 100 + (played.color === 'white' ? 15 : -15) };
  if (isCheckmate(played.fenAfter)) after = played.color === 'white' ? { cp: 1000 } : { mate: 0 };
  const facts = boardFacts(req.fenBefore, played.uci, req.prev?.uci);
  return assembleAnalysis({
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
}
