// Shared API + analysis types. Copied verbatim from ARCHITECTURE.md "Shared types" (the contract).
// Change this file only together with ARCHITECTURE.md.

export type Color = 'white' | 'black';
export type Label =
  | 'forced' | 'book' | 'best' | 'great' | 'excellent' | 'good'
  | 'inaccuracy' | 'mistake' | 'miss' | 'blunder';
export interface Score { cp?: number; mate?: number }   // exactly one set; mate>0 = side to move mates

export type PieceRole = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';
export interface PieceRef { role: PieceRole; square: string; color: Color }

// Facts: discriminated union. Data only; `explain.ts` renders text.
export type Fact =
  | { type: 'check'; double?: boolean; discovered?: boolean }
  | { type: 'checkmate'; double?: boolean; discovered?: boolean }
  | { type: 'stalemate' }                                            // the move stalemates the opponent (draw)
  | { type: 'capture'; captured: PieceRef; outcome: 'wins-material' | 'even-trade' | 'recapture' | 'loses-material'; net: number }
  | { type: 'promotion'; to: PieceRole }
  | { type: 'castle'; side: 'king' | 'queen' }
  | { type: 'develop'; piece: PieceRef }
  | { type: 'attack'; attacker: PieceRef; target: PieceRef; reason: 'undefended' | 'higher-value' | 'king' }
  | { type: 'fork'; attacker: PieceRef; targets: PieceRef[] }
  | { type: 'pin'; pinner: PieceRef; pinned: PieceRef; behind: PieceRef; absolute: boolean }
  | { type: 'skewer'; attacker: PieceRef; front: PieceRef; behind: PieceRef }
  | { type: 'discovered-attack'; moved: PieceRef; attacker: PieceRef; target: PieceRef }
  | { type: 'escape'; piece: PieceRef; from: string }               // piece was en prise, now safe
  | { type: 'defend'; defender: PieceRef; piece: PieceRef }          // newly defends an attacked piece
  | { type: 'block-check' } | { type: 'escape-check' }
  | { type: 'hangs'; piece: PieceRef; loss: number; already?: boolean }  // negative: leaves material en prise; already = was en prise before the move and still is
  | { type: 'allows-mate'; inMoves: number }                         // negative
  | { type: 'threat'; move: string; san: string; gain: number; mateIn?: number; facts: Fact[] }
  | { type: 'defends-threat'; move: string; san: string; gain: number; mateIn?: number; facts: Fact[] }  // the opponent's threat (as in 'threat', opponent POV) no longer works after the move
  | { type: 'line'; steps: LineStep[]; materialDelta: number; mateIn?: number; result: 'wins-material' | 'loses-material' | 'mate' | 'mated' | 'trade' | 'quiet'; won?: PieceRole[]; lost?: PieceRole[]; measuredAt?: number }  // won/lost: net pieces gained/lost by the mover; measuredAt: material measured after this many plies (> steps.length)
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

export interface Level { facts: Fact[]; text: string[] }        // text[i] renders facts (not necessarily 1:1)
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
 * `hungLoss` = the hung piece's static-exchange loss (same number as the Immediate 'hangs' fact); `loss` is the
 * line-based comparison with the best move.
 */
export interface MaterialCheck { playedLine: number; bestLine: number; loss: number; evalDropCp: number; label?: Label; hung?: PieceRef; hungLoss?: number; lostInLine?: LostPiece[] }
/** The played move allows a forced mate in `matedIn` moves that the best move avoids (`bestMatedIn`: the best move's own, much longer, forced mate). */
export interface AllowedMate { matedIn: number; bestMatedIn?: number }
/** The mover had a forced mate in `mateIn` moves (the best move) and played a move that doesn't force mate. */
export interface MissedMate { mateIn: number }

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
  labelReason: { winChance: Label; material?: MaterialCheck; miss?: boolean; great?: { secondBestLoss: number }; book?: { eco: string; name: string }; allowedMate?: AllowedMate; missedMate?: MissedMate };
  played: Candidate;                   // the played move as a candidate, with explanation
  best: Candidate;
  pick: Candidate | null;              // explainable pick; null if none
  pickIsBest: boolean;
  deepOnly: boolean;                   // no explainable candidate -> "deep engine move, hard to explain"
  candidates: Candidate[];             // top-5 summary (explanation may be omitted)
  arrows: Arrow[];
  timings?: Record<string, number>;
  labelText?: string;                  // rendered label + reason (explain.ts), mover-neutral
}
export interface Arrow { from: string; to: string; kind: 'pick' | 'best' | 'threat' | 'played' }

export interface GameMove { ply: number; san: string; uci: string; color: Color; fenBefore: string; fenAfter: string }
export interface GameInfo {
  id: string; headers: Record<string, string>; startFen: string; moves: GameMove[];
  you: Color; orientation: Color;
}
export interface SideSummary { accuracy: number | null; counts: Partial<Record<Label, number>> }
export interface GameSummary { white: SideSummary; black: SideSummary; done: number; total: number }

export interface Settings { username: string | null }
