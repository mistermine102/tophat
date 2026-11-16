// Shared API + analysis types. Copied verbatim from ARCHITECTURE.md "Shared types" (the contract).
// Change this file only together with ARCHITECTURE.md.

export type Color = 'white' | 'black';
export type Label =
  | 'forced' | 'book' | 'brilliant' | 'best' | 'great' | 'excellent' | 'good'
  | 'inaccuracy' | 'mistake' | 'miss' | 'blunder';
export interface Score { cp?: number; mate?: number }   // exactly one set; mate>0 = side to move mates

export type PieceRole = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';
export interface PieceRef { role: PieceRole; square: string; color: Color }

// Facts: discriminated union. Data only; `explain.ts` renders text.
export type Fact =
  | { type: 'check'; double?: boolean; discovered?: boolean }
  | { type: 'checkmate'; double?: boolean; discovered?: boolean }
  | { type: 'stalemate' }                                            // the move stalemates the opponent (draw)
  | { type: 'capture'; captured: PieceRef; outcome: 'wins-material' | 'even-trade' | 'recapture' | 'loses-material'; net: number; desperado?: boolean }  // desperado (M5b): the capturing piece was en prise with no safe square anyway
  | { type: 'promotion'; to: PieceRole }
  | { type: 'castle'; side: 'king' | 'queen' }
  | { type: 'develop'; piece: PieceRef }
  | { type: 'attack'; attacker: PieceRef; target: PieceRef; reason: 'undefended' | 'higher-value' | 'king' | 'outnumbered'; offered?: boolean; through?: PieceRef }  // through (M5c): a battery — the moved slider lines up behind its own slider on this piece, which attacks the target; outnumbered (M5b): the move adds the attacker that makes the piece winnable; offered (M5b): the target could take the attacker (kept only when the engine line doesn't)
  | { type: 'fork'; attacker: PieceRef; targets: PieceRef[]; followUp?: { reply: string; capture: string; kingMustMove?: boolean }; byLine?: boolean }  // byLine (M5c): a pawn fork the board-only test can't confirm (the pawn can be taken), kept only where the engine line converts it; followUp (M5b): a checking fork shown by the engine line — the reply (SAN), then the forking piece's capture (SAN); kingMustMove: every legal reply is a king move
  | { type: 'pin'; pinner: PieceRef; pinned: PieceRef; behind: PieceRef; absolute: boolean }
  | { type: 'skewer'; attacker: PieceRef; front: PieceRef; behind: PieceRef }
  | { type: 'discovered-attack'; moved: PieceRef; attacker: PieceRef; target: PieceRef }
  | { type: 'escape'; piece: PieceRef; from: string }               // piece was en prise, now safe
  | { type: 'defend'; defender: PieceRef; piece: PieceRef }          // newly defends an attacked piece
  | { type: 'block-check' } | { type: 'escape-check' }
  | { type: 'hangs'; piece: PieceRef; loss: number; already?: boolean }  // negative: leaves material en prise; already = was en prise before the move and still is
  | { type: 'allows-mate'; inMoves: number; line?: string[] }        // negative; line (M5b): the mating sequence from the opponent's reply (SAN, ends in checkmate on the board)
  | { type: 'misses-mate'; mateIn: number; best: string; line: string[] }  // negative (M5b): the mover had a forced mate (the best move's line, SAN from the best move, ends in checkmate) and the move doesn't mate
  | { type: 'misses'; san: string; uci: string; facts: Fact[]; partial?: boolean; free?: PieceRef; alsoStops?: string; fine?: string[] }       // fine (Why round): SAN of other moves about as good as the best one (the played move is the odd one out); free (B1): the move wins this opponent piece for free (labelReason.missedMaterial); alsoStops (B1): SAN of the threat the played move parried, which the move stops too (the threat move is illegal after it); partial (M5c): the verified reasons are small next to the eval drop (the text adds 'the engine sees more than this'). M5b, bad moves whose Immediate level says nothing else: the engine's best move and its verified facts this move doesn't share (empty facts = no reason in words was found)
  | { type: 'castling-lost'; color: Color; sides: ('king' | 'queen')[]; at?: 'line-end' }  // M5b: `color` loses its last castling rights (king or rook moved; at 'line-end': its king was driven out during the short line)
  | { type: 'attack-pinned'; attacker: PieceRef; pinned: PieceRef; pinner: PieceRef; behind: PieceRef; absolute: boolean }  // M5b: the move adds an attacker to an enemy piece that was already pinned, and the piece can now be won
  | { type: 'trapped'; piece: PieceRef; attacker: PieceRef }       // M5b: an enemy piece is attacked, can be won, and every square it can move to loses it too (confirmed by the engine line winning it)
  | { type: 'prevents'; move: string; san: string; square: string; reason: 'occupied' | 'blocked' | 'covered'; by?: PieceRef }  // M5b prophylaxis: the opponent's best idea (null-move search: what they'd play if the mover passed, worth >= 1.5 pawns more than their best reply now) is no longer playable (square occupied / line blocked) or now loses material on `square` (covered by `by`)
  | { type: 'threat'; move: string; san: string; gain: number; mateIn?: number; facts: Fact[] }
  | { type: 'defends-threat'; move: string; san: string; gain: number; mateIn?: number; facts: Fact[] }  // the opponent's threat (as in 'threat', opponent POV) no longer works after the move
  | { type: 'line'; steps: LineStep[]; materialDelta: number; mateIn?: number; result: 'wins-material' | 'loses-material' | 'mate' | 'mated' | 'trade' | 'quiet' | 'unclear'; won?: PieceRole[]; lost?: PieceRole[]; measuredAt?: number; balance?: number; owed?: number; nextForcing?: string; recapture?: string; draw?: 'perpetual' | 'repetition'; drawBy?: Color }  // draw/drawBy (M5c): the narrated line repeats a position and the engine scores it as a draw (perpetual: every move of drawBy in the cycle is a check); recapture (M5b): SAN of the PV's next move, a recapture already counted in the material result; nextForcing (M5b): SAN of the PV moves right after the narrated steps up to the first check or capture within 3 plies; won/lost: net pieces gained/lost by the mover; measuredAt: material measured after this many plies (> steps.length); 'unclear' = material still changing where the line ends (no result is claimed); balance: mover's material balance (points) at the line end (material results only); owed: material the opponent's previous move captured, which the line may be winning back
  | { type: 'allows'; reply: { san: string; uci: string }; facts: Fact[]; targets?: PieceRef[]; gain?: number; mateIn?: number; already?: boolean; mateLine?: string[]; keepsThreat?: boolean; threatParried?: boolean; follow?: string; perpetual?: boolean; followFact?: Fact }  // followFact (feedback round 3): the fork / skewer / discovered attack / winning capture of the follow move; perpetual (M5c): the line is a draw by perpetual check given by the opponent; threatParried (M5c): the reply's threat is not carried out in the line, which still costs the mover gain points (the threat is why); follow (M5c): SAN of the opponent's first forcing move later in the line, for a quiet reply whose line costs material; keepsThreat (M5b): the reply's threat is the opponent's threat from before the move, playable right after it ("Doesn't deal with …"). mateLine (M5b): SAN from the reply to the checkmate, verified on the board. negative (bad moves): the opponent's best reply from the move's PV and what it does — its board facts / verified threat, mover pieces it newly puts en prise, material the opponent gains in the line (pawns), mate against the mover; already: the reply worked before the move too (the move just doesn't deal with it)
  | { type: 'loosens'; moved: PieceRef; target: PieceRef; undefended?: boolean; attacker: PieceRef; route: string[]; answer?: { san: string; how: 'king' | 'defends' | 'moves-away' }; castlingLost?: boolean; won?: boolean }  // (Why round) negative, played bad move: the move takes its protection away from the mover's target (moved = the piece as it stood before the move; undefended = nothing defends it any more), and the move's engine line goes after it — the opponent's attacker (on the square it attacks from) gets there by route (SAN of that piece's moves in the line); answer = the mover's reply in the line (a king walk that gives up castling, a piece that defends it, or the target stepping away); won = the line then takes it and the mover ends material down
  | { type: 'chased'; piece: PieceRef; hits: { attack: string; retreat: string }[] }  // (Feedback round 3) negative, played bad move: the moved piece (piece = where it lands) is hit by cheaper opponent pieces in the move's engine line and has to step away again (hits = SAN of each attack and the mover's retreat), so the opponent gains time
  | { type: 'passer'; pawn: PieceRef; promotes?: boolean; line: string[] }  // (Feedback round 3) negative, played bad move: its engine line lets an opponent passed pawn reach the square before promotion (pawn = where it lands; promotes = it queens), which the best move's line doesn't; line = SAN of the PV after the move up to that pawn move
  | { type: 'undeveloped'; home: number; moves: string[] }  // (Feedback round 3) negative, played bad move in the opening: it brings no piece out while home (>= 2) of the mover's knights and bishops are still on their starting squares, and moves (SAN) that were better do develop one
  | { type: 'trades-down'; trade: 'queens' | 'pieces'; ending: 'pawn' | 'other'; verdict: 'lost' | 'draw' | 'worse'; line: string[] }  // (Why round) negative, played bad move: its engine line trades off (the queens / pieces down to a pawn ending) within a few plies, material level, and the ending is lost / only a draw / clearly worse than the position the best move keeps; line = SAN of the trade
  | { type: 'forced-reply'; san: string; alternatives: number }      // opponent's reply was (nearly) the only move
  | { type: 'positional'; feature: PositionalFeature; delta: number; detail?: string; side?: 'own' | 'opponent'; squares?: string[]; at?: 'line-end' }  // delta: + = good for mover; side: whose pieces changed; at: 'line-end' = change measured at the end of the short line, not right after the move
  | { type: 'positional-gain'; cp: number }                          // eval gain not explained by material
  | { type: 'deep-payoff' }                                          // only deep search likes it
  | { type: 'necessary'; onlyMove?: boolean }                        // all alternatives much worse (onlyMove: the only legal move)
  | { type: 'nothing-notable' };

