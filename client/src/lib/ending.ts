// How a game ended (checkmate, resignation, on time …): from chess.com's per-player result codes (game list) or from
// a PGN's Termination header (an opened game), with the final position as a fallback (mate / stalemate on the board).
import { isCheckmate, isStalemate } from './chess';

export type Ending =
  | 'checkmate'
  | 'resignation'
  | 'time'
  | 'abandonment'
  | 'agreement'
  | 'repetition'
  | 'stalemate'
  | 'insufficient'
  | 'fifty'
  | 'timeout-insufficient';

/** Short text that follows "Won" / "Lost" / "Draw". */
export const ENDING_TEXT: Record<Ending, string> = {
  checkmate: 'by checkmate',
  resignation: 'by resignation',
  time: 'on time',
  abandonment: 'by abandonment',
  agreement: 'by agreement',
  repetition: 'by repetition',
  stalemate: 'by stalemate',
  insufficient: 'insufficient material',
  fifty: '50-move rule',
  'timeout-insufficient': 'timeout vs insufficient material',
};

// chess.com result codes: https://www.chess.com/news/view/published-data-api#game-results
const CHESSCOM: Record<string, Ending> = {
  checkmated: 'checkmate',
  resigned: 'resignation',
  timeout: 'time',
  abandoned: 'abandonment',
  agreed: 'agreement',
  repetition: 'repetition',
  stalemate: 'stalemate',
  insufficient: 'insufficient',
  '50move': 'fifty',
  timevsinsufficient: 'timeout-insufficient',
};

/** The ending of a chess.com game from its two result codes (the loser's code, or the draw's). */
export function endingFromChessCom(white: string, black: string): Ending | null {
  const code = white === 'win' ? black : white;
  return CHESSCOM[code] ?? null;
}

/**
 * The ending of a game from its PGN: chess.com's Termination ("X won by resignation", "Game drawn by repetition"),
 * lichess's ("Normal", "Time forfeit"), or the final position when the header says nothing useful.
 */
export function endingFromPgn(termination: string | undefined, result: string | undefined, finalFen: string | null): Ending | null {
  const t = (termination ?? '').toLowerCase();
  // the more specific phrases first ("timeout vs insufficient material" mentions both time and material)
  if (t.includes('timeout vs insufficient')) return 'timeout-insufficient';
  if (t.includes('checkmate')) return 'checkmate';
  if (t.includes('resignation')) return 'resignation';
  if (t.includes('abandon')) return 'abandonment';
  if (t.includes('agreement')) return 'agreement';
  if (t.includes('repetition')) return 'repetition';
  if (t.includes('stalemate')) return 'stalemate';
  if (t.includes('insufficient')) return 'insufficient';
  if (t.includes('50-move') || t.includes('50 move')) return 'fifty';
  if (t.includes('on time') || t.includes('time forfeit')) return 'time';
  if (finalFen && isCheckmate(finalFen)) return 'checkmate';
  if (finalFen && isStalemate(finalFen)) return 'stalemate';
  // lichess "Normal" with a winner and no mate on the board: the loser resigned
  if (t === 'normal' && (result === '1-0' || result === '0-1')) return 'resignation';
  return null;
}

/** How an opened game ended: its Termination header and final position. */
export function gameEnding(game: { headers: Record<string, string>; startFen: string; moves: readonly { fenAfter: string }[] }): Ending | null {
  const finalFen = game.moves[game.moves.length - 1]?.fenAfter ?? game.startFen;
  return endingFromPgn(game.headers.Termination, game.headers.Result, finalFen);
}

/**
 * The ending badge: a short word and its family, one colour each — decided on the board (checkmate, stalemate,
 * repetition …), by a player (resigned, left, agreed a draw) or by the clock.
 */
export const ENDING_BADGE: Record<Ending, { short: string; family: 'board' | 'player' | 'clock' }> = {
  checkmate: { short: 'Checkmate', family: 'board' },
  stalemate: { short: 'Stalemate', family: 'board' },
  repetition: { short: 'Repetition', family: 'board' },
  insufficient: { short: 'No material', family: 'board' },
  fifty: { short: '50 moves', family: 'board' },
  resignation: { short: 'Resign', family: 'player' },
  abandonment: { short: 'Abandon', family: 'player' },
  agreement: { short: 'Agreed', family: 'player' },
  time: { short: 'Time', family: 'clock' },
  'timeout-insufficient': { short: 'Time', family: 'clock' },
};
