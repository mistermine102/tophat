// PGNs used by the E2E tests (real games, chess.com-style export where noted).

/** chess.com export of Ed. Lasker – Thomas, London 1912 (king hunt, 18. Kd2#), with clocks, a variation and NAGs. */
export const LASKER_CHESSCOM = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.10.21"]
[Round "-"]
[White "EdLasker1912"]
[Black "SirGeorgeThomas"]
[Result "1-0"]
[CurrentPosition "rn3r2/pbppq1p1/1p2pN2/8/3P2NP/6P1/PPPKBP1R/R6k b - - 4 18"]
[Timezone "UTC"]
[ECO "A84"]
[ECOUrl "https://www.chess.com/openings/Dutch-Defense-Classical-Variation"]
[UTCDate "2026.10.21"]
[UTCTime "18:02:11"]
[WhiteElo "1450"]
[BlackElo "1432"]
[TimeControl "600"]
[Termination "EdLasker1912 won by checkmate"]
[StartTime "18:02:11"]
[EndDate "2026.10.21"]
[EndTime "18:09:40"]
[Link "https://www.chess.com/game/live/100000000001"]

1. d4 {[%clk 0:09:58.1]} 1... e6 {[%clk 0:09:57.4]} 2. Nf3 {[%clk 0:09:55.0]} 2... f5 {[%clk 0:09:54.2]}
3. Nc3 {[%clk 0:09:50.3]} 3... Nf6 {[%clk 0:09:51.0]} 4. Bg5 {[%clk 0:09:44.8]} 4... Be7 {[%clk 0:09:46.9]}
5. Bxf6 {[%clk 0:09:40.1]} 5... Bxf6 {[%clk 0:09:44.0]} 6. e4 {[%clk 0:09:31.7]} 6... fxe4 {[%clk 0:09:40.2]}
7. Nxe4 {[%clk 0:09:28.9]} 7... b6 $6 {[%clk 0:09:30.5]} (7... O-O 8. Bd3) 8. Ne5 {[%clk 0:09:15.0]}
8... O-O {[%clk 0:09:25.1]} 9. Bd3 {[%clk 0:09:01.4]} 9... Bb7 {[%clk 0:09:20.8]} 10. Qh5 {[%clk 0:08:50.2]}
10... Qe7 $2 {[%clk 0:09:02.6]} 11. Qxh7+ $3 {[%clk 0:08:21.0]} 11... Kxh7 {[%clk 0:08:58.3]}
12. Nxf6+ {[%clk 0:08:19.8]} 12... Kh6 {[%clk 0:08:50.0]} 13. Neg4+ {[%clk 0:08:15.5]} 13... Kg5 {[%clk 0:08:44.1]}
14. h4+ {[%clk 0:08:10.2]} 14... Kf4 {[%clk 0:08:40.6]} 15. g3+ {[%clk 0:08:05.0]} 15... Kf3 {[%clk 0:08:37.7]}
16. Be2+ {[%clk 0:08:00.1]} 16... Kg2 {[%clk 0:08:33.3]} 17. Rh2+ {[%clk 0:07:55.9]} 17... Kg1 {[%clk 0:08:30.0]}
18. Kd2# {[%clk 0:07:50.4]} 1-0`;

/** chess.com export, Blackburne Shilling trap: 7... Nf3# (14 plies). The user ("SzymonJ") plays Black. */
export const SHILLING_CHESSCOM = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.10.20"]
[Round "-"]
[White "SomeOpponent"]
[Black "SzymonJ"]
[Result "0-1"]
[ECO "C50"]
[WhiteElo "812"]
[BlackElo "845"]
[TimeControl "600"]
[Termination "SzymonJ won by checkmate"]
[Link "https://www.chess.com/game/live/123456789"]

1. e4 {[%clk 0:09:58.5]} 1... e5 {[%clk 0:09:57.1]} 2. Nf3 {[%clk 0:09:55.2]} 2... Nc6 {[%clk 0:09:54.0]}
3. Bc4 {[%clk 0:09:50.9]} 3... Nd4 {[%clk 0:09:49.3]} 4. Nxe5 $2 {[%clk 0:09:45.0]} 4... Qg5 {[%clk 0:09:40.8]}
5. Nxf7 {[%clk 0:09:30.2]} 5... Qxg2 {[%clk 0:09:35.5]} 6. Rf1 {[%clk 0:09:20.0]} (6. Qf3 Qxf3) 6... Qxe4+ {[%clk 0:09:30.1]}
7. Be2 {[%clk 0:09:10.4]} 7... Nf3# {[%clk 0:09:28.0]} 0-1`;

/** Two plies only. */
export const TWO_PLIES = `[Event "Casual"]
[White "Alpha"]
[Black "Beta"]
[Result "*"]

1. e4 e5 *`;

/** Sam Loyd's 10-move stalemate (19 plies, the last move stalemates Black). */
export const STALEMATE = `[Event "Stalemate problem"]
[White "Loyd"]
[Black "Problem"]
[Result "1/2-1/2"]

1. e3 a5 2. Qh5 Ra6 3. Qxa5 h5 4. h4 Rah6 5. Qxc7 f6 6. Qxd7+ Kf7 7. Qxb7 Qd3 8. Qxb8 Qh7 9. Qxc8 Kg6
10. Qe6 1/2-1/2`;

/** Game from a set-up position (SetUp/FEN): Black to move, K+Q vs K, White mates. */
export const FROM_FEN = `[Event "Endgame practice"]
[White "Trainer"]
[Black "Student"]
[Result "1-0"]
[SetUp "1"]
[FEN "7k/8/5K2/8/8/8/8/6Q1 b - - 0 50"]

50... Kh7 51. Qg5 Kh8 52. Qh5+ Kg8 53. Qg6+ Kh8 54. Qg7# 1-0`;

/** M3 mate rule: White is lost (knight vs queen) and 1. a3?? allows 1... Qe1#; h3 / Nd2 / Nc3 avoid the mate. */
export const ALLOWED_MATE = `[Event "Back-rank lesson"]
[White "Learner"]
[Black "Coach"]
[Result "0-1"]
[SetUp "1"]
[FEN "6k1/5ppp/8/q7/8/8/P4PPP/1N4K1 w - - 0 1"]

1. a3 Qe1# 0-1`;

/** Not a chess game. */
export const BAD_ILLEGAL = `[White "a"]
[Black "b"]

1. e4 e5 2. Ke3 *`;

/** A long but legal game (knights out and back, 160 plies) for UI performance checks. */
export function longGame(plies = 160): string {
  const cycle = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nc3', 'Nc6', 'Nb1', 'Nb8'];
  const moves: string[] = [];
  for (let i = 0; i < plies; i++) {
    const san = cycle[i % cycle.length]!;
    moves.push(i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san);
  }
  return `[Event "Long shuffle"]\n[White "Shuffler A"]\n[Black "Shuffler B"]\n[Result "1/2-1/2"]\n\n${moves.join(' ')} 1/2-1/2`;
}