export type PositionalFeature =
  | 'king-safety' | 'passed-pawn' | 'isolated-pawn' | 'doubled-pawn' | 'mobility'
  | 'centre-control' | 'development' | 'open-file-rook' | 'bishop-pair' | 'space';

export interface LineStep { ply: number; san: string; uci: string; color: Color; facts: Fact[]; forced?: boolean }

/** (UI round) Whether a sentence is good, bad or neutral FOR THE MOVER (the side that played the move). */
export type Tone = 'good' | 'bad' | 'neutral';
/** (UI round) One part of the Short-term story; `text[0]` = the parts' texts joined with ' → ' plus a final '.'. */
export interface StoryPart {
  text: string;
  tone: Tone;
  /** 0-based indexes [from, to] into the line fact's `steps` that this part narrates (absent for '…' and the result). */
  plies?: [number, number];
}
export interface Level {
  facts: Fact[];
  text: string[];        // text[i] renders facts (not necessarily 1:1)
  tones?: Tone[];        // (UI round) parallel to text: tones[i] = tone of text[i] for the mover
  story?: StoryPart[];   // (UI round) Short-term level of a narrated line only: text[0] split into its steps
}
export interface Explanation { immediate: Level; short: Level; long: Level }

export interface Candidate {
  uci: string; san: string;
  rank: number;                       // 1-based engine rank (deep); 0 = the played move when it isn't among the deep lines
  score: Score;                       // White POV
  winLoss: number;                    // mover POV, vs best
  pv: string[];                       // SAN
  pvUci: string[];
  explainable: boolean;
  notExplainableReasons?: string[];   // machine-readable codes, 'too-much-loss','material-rule','hangs-material','loses-result','shallow-disagrees','no-concrete-fact'
  explanation?: Explanation;          // present for played move, pick and best
}

