// Game summary computed from the analyses that have arrived so far (used by the mock server and as the client's
// fallback while the server hasn't sent a `summary` event yet).
import type { Color, GameInfo, GameSummary, Label, MoveAnalysis, Score, SideSummary } from '@chess-coach/shared';
import { gameAccuracyFromScores } from '@chess-coach/shared';

export type AnalysisMap = Readonly<Record<number, MoveAnalysis | undefined>>;

export function computeSummary(game: Pick<GameInfo, 'moves'>, analyses: AnalysisMap): GameSummary {
  const white: SideSummary = { accuracy: null, counts: {} };
  const black: SideSummary = { accuracy: null, counts: {} };
  const moves = game.moves;
  let done = 0;
  // White-POV evals of every position incl. the start position; null = not analysed yet.
  const scores: (Score | null)[] = [analyses[1]?.evalBefore ?? null];
  for (const m of moves) {
    const a = analyses[m.ply];
    if (a) {
      done++;
      const side = a.color === 'white' ? white : black;
      side.counts[a.label] = (side.counts[a.label] ?? 0) + 1;
    }
    // A position's eval is known if this move was analysed (evalAfter) or the next one was (evalBefore).
    scores.push(a?.evalAfter ?? analyses[m.ply + 1]?.evalBefore ?? null);
  }
  const startColor: Color = moves[0]?.color ?? 'white';
  if (done > 0) {
    const acc = gameAccuracyFromScores(scores, startColor);
    white.accuracy = acc.white;
    black.accuracy = acc.black;
  }
  return { white, black, done, total: moves.length };
}

export function countOf(side: SideSummary, label: Label): number {
  return side.counts[label] ?? 0;
}