/** A mover's piece lost in the engine line: captured on `square` at line ply `ply` (1 = the move itself, 2 = the opponent's reply, ...). */
export interface LostPiece extends PieceRef { ply: number }
/**
 * Material rule data (classify.ts materialCheck). `hung` = a mover's piece that is en prise right after the move
 * (on that square) and is lost in the line; `lostInLine` = the mover's pieces lost in losing exchanges of the line
 * (first = first lost), also when the piece only becomes loose later in the line (then `hung` is absent).
 * `hungAlready` = the hung piece was already en prise before the move (the move didn't save it).
 * `hungLoss` = the hung piece's static-exchange loss (same number as the Immediate 'hangs' fact); `loss` is the
 * line-based comparison with the best move.
 */
export interface MaterialCheck { playedLine: number; bestLine: number; loss: number; evalDropCp: number; label?: Label; hung?: PieceRef; hungLoss?: number; hungAlready?: boolean; lostInLine?: LostPiece[] }
/** The played move allows a forced mate in `matedIn` moves that the best move avoids (`bestMatedIn`: the best move's own, much longer, forced mate). */
export interface AllowedMate { matedIn: number; bestMatedIn?: number }
/** The mover had a forced mate in `mateIn` moves (the best move) and played a move that doesn't force mate. */
export interface MissedMate { mateIn: number }
/** (B1) The best move wins `gain` points of material for free (quiet-point material of its line) and the played move doesn't; `piece` = the opponent's piece the best move captures. */
export interface MissedMaterial { gain: number; piece: PieceRef; free?: boolean }  // free: the capture loses nothing back (static exchange = the piece's full value)
/** (B2) The played move gives up `sacrifice` points of material (quiet-point material of its line) and the position stays good; `piece` = the mover's piece left en prise. */
export interface BrilliantSacrifice { sacrifice: number; piece: PieceRef }

export interface MoveAnalysis {
  version: number;
  fenBefore: string; fenAfter: string;
  uci: string; san: string;
  color: Color;                        // mover
  evalBefore: Score; evalAfter: Score; // White POV
  winBefore: number; winAfter: number; // mover POV, %
  winLoss: number;
  accuracy: number;                    // per-move accuracy %
  label: Label;
  labelReason: { winChance: Label; material?: MaterialCheck; miss?: boolean; great?: { secondBestLoss: number }; book?: { eco: string; name: string }; allowedMate?: AllowedMate; missedMate?: MissedMate; missedMaterial?: MissedMaterial; brilliant?: BrilliantSacrifice; missedChance?: boolean };
  played: Candidate;                   // the played move as a candidate, with explanation
  best: Candidate;
  pick: Candidate | null;              // explainable pick; null if none
  pickIsBest: boolean;
  deepOnly: boolean;                   // no explainable candidate -> "deep engine move, hard to explain"
  candidates: Candidate[];             // top-5 summary (explanation may be omitted)
  arrows: Arrow[];
  timings?: Record<string, number>;
  labelText?: string;                  // rendered label + reason (explain.ts), mover-neutral
  verdictText?: string;                // caption for confirmed moves (Book/Forced/Brilliant/Best/Great), e.g. "Opening theory."
  provisional?: boolean;               // (fast feedback, D1) a quick result (light search, no explanations); the full analysis replaces it
  nextBest?: { uci: string; san: string };  // (Why round) the engine's best move in the position after this move (the deep search for evalAfter), for the "Show best move" toggle; absent when the game is over
  points?: { played: MoveIdea; best?: MoveIdea };  // (Points) what the played move does as short points (analysis/movePoints.ts); `best` = the best move's when it wasn't played, and then `played` is compared with it (like = 0: the same idea, told by its differences)
  nextTop?: { uci: string; san: string }[];  // (feedback round 3) the engine's top moves (up to 3, best first) in the position after this move, from the same search as nextBest; the "Show best move" fallback when no top-moves search is available
}
/**
 * (Engine arrows) One of the engine's good moves in a position, for the "Show best move" arrows: its score (White POV)
 * and how much win chance it gives up against the best move (side to move POV, 0 for the best). `gap`: how much worse
 * than the best it is drawn (win% loss, or the centipawn loss in win% terms when larger: analysis/topMoves.ts).
 */
/**
 * One of the engine's top moves. (Brilliant lines) `brilliant`: the move is a sound sacrifice by the Brilliant !! rule
 * (classify.ts `brilliantSacrifice`); `extra`: a brilliant move from outside the regular list, appended after it.
 */
export interface TopMove { uci: string; san: string; score: Score; winLoss: number; gap: number; brilliant?: BrilliantSacrifice; extra?: boolean }
/** The engine's top moves in `fen`, best first (analysis/topMoves.ts picks how many). Empty when the game is over. */
export interface TopMovesResult { fen: string; moves: TopMove[]; depth: number }
/**
 * (Points) One short point about what a move does ("Develops the knight", "Attacks the bishop on c5"), checked on the
 * board or against the move's engine line (analysis/movePoints.ts). `key` names what the point is about, so two moves
 * with the same key make the same point ('develop', 'attack:c5'); `tone` is for the side that plays the move.
 */
export interface MovePoint { key: string; text: string; tone: Tone; squares?: string[] }
/**
 * (Points) What one of the engine's top moves does. A move with the same idea as a better one (`like`: its index in
 * the list) is told by how it differs: `plus` = what it has or avoids that the better move doesn't, `minus` = what it
 * lacks or spoils (both empty = the same idea, just a little less precise). `plan` = the mover's next moves in the
 * engine line (SAN), when the move has at most one point of its own.
 */
export interface MoveIdea { uci: string; san: string; points: MovePoint[]; like?: number; plus?: MovePoint[]; minus?: MovePoint[]; plan?: string[] }
/** (Points) The points of the top moves in `fen`, in the order of TopMovesResult.moves. */
export interface TopIdeasResult { fen: string; moves: MoveIdea[] }
export interface Arrow { from: string; to: string; kind: 'pick' | 'best' | 'threat' | 'played' }

export interface GameMove { ply: number; san: string; uci: string; color: Color; fenBefore: string; fenAfter: string }
export interface GameInfo {
  id: string; headers: Record<string, string>; startFen: string; moves: GameMove[];
  you: Color; orientation: Color;
}
export interface SideSummary { accuracy: number | null; counts: Partial<Record<Label, number>> }
export interface GameSummary { white: SideSummary; black: SideSummary; done: number; total: number }

export interface Settings { username: string | null }

/** A finished game from chess.com's public archives (GET /api/chesscom/:username/games). */
export interface ChessComPlayer { username: string; rating: number | null; result: string }
export interface ChessComGame {
  url: string;
  pgn: string;
  /** Unix seconds. */
  endTime: number;
  timeClass: string;   // bullet | blitz | rapid | daily
  timeControl: string; // "600", "180+2", "1/86400"
  rated: boolean;
  white: ChessComPlayer;
  black: ChessComPlayer;
}
export interface ChessComGames { username: string; games: ChessComGame[] }
