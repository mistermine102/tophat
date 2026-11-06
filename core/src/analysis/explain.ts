// The ONLY place that produces prose. Facts (data) -> short, plain English for a beginner.
//
// Rules
//  - Mover-neutral: the same text is shown for both sides' moves, so it names colours ("Attacks Black's queen"),
//    never "you". The subject of an Immediate sentence is the move itself ("Wins…", "Leaves…").
//  - Nothing is stated that isn't in the facts (piece names, squares, numbers all come from fact fields).
//  - (round 10) Immediate sentences carry no point counts: the piece is named ("Wins Black's bishop on f5"), else
//    the amount is told in words (`material`: "a pawn", "material", "a lot of material"). At most one dash per
//    sentence (the UI prefixes "Label — "), and nothing that only says the reason can't be told.
//  - Short-term story material numbers are points from the mover's point of view (pawn = 1, knight/bishop = 3,
//    rook = 5, queen = 9): "(+3 points)" = the mover gains 3, "(−1 point)" = loses one.
//  - Short sentences; jargon gets a short hint the first time it appears in a sentence ("the exchange (a rook
//    for a knight)", "a passed pawn (no enemy pawn stands in its way)").
//  - Immediate: for a bad move (Inaccuracy / Mistake / Blunder / Miss) the refutation ('allows': the opponent's
//    best reply and what it does) comes first. Each level is deduplicated (check implied by a fork/skewer on the
//    king, attacks already covered by a fork / pin / skewer / discovered attack, several attacks by one piece
//    merged, a hang merged with the reply that takes the piece) and capped at MAX_SENTENCES.
//  - Short term: a story, not a move list — at most MAX_SHOWN_STEPS steps; steps without notable facts in the
//    middle are compressed to "…"; the result is claimed only when the line ends at a quiet point ('unclear'
//    lines claim nothing); "material stays level" at most once.
//  - Long term: at most MAX_LONG_SENTENCES sentences (longterm.ts already keeps only meaningful changes).
//  - `Level.facts` keeps every fact of the level (structured data for a later rephrasing step); `Level.text`
//    holds the rendered sentences (not 1:1 with the facts).
//  - (UI round) `Level.tones[i]` says whether `text[i]` is good / bad / neutral for the mover: the tone of the fact
//    behind the sentence (`factTone`, shared/src/tones.ts) unless the sentence words it otherwise (a hang that is a
//    sound sacrifice = good, a capture whose gain the line gives back = neutral, …). For a bad move the Immediate
//    sentences are ordered bad → neutral → good before they are capped. The Short-term story also comes split
//    into its steps (`Level.story`), each with a tone (the mover's tactic = good, the opponent's = bad).

import type { AnalysisSettings, Color, Explanation, Fact, Label, Level, LineStep, MaterialCheck, MoveAnalysis, PieceRef, PieceRole, Score, StoryPart, Tone } from '@chess-coach/shared';
import { BAD_MOVE_TONE_ORDER, factTone, lineTone } from '@chess-coach/shared';
import { parseSquare } from 'chessops/util';
import { PIECE_VALUES, positionFromFen } from '../chess/material';
import { hangingLoss } from '../chess/see';

export const MAX_SENTENCES = 4;
export const MAX_SHOWN_STEPS = 6;
export const MAX_LONG_SENTENCES = 2;

/** Labels whose explanation leads with the refutation ('allows'). */
export const BAD_LABELS: ReadonlySet<Label> = new Set<Label>(['inaccuracy', 'mistake', 'blunder', 'miss']);

export interface ExplainContext {
  /** The side that played the move being explained. */
  mover: Color;
  /** The move's label (played move only): bad labels lead with the refutation; Book keeps the short level brief. */
  label?: Label;
  /** The move (UCI): tells a pin made by the moving piece from one it uncovers. */
  uci?: string;
  /** (M5c) Played bad move: the eval drop vs the best move (pawns, no mates involved) for the honest hedge. */
  hedge?: { dropPawns: number; bestSan: string };
}

type F<T extends Fact['type']> = Extract<Fact, { type: T }>;

// --- small helpers ----------------------------------------------------------------------------------------------

const MINUS = '−';
export const colorName = (c: Color): string => (c === 'white' ? 'White' : 'Black');
const other = (c: Color): Color => (c === 'white' ? 'black' : 'white');
const an = (word: string): string => (/^[aeiou]/.test(word) ? `an ${word}` : `a ${word}`);

/** Signed pawn units: +3, −2, 0. */
export function signed(n: number): string {
  const r = Math.round(n * 10) / 10;
  if (r > 0) return `+${r}`;
  if (r < 0) return `${MINUS}${-r}`;
  return '0';
}

/** Signed material in points: "+1 point", "−3 points". */
export function points(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${signed(r)} ${Math.abs(r) === 1 ? 'point' : 'points'}`;
}

/**
 * An amount of material (pawns, either sign) in words for a beginner: "a pawn", "material", "a lot of material".
 * The amount alone doesn't say which pieces (3 can be three pawns), so only a single pawn is named.
 */
export function material(n: number): string {
  const r = Math.round(Math.abs(n));
  if (r <= 1) return 'a pawn';
  return r >= 5 ? 'a lot of material' : 'material';
}

/** "a, b and c" */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "Black's knight on f6" */
const owned = (p: PieceRef): string => `${colorName(p.color)}'s ${p.role} on ${p.square}`;
/** "the knight on f6" */
const the = (p: PieceRef): string => `the ${p.role} on ${p.square}`;

/** White-POV score for display: +1.2, −0.5, #3 (White mates), #−3 (Black mates). */
export function formatEval(score: Score): string {
  if (score.mate !== undefined) return score.mate === 0 ? '#' : score.mate > 0 ? `#${score.mate}` : `#${MINUS}${-score.mate}`;
  const cp = score.cp ?? 0;
  const v = (cp / 100).toFixed(1);
  return cp > 0 ? `+${v}` : cp < 0 ? `${MINUS}${v.slice(1)}` : '0.0';
}

/** (M5c) A pinned piece that moves along the pin line (a queen or rook on a file/rank, a queen or bishop on a diagonal). */
function slidesAlong(pinned: PieceRef, pinner: PieceRef): boolean {
  const straight = pinned.square[0] === pinner.square[0] || pinned.square[1] === pinner.square[1];
  return pinned.role === 'queen' || (straight ? pinned.role === 'rook' : pinned.role === 'bishop');
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** "Black's pawns on b7 and f7", "White's knight on e5 and pawn on d4" (pieces of one colour). */
function piecesOn(targets: readonly PieceRef[]): string {
  const color = targets[0]?.color ?? 'black';
  const roles = new Set(targets.map((t) => t.role));
  if (roles.size === 1 && targets.length > 1) return `${colorName(color)}'s ${targets[0]!.role}s on ${joinList(targets.map((t) => t.square))}`;
  return `${colorName(color)}'s ${joinList(targets.map((t) => `${t.role} on ${t.square}`))}`;
}

// --- Immediate ----------------------------------------------------------------------------------------------------

const IMMEDIATE_ORDER: readonly Fact['type'][] = [
  'checkmate', 'stalemate', 'misses-mate', 'allows', 'allows-mate', 'hangs', 'fork', 'trapped', 'skewer', 'discovered-attack', 'pin', 'attack-pinned',
  'capture', 'promotion', 'check', 'defends-threat', 'prevents', 'threat', 'attack', 'escape', 'defend', 'escape-check', 'block-check', 'castle',
  'castling-lost', 'develop',
];

/** (M5c) A move of `color` named on its own: Black's moves get the "…" prefix (…d5), so they aren't read as the other side's. */
const moveName = (san: string, color: Color): string => (color === 'black' ? `…${san}` : san);

/** "Qb8+ Nxb8 Rd8#" */
const sanLine = (sans: readonly string[]): string => sans.join(' ');

/** "a forced mate in 2: Qb8+ Nxb8 Rd8#" / "checkmate: Rd8#" (the line ends in mate on the board). */
function mateLinePhrase(n: number, line: readonly string[]): string {
  return n <= 1 || line.length <= 1 ? `checkmate: ${sanLine(line)}` : `a forced mate in ${n}: ${sanLine(line)}`;
}

function targetsPhrase(targets: readonly PieceRef[]): string {
  // "Black's king on e8 and rook on a8", "White's knights on c3 and e3" (targets of one colour)
  return piecesOn(targets);
}

function captureText(f: F<'capture'>): string {
  const c = owned(f.captured);
  switch (f.outcome) {
    case 'wins-material':
      return f.net >= PIECE_VALUES[f.captured.role]
        ? `Wins ${c}` // (no "for free": SEE can win a defended pawn too)
        : `Takes ${c} and comes out ahead in the trade`;
    case 'even-trade':
      return `Takes ${c}, an even trade`;
    case 'recapture':
      return `Takes back ${c}`;
    case 'loses-material':
      if (f.desperado) return `Takes ${c} as a desperado: the capturing piece was attacked and had no safe square, so it takes something before it is lost`;
      return `Takes ${c}, but loses material in the trade`;
  }
}

/** What a threat does: verb phrase in -ing form or base form ("forking …" / "fork …"), with the gain. */
function threatPoint(f: { gain: number; facts: readonly Fact[] }, form: 'ing' | 'base'): string {
  const v = (ing: string, base: string) => (form === 'ing' ? ing : base);
  const tactic = f.facts.find((x) => x.type === 'fork' || x.type === 'skewer' || x.type === 'discovered-attack');
  const promo = f.facts.find((x): x is F<'promotion'> => x.type === 'promotion');
  if (promo && !tactic) return `${v('promoting', 'promote')} the pawn to ${an(promo.to)}`;
  // a capture that wins the piece outright is the point, even if it also forks (Qxa1+ wins the rook)
  const won = f.facts.find((x): x is F<'capture'> => x.type === 'capture');
  if (won && tactic?.type !== 'discovered-attack' && f.gain === PIECE_VALUES[won.captured.role] && won.net >= PIECE_VALUES[won.captured.role]) return `${v('winning', 'win')} ${an(won.captured.role)}`;
  if (tactic?.type === 'fork') return `${v('forking', 'fork')} ${targetsPhrase(tactic.targets)}`;
  if (tactic?.type === 'skewer') return `${v('skewering', 'skewer')} ${owned(tactic.front)}`;
  if (tactic?.type === 'discovered-attack') return `${v('uncovering', 'uncover')} an attack on ${owned(tactic.target)}`;
  const cap = f.facts.find((x): x is F<'capture'> => x.type === 'capture');
  if (cap && f.gain === PIECE_VALUES[cap.captured.role]) return `${v('winning', 'win')} ${an(cap.captured.role)}`;
  return `${v('winning', 'win')} ${f.gain >= 5 ? 'a lot of material' : 'material'}`;
}

function threatText(f: F<'threat'>): string {
  if (f.mateIn !== undefined && f.mateIn > 0) {
    if (f.mateIn === 1) return `Threatens checkmate with ${f.san}`;
    return `Threatens a forced mate in ${f.mateIn}, starting with ${f.san}`;
  }
  return `Threatens ${f.san}, ${threatPoint(f, 'ing')}`;
}

function defendsText(f: F<'defends-threat'>, ctx: ExplainContext): string {
  const opp = colorName(other(ctx.mover));
  if (f.mateIn !== undefined && f.mateIn > 0) {
    if (f.mateIn === 1) return `Stops ${opp}'s threat of checkmate with ${f.san}`;
    return `Stops ${opp}'s mating attack (it would start with ${f.san})`;
  }
  return `Stops ${opp}'s threat ${f.san}, which would ${threatPoint(f, 'base')}`;
}

/** The refutation: "Allows Qb3, attacking Black's pawns on b7 and f7 at once". `hung`: merged hang, if any. */
export function allowsText(f: F<'allows'>, ctx: ExplainContext): string {
  const r = f.reply.san;
  const opp = colorName(other(ctx.mover));
  const me = colorName(ctx.mover);
  // the reply worked before the move too: the move simply doesn't deal with it
  const verb = f.already ? "Doesn't stop" : 'Allows';
  if (f.facts.some((x) => x.type === 'checkmate')) return `${verb} checkmate: ${r}`;
  // a short forced mate: the moves themselves (verified to end in checkmate on the board)
  if (f.mateLine?.length && f.mateIn !== undefined) return `${verb} ${mateLinePhrase(f.mateIn, f.mateLine)}`;
  // what the reply's own piece does …
  const direct: string[] = [];
  const cap = f.facts.find((x): x is F<'capture'> => x.type === 'capture');
  const tactic = f.facts.find((x) => x.type === 'fork' || x.type === 'skewer' || x.type === 'discovered-attack' || x.type === 'pin');
  if (tactic?.type === 'fork') direct.push(`forking ${targetsPhrase(tactic.targets)}`);
  else if (tactic?.type === 'skewer') direct.push(`skewering ${owned(tactic.front)} (when it moves, ${the(tactic.behind)} can be taken)`);
  else if (tactic?.type === 'discovered-attack') direct.push(`uncovering an attack on ${owned(tactic.target)}`);
  else if (tactic?.type === 'pin' && tactic.pinner.square !== f.reply.uci.slice(2, 4)) direct.push(`uncovering a pin by ${the(tactic.pinner)} on ${owned(tactic.pinned)}`);
  else if (tactic?.type === 'pin') direct.push(tactic.absolute ? `pinning ${owned(tactic.pinned)} to the king` : `pinning ${owned(tactic.pinned)} to the ${tactic.behind.role} behind it`);
  if (cap) direct.push(`winning ${owned(cap.captured)}`);
  // … and what it leaves the mover facing (the attackers may be other pieces: told as a situation, not as the
  // reply piece's attack)
  const then: string[] = [];
  const threat = f.facts.find((x): x is F<'threat'> => x.type === 'threat');
  // (M5b) pieces a fork already names are not repeated as "both under attack"
  const forked = new Set(tactic?.type === 'fork' ? tactic.targets.map((t) => t.square) : []);
  const targets = (f.targets ?? []).filter((t) => !forked.has(t.square));
  const threatOnTarget = !!threat && !threat.mateIn && targets.some((t) => t.square === threat.move.slice(2, 4));
  if (targets.length >= 2) then.push(`${piecesOn(targets)} are both under attack`);
  else if (targets.length === 1 && !threatOnTarget) then.push(`${owned(targets[0]!)} is under attack`);
  // (M5c) a threat to take a piece the fork already names is the fork itself
  const threatOnForked = !!threat && !threat.mateIn && forked.has(threat.move.slice(2, 4));
  if (threat) {
    if (threat.mateIn === 1) then.push(`${opp} threatens checkmate with ${threat.san}`);
    else if (threat.mateIn) then.push(`${opp} threatens a forced mate starting with ${threat.san}`);
    else if (!(targets.length >= 2 && threatOnTarget) && !threatOnForked) then.push(`${opp} threatens ${threat.san}, ${threatPoint(threat, 'ing')}`);
  }
  const check = f.facts.some((x) => x.type === 'check') ? ' (check)' : '';
  // (M5b) the reply only keeps a threat that was there before the move: name the threat, not the reply (Kh2)
  if (f.keepsThreat && !direct.length && threat && targets.every((t) => t.square === threat.move.slice(2, 4))) {
    if (threat.mateIn === 1) return `Doesn't deal with ${opp}'s threat of checkmate with ${threat.san}`;
    if (threat.mateIn) return `Doesn't deal with ${opp}'s mating attack (starting with ${threat.san})`;
    const parried = f.threatParried && (f.gain ?? 0) >= 1 ? `; ${me} can avoid that but still loses ${material(f.gain!)}` : '';
    return `Doesn't deal with ${opp}'s threat ${threat.san}, ${threatPoint(threat, 'ing')}${parried}`;
  }
  const cost = (f.gain ?? 0) >= 1 ? material(f.gain!) : '';
  // (M5c) a perpetual check by the opponent is the point
  if (f.perpetual && !direct.length && !then.length && f.mateIn === undefined) return `${verb} ${r}${check}: ${opp} can then force a draw by perpetual check`;
  // a quiet reply whose line costs material (M5b): the reply isn't the tactic itself — say where the loss is told
  // (M5c: with the opponent's first forcing move of the line, when there is one)
  if (!direct.length && !then.length && !check && f.mateIn === undefined && cost) {
    if (f.follow) return `After ${r} and ${f.follow}, ${me} loses ${cost}`;
    return `After ${r}, ${me} soon loses ${cost}`;
  }
  let s = `${verb} ${r}${direct.length ? '' : check}`;
  if (direct.length) s += `, ${joinList(direct.slice(0, 2))}${check ? ', with check' : ''}`;
  if (then.length) s += `: then ${joinList(then.slice(0, 2))}`;
  if (f.mateIn !== undefined) s += `; it starts a forced mate in ${f.mateIn} for ${opp}`;
  // (M5c) the reply's threat isn't carried out: the mover avoids it, but the line still costs material
  else if (f.threatParried && cost && threat && threatOnForked) s += `, and ${me} soon loses ${cost}`;
  else if (f.threatParried && cost && threat) s += `; ${me} can avoid that but still loses ${cost}`;
  else if (!direct.length && !then.length && cost) s += `, and ${me} soon loses ${cost}`;
  // (M5c) a pawn fork the pawn could be taken from: the line's cost shows it works
  else if (tactic?.type === 'fork' && tactic.byLine && cost) s += `, and ${me} soon loses ${cost}`;
  else if (f.perpetual) s += `, and ${opp} can then force a draw by perpetual check`;
  return s;
}

function immediateFactText(f: Fact, ctx: ExplainContext): string | null {
  const opp = colorName(other(ctx.mover));
  switch (f.type) {
    case 'checkmate':
      return `Checkmate, ${colorName(ctx.mover)} wins`;
    case 'stalemate':
      return `Stalemate: ${opp} has no legal move and is not in check, so the game is a draw`;
    case 'check':
      return f.double ? 'Double check: the king has to move' : f.discovered ? 'Discovered check: moving this piece opens a line to the king' : 'Gives check';
    case 'capture':
      return captureText(f);
    case 'promotion':
      return `Promotes the pawn to ${an(f.to)}`;
    case 'castle':
      return `Castles ${f.side === 'king' ? 'kingside' : 'queenside'}`;
    case 'develop':
      return `Develops the ${f.piece.role} to ${f.piece.square}`;
    case 'attack':
      // (round 8) an attacker the target could take: say so (the engine line doesn't take it — checked in analyzeMove)
      if (f.offered) return `Attacks ${owned(f.target)} with ${an(f.attacker.role)}, and the ${f.attacker.role} can't be taken safely`;
      // (M5c) a battery: the moved piece supports its own piece in front
      if (f.through) return `Lines up behind ${the(f.through)}: together they attack ${owned(f.target)}, and ${colorName(ctx.mover)} now threatens to win it`;
      if (f.reason === 'outnumbered') return `Attacks ${owned(f.target)} once more, and now ${colorName(ctx.mover)} threatens to win it`;
      // a bigger piece attacked by a smaller one has to move whether defended or not: say so, not "undefended"
      return f.reason === 'undefended' && PIECE_VALUES[f.target.role] <= PIECE_VALUES[f.attacker.role] ? `Attacks ${owned(f.target)}, which is undefended` : `Attacks ${owned(f.target)} with ${an(f.attacker.role)}`;
    case 'fork': {
      const withKing = f.targets.some((t) => t.role === 'king');
      if (withKing && f.followUp) {
        const others = f.targets.filter((t) => t.role !== 'king');
        const then = f.followUp.kingMustMove ? 'the king must move, then' : `after ${f.followUp.reply},`;
        return `Fork with check: ${the(f.attacker)} attacks ${opp}'s king and ${joinList(others.map((t) => `${t.role} on ${t.square}`))}; ${then} ${f.followUp.capture} takes the ${others[0]?.role ?? 'piece'}`;
      }
      if (withKing) return `Fork with check: ${the(f.attacker)} attacks ${targetsPhrase(f.targets)} at once`;
      // (M5c) a pawn fork the pawn can be taken from (kept only because the engine line wins material after it)
      if (f.byLine) return `Pawn fork: ${the(f.attacker)} attacks ${targetsPhrase(f.targets)} at once, and wins material a few moves later`;
      return `Fork: ${the(f.attacker)} attacks ${targetsPhrase(f.targets)} at once`;
    }
    case 'trapped':
      return `Traps ${owned(f.piece)}: it is attacked, and every square it could move to is covered too`;
    case 'attack-pinned':
      return `Attacks ${owned(f.pinned)} once more: it can't step away (${f.absolute ? 'it is pinned to the king' : `moving it would expose the ${f.behind.role} on ${f.behind.square}`}), so ${colorName(ctx.mover)} now threatens to win it`;
    case 'prevents': {
      const why = f.reason === 'occupied'
        ? `${colorName(ctx.mover)}'s ${f.by?.role ?? 'piece'} now stands on ${f.square}`
        : f.reason === 'blocked'
          ? `${the(f.by ?? { role: 'pawn', square: f.square, color: ctx.mover })} now blocks the way`
          : f.by ? `${the(f.by)} now covers ${f.square}` : `${f.square} is now covered`;
      return `Prevents ${opp}'s idea ${moveName(f.san, other(ctx.mover))}: ${why}`;
    }
    case 'castling-lost':
      return f.color === ctx.mover ? `${colorName(f.color)} gives up the right to castle` : `${colorName(f.color)} can no longer castle`;
    case 'misses-mate':
      return f.mateIn <= 1 ? `Misses checkmate in one: ${sanLine(f.line)}` : `Misses a forced mate in ${f.mateIn}: ${sanLine(f.line)}`;
    case 'pin':
      if (ctx.uci && f.pinner.square !== ctx.uci.slice(2, 4)) return `Uncovers a pin: ${the(f.pinner)} now pins ${owned(f.pinned)} to the ${f.absolute ? 'king' : `${f.behind.role} on ${f.behind.square}`}`;
      return f.absolute
        ? `Pins ${owned(f.pinned)} to the king, so ${slidesAlong(f.pinned, f.pinner) ? 'it can only move along that line' : 'it can\'t move'}`
        : `Pins ${owned(f.pinned)} to the ${f.behind.role} on ${f.behind.square}: if it moves, the ${f.behind.role} can be taken`;
    case 'skewer':
      return `Skewers ${owned(f.front)}: when it moves, ${the(f.behind)} can be taken`;
    case 'discovered-attack':
      return `Discovered attack: moving the ${f.moved.role} lets ${the(f.attacker)} attack ${owned(f.target)}`;
    case 'escape':
      return `Saves the ${f.piece.role}: it was under attack on ${f.from} and is safe on ${f.piece.square}`;
    case 'defend':
      return `Defends ${the(f.piece)}, which was under attack`;
    case 'block-check':
      return 'Blocks the check';
    case 'escape-check':
      return 'Steps out of check with the king';
    case 'hangs':
      // (M5b) a defended piece whose exchange still loses a little isn't "hanging": the opponent wins material there
      if (f.loss <= PIECE_VALUES[f.piece.role] / 2) return `Leaves ${the(f.piece)} ${f.already ? 'still ' : ''}under-protected: ${opp} wins material by taking on ${f.piece.square}`;
      return f.already
        ? `Still leaves ${the(f.piece)} hanging: ${opp} can win it`
        : `Leaves ${the(f.piece)} hanging: ${opp} can win it`;
    case 'allows-mate':
      if (f.line?.length) return `Allows ${mateLinePhrase(f.inMoves, f.line)}`;
      return f.inMoves === 1 ? `Allows checkmate: ${opp} can mate next move` : `Allows ${opp} a forced mate in ${f.inMoves}`;
    case 'threat':
      return threatText(f);
    case 'defends-threat':
      return defendsText(f, ctx);
    case 'allows':
      return allowsText(f, ctx);
    default:
      return null;
  }
}

/** (UI round) A rendered sentence with its tone for the mover. */
export interface ToneLine {
  text: string;
  tone: Tone;
}

/** (UI round) A bad move's sentences: what hurts first (stable within a tone); other moves keep their order. */
export function orderByTone(lines: readonly ToneLine[], label: Label | undefined): ToneLine[] {
  if (!label || !BAD_LABELS.has(label)) return [...lines];
  return lines.map((l, i) => ({ l, i })).sort((a, b) => BAD_MOVE_TONE_ORDER[a.l.tone] - BAD_MOVE_TONE_ORDER[b.l.tone] || a.i - b.i).map((x) => x.l);
}

function renderImmediate(facts: readonly Fact[], ctx: ExplainContext, line?: F<'line'>): ToneLine[] {
  let fs = [...facts];
  // the refutation is only told for bad moves
  if (!ctx.label || !BAD_LABELS.has(ctx.label)) fs = fs.filter((f) => f.type !== 'allows');
  const allows = fs.find((f): f is F<'allows'> => f.type === 'allows');
  // a sacrifice that the short line justifies is not "hanging": say so (both facts are verified)
  // (winning back what the opponent just took is no "interest")
  const realGain = line ? line.materialDelta - (line.owed ?? 0) : 0;
  const paysOff = !line ? null : line.result === 'mate' ? (line.mateIn && line.mateIn > 1 ? `it starts a forced mate in ${line.mateIn}` : 'it leads to mate') : line.result === 'wins-material' && realGain > 0 ? 'the follow-up wins it back with interest' : null;
  const lineMated = line?.result === 'mated';
  const lineLoses = !!line && (line.result === 'loses-material' || lineMated);
  // the move's own line decides whether a "win" is real: no "threatens … winning" when the line ends with the
  // mover down material, nothing at all but the mate when the mover gets mated
  if (lineLoses) fs = fs.filter((f) => !(f.type === 'threat' && !(f.mateIn && !lineMated)));
  if (lineMated) fs = fs.filter((f) => f.type !== 'attack' && f.type !== 'fork' && f.type !== 'defends-threat');
  // the line shows the opponent's threat played anyway, or the "saved" piece taken later: not stopped / not safe
  const oppTakesLater = (sq: string) => !!line?.steps.some((s, i) => i > 0 && s.color !== ctx.mover && s.uci.slice(2, 4) === sq && s.facts.some((x) => x.type === 'capture'));
  fs = fs.filter((f) => !(f.type === 'escape' && oppTakesLater(f.piece.square)));
  // (round 7) an under-protected piece (small SEE loss) whose line loses nothing: the engine doesn't let it cost material
  // (round 8) …nor a piece that was already en prise, when the move's line loses nothing overall (Bxf6 trading it off)
  if (line && line.result !== 'unclear' && line.result !== 'mated' && line.materialDelta >= 0) fs = fs.filter((f) => !(f.type === 'hangs' && (f.already || f.loss <= PIECE_VALUES[f.piece.role] / 2)));
  // "stops the threat on X" and "saves / defends X" say the same thing once
  const stopped = new Set(fs.filter((f): f is F<'defends-threat'> => f.type === 'defends-threat').map((f) => f.move.slice(2, 4)));
  fs = fs.filter((f) => !((f.type === 'escape' && stopped.has(f.from)) || (f.type === 'defend' && stopped.has(f.piece.square))));
  if (paysOff) {
    // the sacrificed piece's other attacks are beside the point
    const offered = new Set(fs.filter((f): f is F<'hangs'> => f.type === 'hangs' && !f.already).map((f) => f.piece.square));
    // (M5b) … unless it attacks two pieces at once: that double attack is the point (e5 hitting queen and knight)
    const nAttacks = (sq: string) => fs.filter((f) => f.type === 'attack' && f.attacker.square === sq).length;
    fs = fs.filter((f) => !(f.type === 'attack' && offered.has(f.attacker.square) && nAttacks(f.attacker.square) < 2));
  }
  // (M5c) a pawn fork by a pawn that can be taken: the fork sentence says it (the line wins material), not "sacrifices the pawn"
  const forkPawns = new Set(fs.filter((f): f is F<'fork'> => f.type === 'fork' && !!f.byLine).map((f) => f.attacker.square));
  if (forkPawns.size && paysOff) fs = fs.filter((f) => !(f.type === 'hangs' && !f.already && forkPawns.has(f.piece.square)));
  if (fs.some((f) => f.type === 'checkmate')) fs = fs.filter((f) => f.type === 'checkmate' || f.type === 'promotion');
  else if (fs.some((f) => f.type === 'stalemate')) fs = fs.filter((f) => f.type === 'stalemate' || f.type === 'promotion' || f.type === 'capture');
  const kingTactic = fs.some((f) => (f.type === 'fork' && f.targets.some((t) => t.role === 'king')) || (f.type === 'skewer' && f.front.role === 'king'));
  if (kingTactic) fs = fs.filter((f) => f.type !== 'check');
  // attacks already told by a stronger fact
  const covered = new Set<string>();
  for (const f of fs) {
    if (f.type === 'fork') f.targets.forEach((t) => covered.add(t.square));
    if (f.type === 'pin') covered.add(f.pinned.square);
    if (f.type === 'skewer') [f.front, f.behind].forEach((t) => covered.add(t.square));
    if (f.type === 'discovered-attack') covered.add(f.target.square);
    if (f.type === 'trapped') covered.add(f.piece.square);
    if (f.type === 'attack-pinned') covered.add(f.pinned.square);
  }
  // stepping out of check with the king and losing castling: one sentence
  const ownCastlingLost = fs.find((f): f is F<'castling-lost'> => f.type === 'castling-lost' && f.color === ctx.mover && !f.at);
  if (ownCastlingLost && fs.some((f) => f.type === 'escape-check')) fs = fs.filter((f) => f !== ownCastlingLost);
  fs = fs.filter((f) => !(f.type === 'attack' && covered.has(f.target.square)));
  // an attack whose capture is exactly the verified threat: the threat sentence says it (with the gain)
  const threatTo = fs.find((f): f is F<'threat'> => f.type === 'threat' && !f.mateIn)?.move.slice(2, 4);
  if (threatTo) fs = fs.filter((f) => !(f.type === 'attack' && f.target.square === threatTo));
  // (M5b) a threat to take a piece the fork already names is the fork itself
  const forkSquares = new Set(fs.flatMap((f) => (f.type === 'fork' ? f.targets.map((t) => t.square) : [])));
  if (forkSquares.size) fs = fs.filter((f) => !(f.type === 'threat' && !f.mateIn && forkSquares.has(f.move.slice(2, 4))));

  // the refutation merged with what it refutes: a hang the reply takes, a mate in one the reply delivers
  const merged = new Map<Fact, string>();
  // (UI round) tone of a merged sentence, when it differs from its fact's own tone
  const mergedTone = new Map<Fact, Tone>();
  if (allows) {
    const cap = allows.facts.find((x): x is F<'capture'> => x.type === 'capture');
    // (M5c) not when the refutation mates: the mate is the point, not the hanging piece
    // (and not when the reply is also a tactic — Nxc7+ forking king and rook is the point, not the pawn it takes)
    const hang = cap && allows.mateIn === undefined && !allows.facts.some((x) => x.type === 'checkmate' || x.type === 'fork' || x.type === 'skewer' || x.type === 'discovered-attack') && fs.find((f): f is F<'hangs'> => f.type === 'hangs' && f.piece.square === cap.captured.square);
    if (hang) {
      const opp = colorName(other(ctx.mover));
      merged.set(hang, hang.loss <= PIECE_VALUES[hang.piece.role] / 2 ? `Leaves ${the(hang.piece)} under-protected: ${opp} takes on ${hang.piece.square} with ${allows.reply.san} and wins material` : `${hang.already ? "Still leaves" : "Leaves"} ${the(hang.piece)} hanging: ${opp} takes it with ${allows.reply.san}`);
      fs = fs.filter((f) => f !== allows);
    } else if (cap) {
      // (M5c) the tactic reply names what it wins: no separate "leaves … hanging" for the same piece
      fs = fs.filter((f) => !(f.type === 'hangs' && f.piece.square === cap.captured.square));
    }
    // one mate sentence: the refutation already says "can force mate" (M5c: and a piece hanging next to a mate is beside the point)
    if (allows.facts.some((x) => x.type === 'checkmate') || allows.mateIn !== undefined) fs = fs.filter((f) => f.type !== 'allows-mate' && f.type !== 'hangs');
  }

  // no "wins" / "for free" for a capture whose gain the line gives back
  const gainKept = (net: number) => !line || line.result === 'unclear' || line.result === 'mate' || (!lineMated && line.materialDelta >= net);
  const givenBack = fs.find((f): f is F<'capture'> => f.type === 'capture' && f.outcome === 'wins-material' && !gainKept(f.net));
  if (givenBack) {
    const withCheck = fs.some((f) => f.type === 'check' && !f.double && !f.discovered) ? ', with check' : '';
    const base = `Takes ${owned(givenBack.captured)}${withCheck}`;
    if (allows && fs.includes(allows)) {
      const a = allowsText(allows, ctx);
      merged.set(givenBack, `${base}, but ${a.charAt(0).toLowerCase()}${a.slice(1)}`);
      mergedTone.set(givenBack, 'bad');
      fs = fs.filter((f) => f !== allows);
    } else {
      merged.set(givenBack, base);
      mergedTone.set(givenBack, 'neutral');
    }
  }

  // (M5b) not "an even trade" when the line goes on to win material (…Bxc4 also uncovering an attack on d3)
  const evenButWins = fs.find((f): f is F<'capture'> => f.type === 'capture' && f.outcome === 'even-trade');
  if (evenButWins && line?.result === 'wins-material' && realGain > 0 && !merged.has(evenButWins)) {
    merged.set(evenButWins, `Takes ${owned(evenButWins.captured)}${fs.some((f) => f.type === 'check' && !f.double && !f.discovered) ? ', with check,' : ''} and wins material a few moves later`);
    mergedTone.set(evenButWins, 'good');
  }

  const rank = (t: Fact['type']) => {
    const i = IMMEDIATE_ORDER.indexOf(t);
    return i < 0 ? IMMEDIATE_ORDER.length : i;
  };
  fs = fs.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f.type) - rank(b.f.type) || a.i - b.i).map((x) => x.f);
  // a merged hang leads like the refutation would have
  const lead = [...merged.keys()];
  fs = [...lead, ...fs.filter((f) => !merged.has(f))];

  const out: ToneLine[] = [];
  const check = fs.find((f): f is F<'check'> => f.type === 'check');
  // a capture also 'saves' the capturing piece when it takes its attacker: the capture sentence says enough
  if (fs.some((f) => f.type === 'capture')) fs = fs.filter((f) => f.type !== 'escape');
  // taking back usually 'defends' what the taken piece attacked — the capture is the point, not a defence
  if (fs.some((f) => f.type === 'capture' && (f.outcome === 'recapture' || f.outcome === 'even-trade'))) fs = fs.filter((f) => f.type !== 'defend');
  // a plain check is merged into the capture / promotion sentence
  const capture = fs.find((f) => f.type === 'capture') ?? fs.find((f) => f.type === 'promotion');
  const attacksByAttacker = new Map<string, F<'attack'>[]>();
  for (const f of fs) if (f.type === 'attack') attacksByAttacker.set(f.attacker.square, [...(attacksByAttacker.get(f.attacker.square) ?? []), f]);
  const done = new Set<string>();
  for (const f of fs) {
    if (f.type === 'check' && capture && !f.double && !f.discovered) continue; // merged into the capture / promotion sentence
    if (f.type === 'attack') {
      if (done.has(f.attacker.square)) continue;
      done.add(f.attacker.square);
      const group = attacksByAttacker.get(f.attacker.square)!;
      if (group.length > 1) {
        out.push({ text: `Attacks ${targetsPhrase(group.map((g) => g.target))} at once`, tone: 'good' });
        continue;
      }
    }
    let text = merged.get(f) ?? immediateFactText(f, ctx);
    let tone: Tone = mergedTone.get(f) ?? factTone(f, ctx.mover);
    // (M5c) a pawn left en prise by a book move is a gambit, not a blunder
    if (ctx.label === 'book' && f.type === 'hangs' && !f.already && f.piece.role === 'pawn') {
      text = `Offers ${the(f.piece)} as a gambit: ${colorName(other(ctx.mover))} can take it`;
      tone = 'neutral';
    }
    // (M5c) a capture threat the engine line answers by simply moving the piece away: an attack, not a win of N points
    if (f.type === 'threat' && !f.mateIn && line && !merged.has(f)) {
      const target = f.move.slice(2, 4);
      const cap = f.facts.find((x): x is F<'capture'> => x.type === 'capture');
      const reply = line.steps[1];
      const quietStep = !!reply && !reply.facts.some((x) => x.type === 'capture' || x.type === 'check' || x.type === 'checkmate') && !reply.san.includes('x') && !reply.san.includes('+');
      // (a tactic fact already names this target: the threat adds nothing)
      if (cap && fs.some((x) => (x.type === 'discovered-attack' && x.target.square === target) || (x.type === 'skewer' && x.front.square === target))) continue;
      if (cap && reply && quietStep && reply.uci.slice(0, 2) === target && !(line.result === 'wins-material' && line.materialDelta >= f.gain)) {
        text = `Attacks ${owned(cap.captured)}, which steps away with ${reply.san}`;
        tone = 'neutral';
      }
    }
    if (f.type === 'escape-check' && ownCastlingLost) {
      text = `Steps out of check with the king, so ${colorName(ctx.mover)} can no longer castle`;
      tone = 'bad';
    }
    if (paysOff && f.type === 'hangs' && !f.already) {
      text = `Sacrifices ${the(f.piece)}: ${paysOff}`;
      tone = 'good';
    }
    if (paysOff && f.type === 'capture' && f.outcome === 'loses-material') {
      text = `Takes ${owned(f.captured)} as a sacrifice: ${paysOff}`;
      tone = 'good';
    }
    else if (!paysOff && f.type === 'capture' && f.outcome === 'loses-material' && !f.desperado && line && !(ctx.label && BAD_LABELS.has(ctx.label)) && ctx.uci) {
      // (M5b, round 6) a losing capture by a good move: the line either takes the piece and wins the material back
      // (a sacrifice), or doesn't take it at all (24.Rxd4!! Kb6 — the offer is declined)
      const dest = ctx.uci.slice(2, 4);
      const taken = line.steps.some((s, i) => i > 0 && s.color !== ctx.mover && s.uci.slice(2, 4) === dest);
      const role = line.steps[0] ? sanRole(line.steps[0].san) : 'piece';
      if (!taken) {
        text = `Takes ${owned(f.captured)} and leaves the ${role} where it can be taken, but ${colorName(other(ctx.mover))}'s best reply doesn't take it`;
        tone = 'neutral';
      } else if ((line.result === 'trade' || line.result === 'wins-material') && line.materialDelta >= 0) {
        text = `Takes ${owned(f.captured)} as a sacrifice: it wins the material back a few moves later`;
        tone = 'good';
      }
    }
    if (!text) continue;
    if (f === capture && check && !check.double && !check.discovered && !merged.has(f)) text += ', with check';
    out.push({ text, tone });
  }
  // a move that starts a forced mate: that is the point, told first
  if (line?.result === 'mate' && line.mateIn && line.mateIn > 1 && !fs.some((f) => f.type === 'checkmate') && !out.some((s) => s.text.includes('mate'))) out.unshift({ text: `Starts a forced mate in ${line.mateIn}`, tone: 'good' });
  // (UI round) a bad move: what hurts first, so the cap never drops it
  return orderByTone(out, ctx.label).slice(0, MAX_SENTENCES).map((s) => ({ ...s, text: `${s.text}.` }));
}

// --- Short term ---------------------------------------------------------------------------------------------------

/** The step fact to narrate: taking a piece (worth 3+) beats "uncovers an attack" / "pins" / "attacks". */
function stepMainFact(step: LineStep): Fact | undefined {
  const facts = step.facts.filter((x) => x.type !== 'check');
  const big = facts.find((x) => x.type === 'capture' && PIECE_VALUES[x.captured.role] >= 3);
  const mate = facts.find((x) => x.type === 'checkmate');
  const fork = facts.find((x) => x.type === 'fork');
  const trapped = facts.find((x) => x.type === 'trapped');
  const block = facts.find((x) => x.type === 'block-check');
  return mate ?? fork ?? trapped ?? big ?? block ?? facts[0];
}

const SAN_ROLES: Record<string, PieceRole> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight' };
/** The moving piece of a SAN move (a promotion counts as the promoted piece; castling as the king). */
export function sanRole(san: string): PieceRole {
  if (san.startsWith('O-O')) return 'king';
  const promo = /=([QRBN])/.exec(san);
  if (promo) return SAN_ROLES[promo[1]!]!;
  return SAN_ROLES[san[0]!] ?? 'pawn';
}

/**
 * Step i offers its piece (worth 3+): the next ply wins it by SEE on its square, and the line ends in favour of
 * the side that offered it (mate, or ahead in material) — a sacrifice, not a blunder inside the engine line.
 */
function isSacrifice(steps: readonly LineStep[], i: number, result: F<'line'>['result'] | undefined): boolean {
  const s = steps[i]!;
  const next = capOf(steps[i + 1]);
  if (!next || next.outcome !== 'wins-material' || next.captured.square !== s.uci.slice(2, 4)) return false;
  const role = sanRole(s.san);
  if (role === 'king' || PIECE_VALUES[role] < 3) return false;
  // (M5c) a promotion that is taken at once gives up a pawn, not "the queen"
  if (s.san.includes('=')) return false;
  // a step whose point is a tactic is told as that tactic (Nf6+ uncovering an attack on the rook)
  if (s.facts.some((f) => f.type === 'checkmate' || f.type === 'fork' || f.type === 'skewer' || f.type === 'discovered-attack' || f.type === 'pin' || f.type === 'trapped')) return false;
  const mover = steps[0]!.color;
  const side = s.color;
  if (side === mover ? result === 'mate' : result === 'mated') return true;
  // material: the side that offered the piece ends the line at least as well off as before the offer
  if (result !== 'wins-material' && result !== 'loses-material') return false;
  let bal = 0; // side's running material change from step i on
  for (let k = i; k < steps.length; k++) {
    const c = capOf(steps[k]);
    if (c) bal += (steps[k]!.color === side ? 1 : -1) * PIECE_VALUES[c.captured.role];
  }
  return bal >= 0 && (side === mover ? result === 'wins-material' : result === 'loses-material');
}

/** `back`: the capture takes back material lost earlier in the line (running balance; undefined = unknown). */
function stepClause(step: LineStep, mayWin = true, back?: boolean): string {
  const f = stepMainFact(step);
  if (!f) return '';
  switch (f.type) {
    case 'checkmate':
      return ' is checkmate';
    case 'stalemate':
      return ' is stalemate';
    case 'fork':
{
      // "forks the king and rook", "forks both knights"
      const roles = f.targets.map((t) => t.role);
      if (roles.length > 1 && new Set(roles).size === 1) return ` forks ${roles.length === 2 ? 'both' : 'the'} ${roles[0]}s`;
      return ` forks the ${joinList(roles)}`;
    }
    case 'skewer':
      return ` skewers the ${f.front.role} and ${f.behind.role}`;
    case 'pin':
      // a pin made by another piece (the move opened its line) is uncovered, not made by the moving piece
      if (f.pinner.square !== step.uci.slice(2, 4)) return ` uncovers a pin: the ${f.pinner.role} on ${f.pinner.square} pins the ${f.pinned.role} to the ${f.absolute ? 'king' : f.behind.role}`;
      return f.absolute ? ` pins the ${f.pinned.role} on ${f.pinned.square} to the king` : ` pins the ${f.pinned.role} on ${f.pinned.square} to the ${f.behind.role}`;
    case 'discovered-attack':
      return ` uncovers an attack on ${colorName(f.target.color)}'s ${f.target.role} on ${f.target.square}`;
    case 'capture':
      // by the running balance of the line: a capture of a bigger piece than was lost is no plain take-back
      if (back ?? f.outcome === 'recapture') return ' takes back';
      if (mayWin && f.outcome === 'wins-material' && f.net >= PIECE_VALUES[f.captured.role]) return ` wins the ${f.captured.role}`;
      return ` takes the ${f.captured.role}`;
    case 'promotion':
      return ` promotes to ${an(f.to)}`;
    case 'attack':
      if (f.through) return ` lines up behind the ${f.through.role} against the ${f.target.role}`;
      return ` attacks the ${f.target.role}`;
    case 'trapped':
      return ` traps the ${f.piece.role} (it has no safe square)`;
    case 'attack-pinned':
      return ` attacks the pinned ${f.pinned.role}`;
    case 'block-check':
      return ' blocks the check';
    default:
      return '';
  }
}

const NUMBERS = ['', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

/** "a knight", "two pawns", "a rook and a pawn" (roles sorted by value). */
export function piecesPhrase(roles: readonly PieceRole[]): string {
  const counts = new Map<PieceRole, number>();
  for (const r of roles) counts.set(r, (counts.get(r) ?? 0) + 1);
  return joinList([...counts].map(([r, n]) => (n === 1 ? an(r) : `${NUMBERS[n] ?? n} ${r}s`)));
}

function materialResult(line: F<'line'>, mover: Color): string {
  const who = colorName(mover);
  const won = line.won ?? [];
  const lost = line.lost ?? [];
  // (round 9) with a promotion in the line, piece lists read wrong ("gives a rook for a pawn" when the opponent queens)
  if (line.steps.some((s) => s.facts.some((f) => f.type === 'promotion'))) {
    return line.materialDelta > 0 ? `${who} comes out ahead in material (${points(line.materialDelta)})` : `${who} loses material overall (${points(line.materialDelta)})`;
  }
  const d = `(${points(line.materialDelta)})`;
  const isExchange = (a: readonly PieceRole[], b: readonly PieceRole[]) => a.length === 1 && a[0] === 'rook' && b.length === 1 && (b[0] === 'knight' || b[0] === 'bishop');
  // "wins back": the mover started behind and the gain only makes up (part of) that deficit
  const start = line.balance !== undefined ? line.balance - line.materialDelta : null;
  // (M5b, round 6) also: the line starts by taking back on the square the opponent just captured on (Bxf6 Qxf6)
  const takesBackFirst = !!line.steps[0]?.facts.some((f) => f.type === 'capture' && f.outcome === 'recapture') && (line.owed ?? 0) > 0 && line.materialDelta <= (line.owed ?? 0);
  const firstIsRecapture = takesBackFirst || (start !== null ? start < 0 && line.materialDelta <= -start : !!line.steps[0]?.facts.some((f) => f.type === 'capture' && f.outcome === 'recapture'));
  // (round 7) taking back: no "wins the exchange" — only a plain "wins back a rook", else "wins back material"
  if (line.result === 'wins-material' && firstIsRecapture) return lost.length === 0 && won.length > 0 && won.length <= 2 ? `${who} wins back ${piecesPhrase(won)} ${d}` : `${who} wins back material ${d}`;
  if (line.result === 'wins-material') {
    if (isExchange(won, lost)) return `${who} wins the exchange — a rook for ${an(lost[0]!)} ${d}`;
    if (lost.length === 0 && won.length > 0 && won.length <= 2) return `${who} ${firstIsRecapture ? 'wins back' : 'wins'} ${piecesPhrase(won)} ${d}`;
    if (won.length > 0 && won.length <= 2 && lost.length <= 2) return `${who} ${firstIsRecapture ? 'wins back' : 'wins'} ${piecesPhrase(won)} for ${piecesPhrase(lost)} ${d}`;
    return `${who} comes out ahead in material ${d}`;
  }
  if (isExchange(lost, won)) return `${who} loses the exchange — a rook for ${an(won[0]!)} ${d}`;
  if (won.length === 0 && lost.length > 0 && lost.length <= 2) return `${who} loses ${piecesPhrase(lost)} ${d}`;
  if (lost.length > 0 && lost.length <= 2 && won.length <= 2) return `${who} gives ${piecesPhrase(lost)} for ${piecesPhrase(won)} ${d}`;
  return `${who} loses material overall ${d}`;
}

const capOf = (s: LineStep | undefined) => s?.facts.find((x): x is F<'capture'> => x.type === 'capture');

/**
 * A trade: step i takes a piece and step i+1 takes back a piece of the same kind on the same square
 * ("Qxb4 Bxb4+" = the queens are traded). Returns the traded role, or null.
 */
function tradeAt(steps: readonly LineStep[], i: number): PieceRole | null {
  const a = capOf(steps[i]);
  const b = capOf(steps[i + 1]);
  if (!a || !b || b.outcome !== 'recapture') return null;
  if (a.captured.square !== b.captured.square || a.captured.role !== b.captured.role) return null;
  return a.captured.role;
}

/** How much a step matters for the story (compression keeps the most important ones). */
function stepWeight(s: LineStep): number {
  const f = stepMainFact(s);
  if (!f) return s.forced ? 2 : s.facts.some((x) => x.type === 'check') ? 1 : 0;
  if (f.type === 'checkmate' || f.type === 'fork' || f.type === 'skewer' || f.type === 'promotion' || f.type === 'trapped') return 4;
  if (f.type === 'attack-pinned') return 3;
  if (f.type === 'capture') return f.outcome === 'wins-material' || PIECE_VALUES[f.captured.role] >= 3 ? 4 : 3;
  if (f.type === 'discovered-attack' || f.type === 'pin') return 3;
  return s.forced ? 2 : 1;
}

/** Story units: single steps, or a trade pair rendered as one unit. */
interface Unit {
  from: number;
  to: number;
  text: string;
  weight: number;
  /** (UI round) for the mover: the mover's tactic / capture = good, the opponent's = bad, a plain move or a trade = neutral. */
  tone: Tone;
}

function storyUnits(steps: readonly LineStep[], result?: F<'line'>['result']): Unit[] {
  const mover = steps[0]?.color;
  // "wins" only for the side that comes out of the line ahead: a pawn grab that loses a knight just "takes"
  const mayWin = (s: LineStep) => (s.color === mover ? result === 'wins-material' || result === 'mate' : result === 'loses-material' || result === 'mated');
  // (UI round) in a mating line, the losing side's steps help nothing (Nxb8 "takes the queen" walks into Rd8#)
  const doomed = (s: LineStep) => (result === 'mated' && s.color === mover) || (result === 'mate' && s.color !== mover);
  const toneOf = (s: LineStep, t: Tone): Tone => (doomed(s) ? 'neutral' : t);
  const units: Unit[] = [];
  let bal = 0; // the mover's material change so far in the line
  const backAt = steps.map((s, i) => {
    const cap = capOf(s);
    if (!cap) return undefined;
    const v = PIECE_VALUES[cap.captured.role];
    const side = s.color === mover ? bal : -bal;
    // a take-back: on the square of the previous capture, and only winning back what was lost (not more)
    const prevCap = capOf(steps[i - 1]);
    const sameKind = !!prevCap && prevCap.captured.role === cap.captured.role; // Qxc3 bxc3: the queens are traded
    // (M5b) a same-kind capture is a take-back only while the side is behind (…Rxf2+ Rxf2 Bxf2 wins a second rook)
    const back = cap.outcome === 'recapture' && (i === 0 || ((sameKind || side + v <= 0) && side < 0));
    bal += s.color === mover ? v : -v;
    return back;
  });
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const traded = i >= 1 ? tradeAt(steps, i) : null; // the move itself always stands alone
    if (traded && traded !== 'pawn') {
      const t = steps[i + 1]!;
      units.push({ from: i, to: i + 1, text: `${s.san} ${t.san} (${traded === 'king' ? 'kings' : `${traded}s`} are traded)`, weight: 3, tone: 'neutral' });
      i++;
      continue;
    }
    if (isSacrifice(steps, i, result)) {
      const cap = capOf(s);
      const role = sanRole(s.san);
      units.push({ from: i, to: i, text: cap ? `${s.san} takes the ${cap.captured.role}, sacrificing the ${role}` : `${s.san} sacrifices the ${role}`, weight: 4, tone: toneOf(s, s.color === mover ? 'good' : 'bad') });
      continue;
    }
    const clause = stepClause(s, mayWin(s), backAt[i]);
    // (UI round) a step that does something is good for its side; a forced reply without a clause = the opponent had no choice
    const blocks = clause === ' blocks the check';
    const tone: Tone = clause && !blocks ? (s.color === mover ? 'good' : 'bad') : s.forced && s.color !== mover ? 'good' : 'neutral';
    units.push({ from: i, to: i, text: `${s.san}${clause}${s.forced ? ' (forced)' : ''}`, weight: stepWeight(s), tone: toneOf(s, tone) });
  }
  return units;
}

/**
 * The units to show (see header): the move, the reply and the last step always; then the most important other
 * units up to MAX_SHOWN_STEPS (steps without facts are never shown in the middle).
 */
export function shownUnits(steps: readonly LineStep[], result?: F<'line'>['result']): Unit[] {
  const units = storyUnits(steps, result);
  const last = units.length - 1;
  // the last step only when it does something (a quiet last move adds nothing to the story — M5b)
  const fixed = new Set([0, 1, ...(last <= 1 || units[last]!.weight > 0 ? [last] : [])].filter((i) => i >= 0 && i <= last));
  const rest = units.map((u, i) => ({ u, i })).filter(({ u, i }) => !fixed.has(i) && u.weight > 0);
  rest.sort((a, b) => b.u.weight - a.u.weight || a.i - b.i);
  const chosen = new Set([...fixed, ...rest.slice(0, Math.max(0, MAX_SHOWN_STEPS - fixed.size)).map((x) => x.i)]);
  // a quiet last step right after a shown one is kept (no gap to bridge); after hidden steps it is dropped too
  if (last >= 0 && !chosen.has(last) && chosen.has(last - 1)) chosen.add(last);
  return units.filter((_, i) => chosen.has(i));
}

/** "material is level", "White is a pawn up", "Black is 3 points up" (balance = mover POV). */
function balanceText(balance: number, mover: Color, verb: 'is' | 'was' = 'is'): string {
  if (balance === 0) return `material ${verb} level`;
  const who = colorName(balance > 0 ? mover : other(mover));
  const n = Math.abs(balance);
  return `${who} ${verb} ${n === 1 ? 'a pawn' : `${n} points`} up`;
}

/** The Short-term sentence of a line (`lineStory` without its parts). */
export function lineText(line: F<'line'>, ctx: ExplainContext): string {
  return lineStory(line, ctx).text;
}

/**
 * The material balance after a material result, when material wasn't level before the line (mover POV).
 * Root cause of "White gives a knight for two pawns (−1 point); material is level" reading as a contradiction: the
 * balance was appended without the balance it started from. When the change wipes out a side's lead (or turns it
 * around), both ends are named: "White was a pawn up before, so material is now level".
 */
export function balanceAfter(line: Pick<F<'line'>, 'balance' | 'materialDelta'>, mover: Color): string | null {
  if (line.balance === undefined) return null;
  const end = line.balance;
  const start = end - line.materialDelta;
  if (start === 0) return null;
  // (M5c) "loses material (−2); Black is still 2 points up" — the lead shrinks but stays
  if ((line.materialDelta < 0 && end > 0) || (line.materialDelta > 0 && end < 0)) return balanceText(end, mover).replace(/ is /, ' is still ');
  // the change goes against the side that was ahead and wipes the lead out (or turns it around)
  const lostLead = (line.materialDelta < 0 && start > 0) || (line.materialDelta > 0 && start < 0 && end > 0);
  if (lostLead) return `${balanceText(start, mover, 'was')} before, ${end === 0 ? 'so material is now level' : `now ${balanceText(end, mover)}`}`;
  return balanceText(end, mover);
}

/** (UI round) The Short-term sentence and its parts (each story unit with its tone for the mover). */
export function lineStory(line: F<'line'>, ctx: ExplainContext): { text: string; story?: StoryPart[] } {
  const mover = ctx.mover;
  const story = line.steps.some((s) => s.forced || s.facts.length > 0);
  if (!story && !line.draw && (line.result === 'quiet' || line.result === 'trade' || line.result === 'unclear')) {
    // (M5b) not "no forcing follow-up" when the engine line goes on with a check or capture right after
    if (line.nextForcing) return { text: `${line.steps.map((s) => s.san).join(' → ')}; best play then goes on with ${line.nextForcing}.` };
    return { text: 'No forcing follow-up.' };
  }
  const parts: StoryPart[] = [];
  const gap = (): StoryPart => ({ text: '…', tone: 'neutral' });
  let prevTo = -1;
  for (const u of shownUnits(line.steps, line.result)) {
    if (u.from > prevTo + 1) parts.push(gap());
    parts.push({ text: u.text, tone: u.tone, plies: [u.from, u.to] });
    prevTo = u.to;
  }
  const mated = line.steps.some((s) => s.facts.some((f) => f.type === 'checkmate'));
  let result = '';
  switch (line.result) {
    case 'mate':
      if (!mated) result = `${colorName(mover)} forces mate in ${line.mateIn}`;
      break;
    case 'mated':
      if (!mated) result = `${colorName(other(mover))} forces mate in ${line.mateIn}`;
      break;
    case 'wins-material':
    case 'loses-material': {
      // the change, plus the resulting balance when material wasn't level before ("Black loses a pawn (−1
      // point); Black was a pawn up before, so material is now level" = a gambit pawn given back)
      result = materialResult(line, mover);
      const after = balanceAfter(line, mover);
      if (after) result += `; ${after}`;
      break;
    }
    case 'trade': {
      const start = line.balance ?? 0;
      result = start === 0 ? 'material stays level' : `the material balance doesn't change (${balanceText(start, mover)})`;
      break;
    }
    case 'quiet':
    case 'unclear':
      break;
  }
  // (M5c) the line ends in a repeated position the engine scores as a draw: that is the result
  if (line.draw && line.result !== 'mate' && line.result !== 'mated') {
    result = line.draw === 'perpetual' && line.drawBy
      ? `${colorName(line.drawBy)} keeps giving check: a draw by perpetual check`
      : 'the position repeats: a draw by repetition';
  }
  // hidden quiet moves after the last shown step: the result is measured after them
  if (result && prevTo < line.steps.length - 1) parts.push(gap());
  // (round 9) the recapture the result already counts (the PV's next move)
  if (result && line.recapture && (line.result === 'wins-material' || line.result === 'loses-material' || line.result === 'trade')) parts.push({ text: line.recapture, tone: 'neutral' });
  if (result) parts.push({ text: result, tone: lineTone(line) });
  return { text: `${parts.map((x) => x.text).join(' → ')}.`, story: parts };
}

// --- Long term ----------------------------------------------------------------------------------------------------

function kingReasons(detail: string | undefined, worse: boolean): string {
  if (!detail) return '';
  const parts: string[] = [];
  const m1 = /shield (\d+)->(\d+)/.exec(detail);
  if (m1) {
    const [a, b] = [Number(m1[1]), Number(m1[2])];
    if (b < a && worse) parts.push('fewer pawns in front of it');
    if (b > a && !worse) parts.push('more pawns in front of it');
  }
  if (/^shield \d+$/.test(detail) && !worse) parts.push('it is tucked away behind its pawns');
  const m2 = /open files (\d+)->(\d+)/.exec(detail);
  if (m2) {
    const [a, b] = [Number(m2[1]), Number(m2[2])];
    if (b > a && worse) parts.push('more open files next to it');
    if (b < a && !worse) parts.push('fewer open files next to it');
  }
  const m3 = /attackers (\d+)->(\d+)/.exec(detail);
  if (m3) {
    const [a, b] = [Number(m3[1]), Number(m3[2])];
    if (b > a && worse) parts.push('more enemy pieces aim at it');
    if (b < a && !worse) parts.push('fewer enemy pieces aim at it');
  }
  return parts.length ? ` (${joinList(parts)})` : '';
}

const onSquares = (sq: readonly string[] | undefined): string => (sq && sq.length ? ` on ${joinList(sq)}` : '');
const filesOf = (sq: readonly string[] | undefined): string => {
  const files = [...new Set((sq ?? []).map((s) => s[0]!))].sort();
  return files.length ? ` on the ${joinList(files.map((f) => `${f}-file`))}` : '';
};

export function positionalText(f: F<'positional'>, ctx: ExplainContext): string {
  const own = f.side !== 'opponent';
  const who = colorName(own ? ctx.mover : other(ctx.mover));
  const me = colorName(ctx.mover);
  // delta is from the mover's POV; `good` = this side's own situation improved
  const good = own ? f.delta > 0 : f.delta < 0;
  const plural = (f.squares?.length ?? 0) > 1;
  let s: string;
  switch (f.feature) {
    case 'king-safety':
      s = good ? `${who}'s king is safer${kingReasons(f.detail, false)}` : `${who}'s king is more exposed${kingReasons(f.detail, true)}`;
      break;
    case 'passed-pawn':
      s = good
        ? `${who} gets ${plural ? 'passed pawns' : 'a passed pawn'}${onSquares(f.squares)} (no enemy pawn stands in ${plural ? 'their' : 'its'} way)`
        : `${who} no longer has ${plural ? 'passed pawns' : 'a passed pawn'}${onSquares(f.squares)}`;
      break;
    case 'isolated-pawn':
      s = good
        ? `${who}'s pawn${plural ? 's' : ''}${onSquares(f.squares)} ${plural ? 'are' : 'is'} no longer isolated`
        : `${who} gets ${plural ? 'isolated pawns' : 'an isolated pawn'}${onSquares(f.squares)} (no pawn of the same colour on the files next to ${plural ? 'them' : 'it'})`;
      break;
    case 'doubled-pawn':
      s = good ? `${who}'s doubled pawns${filesOf(f.squares)} are gone` : `${who} gets doubled pawns${filesOf(f.squares)} (two pawns on one file)`;
      break;
    case 'open-file-rook':
      if (f.detail === 'open') s = `${who}'s rook${onSquares(f.squares)} now stands on a fully open file (no pawns on it)`;
      else s = good ? `${who}'s rook${onSquares(f.squares)} gets a file without its own pawns in the way` : `${who}'s rook${onSquares(f.squares)} no longer has a free file`;
      break;
    case 'bishop-pair':
      s = good ? `${who} gets the bishop pair (two bishops against fewer)` : `${who} gives up the bishop pair (the two-bishop advantage)`;
      if (!own && !good) s = `${who} no longer has the bishop pair (the two-bishop advantage)`;
      break;
    case 'development':
      s = f.delta > 0 ? `${me} improves development` : `${me} puts a piece back on its starting square`;
      break;
    case 'mobility':
      s = f.delta > 0 ? `${me}'s pieces get more room to move than ${colorName(other(ctx.mover))}'s` : `${me}'s pieces get less room to move than ${colorName(other(ctx.mover))}'s`;
      break;
    case 'centre-control':
      s = f.delta > 0 ? `${me} gains control of the centre` : `${me} gives up some control of the centre`;
      break;
    case 'space':
      s = f.delta > 0 ? `${me} gains space` : `${me} gives up some space`;
      break;
  }
  return f.at === 'line-end' ? `After these moves, ${s}.` : `${s}.`;
}

function longFactText(f: Fact, ctx: ExplainContext, all: AllFacts): string | null {
  const me = colorName(ctx.mover);
  switch (f.type) {
    case 'positional':
      return positionalText(f, ctx);
    case 'positional-gain': {
      const pawns = (f.cp / 100).toFixed(1);
      const line = all.short.find((x): x is F<'line'> => x.type === 'line');
      if (line && line.materialDelta < 0) return `${me} gives up material, but gets about ${pawns} pawns' worth of compensation in the position.`;
      return `${me}'s position is worth about ${pawns} pawns more than the material count suggests.`;
    }
    case 'castling-lost':
      return f.at === 'line-end' ? `After these moves, ${colorName(f.color)}'s king can no longer castle.` : `${colorName(f.color)} can no longer castle.`;
    case 'deep-payoff':
      return 'The payoff is far away: at first glance this move looks worse — only a deep look shows why it works.';
    case 'necessary':
      return f.onlyMove ? 'It was the only legal move.' : 'The only good move here — every other move is much worse.';
    case 'nothing-notable':
      return 'No notable long-term change.';
    default:
      return null;
  }
}

// --- Levels -------------------------------------------------------------------------------------------------------

export interface AllFacts {
  immediate: readonly Fact[];
  short: readonly Fact[];
  long: readonly Fact[];
}

const NOTHING = {
  immediate: 'Nothing special happens right away.',
  short: 'No forcing follow-up.',
  long: 'No notable long-term change.',
} as const;

/**
 * A bad move whose Immediate level would say nothing (M5b): name what the engine's move does instead, point to a
 * long-term drawback, or (round 10) just name the better move — no sentence that only says the reason can't be told.
 */
function missesText(f: F<'misses'>, ctx: ExplainContext, long: readonly Fact[], short: readonly Fact[] = []): string {
  const reasons = missesReasons(f, ctx.mover);
  const better = ctx.label === 'inaccuracy' ? 'was better' : 'was much better';
  // (round 10) one reason, the biggest (a second one mostly repeats it: "attacks the bishop and wins it and threatens
  // Rxe7+, winning a bishop"), and no hedge when it is small next to the drop (`f.partial`): the label says how bad it is
  if (reasons.length) return `Misses ${f.san}, which ${reasons[0]}.`;
  // (round 6) the move's own engine line loses material: say that, not "no tactical problem"
  const line = short.find((x): x is F<'line'> => x.type === 'line');
  if (line?.result === 'loses-material') {
    return `Nothing is lost right away, but ${colorName(ctx.mover)} soon loses ${material(line.materialDelta)}; ${f.san} ${better}.`;
  }
  return `${f.san} ${better}.`;
}

/** (M5c) Size (pawns) of the worst verified negative fact of a move (mates and perpetuals: Infinity). */
function negativeSize(facts: readonly Fact[]): number {
  let m = 0;
  for (const f of facts) {
    if (f.type === 'allows-mate' || f.type === 'misses-mate' || (f.type === 'allows' && (f.mateIn !== undefined || f.perpetual || f.facts.some((x) => x.type === 'checkmate' || (x.type === 'threat' && x.mateIn))))) return Infinity;
    if (f.type === 'allows') m = Math.max(m, f.gain ?? 0, ...f.facts.map((x) => (x.type === 'capture' ? -x.net : x.type === 'threat' ? x.gain : 0)));
    if (f.type === 'hangs') m = Math.max(m, f.loss);
    if (f.type === 'capture' && f.outcome === 'loses-material') m = Math.max(m, -f.net);
  }
  return m;
}

export function renderExplanation(all: AllFacts, ctx: ExplainContext): Explanation {
  const line = all.short.find((f): f is F<'line'> => f.type === 'line');
  let immediateLines = renderImmediate(all.immediate.filter((f) => f.type !== 'nothing-notable' && f.type !== 'misses'), ctx, line);
  const misses = all.immediate.find((f): f is F<'misses'> => f.type === 'misses');
  if (misses && ctx.label && BAD_LABELS.has(ctx.label)) {
    const missesLine: ToneLine = { text: missesText(misses, ctx, all.long, all.short), tone: 'bad' };
    if (immediateLines.length === 0) immediateLines = [missesLine];
    else {
      // (M5b) a bad move whose Immediate level only tells what it does well (stops a threat, takes back, develops):
      // what it misses leads, when that has a verified reason
      const negative = all.immediate.some((f) => f.type === 'allows' || f.type === 'hangs' || f.type === 'allows-mate' || f.type === 'misses-mate' || (f.type === 'capture' && f.outcome === 'loses-material'));
      // (M5c) …and also without a verified reason: the honest fallback, so a Mistake doesn't read as a list of merits
      if (!negative) immediateLines = [missesLine, ...immediateLines].slice(0, MAX_SENTENCES);
      else if (ctx.hedge && !misses.partial) {
        // (M5c) the negative facts told are small next to the eval drop: say so, with the engine's own numbers
        const big = (ctx.label === 'mistake' || ctx.label === 'blunder' || ctx.label === 'miss') && ctx.hedge.dropPawns >= PARTIAL_MIN_DROP && negativeSize(all.immediate) < ctx.hedge.dropPawns / 2;
        if (big) {
          // (UI round) right after the other bad sentences; the last other sentence makes room
          const lines = immediateLines.length >= MAX_SENTENCES ? immediateLines.slice(0, MAX_SENTENCES - 1) : immediateLines;
          const at = lines.filter((l) => l.tone === 'bad').length;
          const h: ToneLine = { text: at ? `It is worse than that: ${ctx.hedge.bestSan} was much better.` : `${ctx.hedge.bestSan} was much better.`, tone: 'bad' };
          immediateLines = [...lines.slice(0, at), h, ...lines.slice(at)];
        }
      }
    }
  }
  // Book: opening theory needs no narration unless the move itself is forcing
  const bookQuiet = ctx.label === 'book' && !!line && !(line.steps[0]?.facts.length) && !all.immediate.some((f) => f.type === 'threat');
  const told = line && line.steps.length > 0 && !bookQuiet ? lineStory(line, ctx) : null;
  const shortLines: ToneLine[] = line && line.steps.length > 0 ? [bookQuiet ? { text: NOTHING.short, tone: 'neutral' } : { text: told!.text, tone: told!.story ? lineTone(line) : 'neutral' }] : [];
  const mates = all.immediate.some((f) => f.type === 'checkmate');
  const forcedMate = line?.result === 'mate' || line?.result === 'mated';
  // the verdict of a Great / Forced move already says "the only good / legal move"
  const longFacts = ctx.label === 'great' || ctx.label === 'forced' ? all.long.filter((f) => f.type !== 'necessary') : all.long;
  const longLines: ToneLine[] = mates
    ? [{ text: 'The game is over.', tone: 'neutral' }]
    : forcedMate
      ? [{ text: 'There is a forced mate, so long-term features don\'t matter here.', tone: 'neutral' }]
      : longFacts
          .map((f) => ({ text: longFactText(f, ctx, all), tone: factTone(f, ctx.mover) }))
          .filter((l): l is ToneLine => !!l.text)
          .slice(0, MAX_LONG_SENTENCES);
  const level = (facts: readonly Fact[], lines: ToneLine[], kind: keyof typeof NOTHING): Level => {
    if (facts.length === 0) return { facts: [{ type: 'nothing-notable' }], text: [NOTHING[kind]], tones: ['neutral'] };
    if (!lines.length) return { facts: [...facts], text: [NOTHING[kind]], tones: ['neutral'] };
    return { facts: [...facts], text: lines.map((l) => l.text), tones: lines.map((l) => l.tone) };
  };
  const short = level(all.short, shortLines, 'short');
  if (told?.story && short.text[0] === told.text) short.story = told.story;
  return {
    immediate: level(all.immediate, orderByTone(immediateLines, ctx.label), 'immediate'),
    short,
    long: level(all.long, longLines, 'long'),
  };
}

// --- Suggestions vs the played move (M5c) -------------------------------------------------------------------------

/** Sentences that start with a verb read well after "Like Nf3, it …". */
const VERB_START = /^(Stops|Takes|Gives|Leaves|Attacks|Threatens|Defends|Saves|Castles|Develops|Blocks|Steps|Wins|Pins|Skewers|Uncovers|Prevents|Traps|Promotes|Sacrifices|Still|Starts|Misses|Allows|Doesn't)\b/;
const noPeriod = (s: string) => s.replace(/\.$/, '');

/**
 * (M5c) A suggestion (Try this / Engine's top) shown next to the played move: sentences it shares with the played
 * move's explanation are not repeated as if they were its point — its own sentences come first, the shared ones are
 * folded into one "Like Ba4, it also stops …" sentence (Immediate) or marked "— as after Ba4" (Long term).
 * `Level.facts` are unchanged.
 */
export function contrastWithPlayed(e: Explanation, played: Explanation, playedSan: string): Explanation {
  const pi = new Set(played.immediate.text);
  // (UI round) sentences travel with their tones
  const imm: ToneLine[] = e.immediate.text.map((text, i) => ({ text, tone: e.immediate.tones?.[i] ?? 'neutral' }));
  const shared = imm.filter((s) => pi.has(s.text));
  let immediate = imm;
  if (shared.length) {
    const own = imm.filter((s) => !pi.has(s.text));
    const verbs = shared.filter((s) => VERB_START.test(s.text));
    const rest = shared.filter((s) => !VERB_START.test(s.text));
    const folded: ToneLine[] = [];
    const verbPhrase = (s: string) => noPeriod(s.charAt(0).toLowerCase() + s.slice(1));
    // one folded sentence: its tone when all its parts agree, else neutral
    const oneTone = (ls: readonly ToneLine[]): Tone => (ls.every((l) => l.tone === ls[0]!.tone) ? ls[0]!.tone : 'neutral');
    if (verbs.length) folded.push({ text: `Like ${playedSan}, it ${own.length ? 'also ' : ''}${verbs.map((v) => verbPhrase(v.text)).join('; it also ')}.`, tone: oneTone(verbs) });
    for (const s of rest) folded.push(s.text === NOTHING.immediate ? { text: `Nothing special happens right away (as with ${playedSan}).`, tone: 'neutral' } : { text: `${noPeriod(s.text)}, as with ${playedSan}.`, tone: s.tone });
    immediate = [...own, ...folded];
  }
  const pl = new Set(played.long.text.filter((s) => s !== NOTHING.long));
  const long = e.long.text.map((s) => (pl.has(s) ? `${noPeriod(s)} — as after ${playedSan}.` : s));
  return {
    immediate: { ...e.immediate, text: immediate.map((l) => l.text), tones: immediate.map((l) => l.tone) },
    short: e.short,
    long: { ...e.long, text: long },
  };
}

// --- Comparison with the better move ------------------------------------------------------------------------------

const sameSquare = (a: PieceRef, b: PieceRef) => a.square === b.square && a.role === b.role;

/**
 * Why the better move is better, from its own verified facts (immediate + short line), as verb phrases
 * ("defends the pawn on f7", "attacks Black's pawn on b7 and wins it"). Only facts the played move doesn't
 * share; at most two.
 */
export function betterReasons(better: readonly Fact[], played: readonly Fact[], mover: Color, uci?: string): string[] {
  return betterReasonFacts(better, played, mover, uci).map((r) => r.phrase);
}

/** "creates a passed pawn on d5" — a long-term fact of the better move that is good for the mover, as a reason. */
function positionalReason(f: F<'positional'>, mover: Color): string | null {
  if (f.at) return null;
  const own = f.side !== 'opponent';
  const good = own ? f.delta > 0 : f.delta < 0;
  if (!good && own) return null;
  const opp = colorName(other(mover));
  const plural = (f.squares?.length ?? 0) > 1;
  switch (f.feature) {
    case 'passed-pawn':
      return own ? `creates ${plural ? 'passed pawns' : 'a passed pawn'}${onSquares(f.squares)}` : null;
    case 'open-file-rook':
      if (!own || !f.squares?.length) return null;
      return f.detail === 'open' ? `puts the rook${onSquares(f.squares)} on a fully open file` : `gives the rook${onSquares(f.squares)} a file without its own pawns`;
    case 'king-safety':
      return own ? `keeps ${colorName(mover)}'s king safer` : `exposes ${opp}'s king`;
    case 'isolated-pawn':
      return own ? null : `leaves ${opp} with ${plural ? 'isolated pawns' : 'an isolated pawn'}${onSquares(f.squares)}`;
    case 'doubled-pawn':
      return own ? null : `leaves ${opp} with doubled pawns${filesOf(f.squares)}`;
    case 'bishop-pair':
      return own ? `keeps the bishop pair` : `takes away ${opp}'s bishop pair`;
    case 'centre-control':
      return f.delta > 0 ? 'takes more control of the centre' : null;
    default:
      return null;
  }
}

/** A reason why the better move is better, with the verified size of its point (pawns; mate = MATE_REASON). */
export interface BetterReason {
  phrase: string;
  facts: Fact[];
  /** (M5c) Verified magnitude in pawns: checkmate / forced mate >= MATE_REASON, material won by its count, quiet reasons < 1. */
  magnitude: number;
}

/** (M5c) Magnitude of a mating reason (bigger than any material count). */
export const MATE_REASON = 100;

/** Second-best non-king target of a fork (the opponent saves the bigger one), or the best one with check. */
function forkValue(f: F<'fork'>): number {
  const v = f.targets.filter((t) => t.role !== 'king').map((t) => PIECE_VALUES[t.role]).sort((a, b) => b - a);
  return f.targets.some((t) => t.role === 'king') ? (v[0] ?? 0) : (v[1] ?? v[0] ?? 0);
}

/**
 * `betterReasons` with the fact behind each phrase (the 'misses' fact stores them). (M5c) Ranked by verified
 * magnitude — mate > material won (by its count) > threats / defences (by what they win or save) > quiet reasons —
 * so a big drop is explained by its biggest verified reason; at most two.
 */
export function betterReasonFacts(better: readonly Fact[], played: readonly Fact[], mover: Color, uci?: string, opts: { positional?: boolean; playedFenAfter?: string } = {}): BetterReason[] {
  const opp = colorName(other(mover));
  const tactical: BetterReason[] = [];
  const line = better.find((f): f is F<'line'> => f.type === 'line');
  const lineGain = line?.result === 'wins-material' ? Math.max(0, line.materialDelta - (line.owed ?? 0)) : 0;
  const has = (pred: (f: Fact) => boolean) => played.some(pred);
  let lineUsed = false;
  const quiet: BetterReason[] = [];
  const playedLineSteps = () => played.find((f): f is F<'line'> => f.type === 'line')?.steps ?? [];
  const add = (phrase: string, magnitude: number, facts: Fact[]) => tactical.push({ phrase, facts, magnitude });
  // (M5c) after the played move the piece on `sq` is not en prise (fxg3 removed the attacker of h2 too): saving it is no difference
  const safeAfterPlayed = (sq: string): boolean => {
    if (!opts.playedFenAfter) return false;
    const pos = positionFromFen(opts.playedFenAfter);
    const q = parseSquare(sq);
    const pc = q === undefined ? undefined : pos.board.get(q);
    return !!pc && pc.color === mover && hangingLoss(pos, q!) <= 0;
  };
  // (M5c) a defence (saving / defending a piece, stopping a threat) is worth what the played move actually loses —
  // when the played move deals with it too (its line loses nothing), it is a minor difference
  const playedL = played.find((f): f is F<'line'> => f.type === 'line');
  const playedLoss = playedL?.result === 'mated' ? MATE_REASON : playedL?.result === 'loses-material' ? -playedL.materialDelta : 0;
  const defence = (v: number) => (playedLoss > 0 ? Math.min(v, playedLoss) : 0.5);
  for (const f of better) {
    switch (f.type) {
      case 'checkmate':
        add('is checkmate', MATE_REASON * 10, [f]);
        break;
      case 'capture':
        // (round 6) not when the played move takes the same piece
        // (M5c) not when the line gives the gain back (axb5 "wins the queen", Bxd8 takes Black's queen at once): the line reason tells it
        if (f.outcome === 'wins-material' && !has((x) => x.type === 'capture' && x.captured.square === f.captured.square) && (!line || line.result === 'mate' || line.result === 'unclear' || line.materialDelta >= f.net)) add(`wins ${owned(f.captured)}`, f.net, [f]);
        break;
      case 'fork':
        if (has((x) => x.type === 'fork' && x.attacker.square === f.attacker.square && x.targets.length === f.targets.length && x.targets.every((t) => f.targets.some((u) => u.square === t.square)))) break;
        add(`forks ${targetsPhrase(f.targets)}`, Math.max(forkValue(f), lineGain), [f]);
        break;
      case 'skewer':
        add(`skewers ${owned(f.front)}`, Math.max(PIECE_VALUES[f.behind.role], lineGain), [f]);
        break;
      case 'pin':
        // (M5c) not a pin the played move makes on the same piece
        if (has((x) => x.type === 'pin' && x.pinned.square === f.pinned.square)) break;
        add(uci && f.pinner.square !== uci.slice(2, 4) ? `uncovers a pin on ${owned(f.pinned)}` : `pins ${owned(f.pinned)}`, Math.max(1, lineGain), [f]);
        break;
      case 'discovered-attack':
        if (has((x) => x.type === 'discovered-attack' && x.target.square === f.target.square)) break;
        add(`uncovers an attack on ${owned(f.target)}`, Math.max(1, lineGain), [f]);
        break;
      case 'defends-threat':
        if (!has((x) => x.type === 'defends-threat' && x.move === f.move)) add(f.mateIn ? `stops ${opp}'s mate threat (${f.san})` : `stops ${opp}'s threat ${f.san}`, f.mateIn ? defence(MATE_REASON) : defence(f.gain), [f]);
        break;
      case 'defend':
        if (!has((x) => (x.type === 'defend' && sameSquare(x.piece, f.piece)) || (x.type === 'escape' && x.from === f.piece.square)) && !safeAfterPlayed(f.piece.square)) add(`defends ${the(f.piece)}`, defence(PIECE_VALUES[f.piece.role]), [f]);
        break;
      case 'escape':
        // (M5b) the played move saving the same piece another way (defending it, or moving it) is no difference
        if (!has((x) => (x.type === 'escape' && x.from === f.from) || (x.type === 'defend' && x.piece.square === f.from)) && !safeAfterPlayed(f.from)) add(`saves the ${f.piece.role} on ${f.from}`, defence(PIECE_VALUES[f.piece.role]), [f]);
        break;
      case 'threat':
        if (!has((x) => x.type === 'threat' && x.move === f.move)) {
          // (M5c) a capture threat the better move's own line doesn't carry out (the piece steps away): it attacks, it doesn't win
          const cap = f.facts.find((x): x is F<'capture'> => x.type === 'capture');
          const carried = !line || line.steps.some((st) => st.color === mover && st.uci.slice(2, 4) === f.move.slice(2, 4) && st.facts.some((x) => x.type === 'capture')) || (line.result === 'wins-material' && line.materialDelta >= f.gain);
          // (the line goes with it, so the stored 'misses' facts re-render the same phrase)
          if (!f.mateIn && cap && !carried) {
            add(`attacks ${owned(cap.captured)}`, 0.8, [f, line!]);
            lineUsed = true;
          }
          else add(f.mateIn ? `threatens mate (${f.san})` : `threatens ${f.san}, ${threatPoint(f, 'ing')}`, f.mateIn ? MATE_REASON / 2 : f.gain, [f]);
        }
        break;
      case 'attack': {
        // only an attack the line really converts
        const wins = line?.result === 'wins-material' && line.steps.some((s) => s.color === mover && s.uci.slice(2, 4) === f.target.square && s.facts.some((x) => x.type === 'capture'));
        if (wins) {
          add(f.through ? `lines up behind ${the(f.through)} against ${owned(f.target)} and wins it` : `attacks ${owned(f.target)} and wins it`, Math.max(PIECE_VALUES[f.target.role], lineGain), [f, line!]);
          lineUsed = true;
        }
        break;
      }
      // quiet reasons (M5b): told only when there is no tactical one
      case 'trapped':
        quiet.push({ phrase: `traps ${owned(f.piece)}`, facts: [f], magnitude: PIECE_VALUES[f.piece.role] });
        break;
      case 'attack-pinned':
        if (!has((x) => x.type === 'attack-pinned' && sameSquare(x.pinned, f.pinned))) quiet.push({ phrase: `attacks ${owned(f.pinned)}, which is pinned`, facts: [f], magnitude: Math.max(1, lineGain) });
        break;
      case 'prevents':
        if (!has((x) => x.type === 'prevents' && x.move === f.move)) quiet.push({ phrase: `prevents ${moveName(f.san, other(mover))}`, facts: [f], magnitude: 0.9 });
        break;
      case 'castle':
        if (!has((x) => x.type === 'castle')) quiet.push({ phrase: `castles ${f.side === 'king' ? 'kingside' : 'queenside'}`, facts: [f], magnitude: 0.3 });
        break;
      case 'develop':
        // (M5c) not when the played move's own line makes the same developing move (Qf3 O-O-O Nc3)
        if (!has((x) => x.type === 'develop') && !(uci && playedLineSteps().some((st) => st.color === mover && st.uci === uci))) quiet.push({ phrase: `develops the ${f.piece.role}`, facts: [f], magnitude: 0.2 });
        break;
      case 'positional': {
        // (M5b) long-term reasons only where the loss is small (an Inaccuracy): a Mistake / Blunder isn't explained by pawn structure
        const p = opts.positional === false ? null : positionalReason(f, mover);
        const shared = has((x) => x.type === 'positional' && x.feature === f.feature && (x.side ?? '') === (f.side ?? '') && Math.sign(x.delta) === Math.sign(f.delta));
        if (p && !shared) quiet.push({ phrase: p, facts: [f], magnitude: 0.4 });
        break;
      }
      default:
        break;
    }
  }
  const playedLine = played.find((f): f is F<'line'> => f.type === 'line');
  // a line result the played move matches is no reason ("leads to winning a pawn" when both win a pawn)
  const playedAsGood = !!line && !!playedLine && playedLine.result === line.result && playedLine.materialDelta >= line.materialDelta;
  // (M5c) a perpetual check the better move forces (the played move doesn't draw that way)
  const playedDraws = playedLine?.draw === 'perpetual' && playedLine.drawBy === mover;
  if (line && line.draw === 'perpetual' && line.drawBy === mover && !playedDraws) add('forces a draw by perpetual check', MATE_REASON / 4, [line]);
  if (line && !lineUsed && !playedAsGood && !tactical.some((r) => r.phrase.startsWith('wins'))) {
    if (line.result === 'mate' && line.mateIn) add(`forces mate in ${line.mateIn}`, MATE_REASON * 2, [line]);
    else if (line.result === 'wins-material' && (line.owed ?? 0) > 0 && line.materialDelta > line.owed!) {
      // (M5c) part of the gain only wins back what the opponent just took
      const more = line.materialDelta - line.owed!;
      add(`wins back the material and ${more === 1 ? 'a pawn' : 'some'} more`, more, [line]);
    }
    else if (line.result === 'wins-material' && line.won?.length && !line.lost?.length) {
      // (M5b) the mover started behind and only makes up the deficit: "winning back"
      const start = line.balance !== undefined ? line.balance - line.materialDelta : 0;
      add(`leads to winning ${start < 0 && line.materialDelta <= -start ? 'back ' : ''}${piecesPhrase(line.won)}`, line.materialDelta, [line]);
    }
    else if (line.result === 'wins-material' && line.won?.length && line.won.length <= 2 && (line.lost?.length ?? 0) <= 2) add(`leads to winning ${piecesPhrase(line.won)} for ${piecesPhrase(line.lost!)}`, line.materialDelta, [line]);
    else if (line.result === 'wins-material') add(`wins ${material(line.materialDelta)} a few moves later`, line.materialDelta, [line]);
  }
  const seen = new Set<string>();
  const pool = (tactical.length ? tactical : quiet).filter((r) => !seen.has(r.phrase) && !!seen.add(r.phrase));
  // the two biggest (stable: equal magnitudes keep the fact order), told biggest first — a capture by the move itself
  // first ("wins the knight and threatens Rxe2")
  const top = pool.map((r, i) => ({ r, i })).sort((a, b) => b.r.magnitude - a.r.magnitude || a.i - b.i).slice(0, 2);
  const isCap = (r: BetterReason) => r.facts[0]?.type === 'capture';
  return top.sort((a, b) => Number(isCap(b.r)) - Number(isCap(a.r)) || b.r.magnitude - a.r.magnitude || a.i - b.i).map((x) => x.r);
}

/**
 * (M5c) The verified reasons are small next to the eval drop (together they are worth less than half of it, the drop is at
 * least PARTIAL_MIN_DROP pawns), or a Mistake / Blunder / Miss has only quiet reasons: the text adds that the engine sees
 * more than this.
 */
export const PARTIAL_MIN_DROP = 2;
export function reasonsArePartial(reasons: readonly BetterReason[], dropPawns: number, bigLabel = false): boolean {
  if (!reasons.length) return false;
  // a Mistake / Blunder / Miss explained only by a quiet reason (develops, castles, a file, prevents): always hedged
  if (bigLabel && reasons.every((r) => r.magnitude < 1)) return true;
  if (dropPawns < PARTIAL_MIN_DROP) return false;
  // a mating reason (or stopping a mate) is the whole story
  if (reasons.some((r) => r.magnitude >= MATE_REASON)) return false;
  const told = reasons.reduce((sum, r) => sum + r.magnitude, 0);
  return told < dropPawns / 2;
}

/** Render the reasons stored in a 'misses' fact (they were selected by `betterReasonFacts`). */
function missesReasons(f: F<'misses'>, mover: Color): string[] {
  return betterReasonFacts(f.facts, [], mover, f.uci).map((r) => r.phrase);
}

// --- Label --------------------------------------------------------------------------------------------------------

export const LABEL_NAMES: Readonly<Record<Label, string>> = {
  forced: 'Forced',
  book: 'Book',
  best: 'Best',
  great: 'Great !',
  excellent: 'Excellent',
  good: 'Good',
  inaccuracy: 'Inaccuracy ?!',
  mistake: 'Mistake ?',
  miss: 'Miss',
  blunder: 'Blunder ??',
};

const pct = (x: number) => `${Math.round(x)}%`;

export type LabelTextInput = Pick<MoveAnalysis, 'label' | 'labelReason' | 'color' | 'evalBefore' | 'evalAfter' | 'winBefore' | 'winAfter' | 'winLoss' | 'uci'> & {
  bestSan: string;
  bestUci: string;
  checkmate?: boolean;
  /** Verb phrases why the best move is better (`betterReasons`). */
  better?: readonly string[];
  /** (M5c) The reasons in `better` are small next to the eval drop (`reasonsArePartial`). */
  betterPartial?: boolean;
  /** The played move (SAN), named in the material sentence. */
  san?: string;
  /** The played move's own verified 'hangs' fact (Immediate level), if any. */
  verifiedHang?: { piece: PieceRef; loss: number; already?: boolean } | null;
};

const mateIn = (n: number): string => (n === 1 ? 'mate in one' : `a forced mate in ${n}`);

/** One or two sentences: label name + why (mover-neutral). */
export function labelText(a: LabelTextInput, settings: AnalysisSettings): string {
  const me = colorName(a.color);
  const opp = colorName(other(a.color));
  const name = LABEL_NAMES[a.label];
  const loss = `${MINUS}${Math.round(a.winLoss)}% winning chances`;
  // the label is decided by winLoss (one deep search), so quote that drop rather than the eval after the move
  const chances = `${me}'s winning chances go from ${pct(a.winBefore)} to ${pct(Math.max(0, a.winBefore - a.winLoss))}`;
  const isBestMove = a.uci === a.bestUci;
  const m = a.labelReason.material;
  const materialDecides = m?.label !== undefined && m.label === a.label && a.labelReason.winChance !== a.label;
  const why = a.better?.length ? ` ${a.bestSan} ${a.better[0]}${a.better[1] ? `, and it ${a.better[1]}` : ''}${a.betterPartial ? ' — but there is more to it than that' : ''}.` : '';
  switch (a.label) {
    case 'forced':
      return `${name} — the only legal move.`;
    case 'book': {
      const b = a.labelReason.book;
      return b ? `${name} — a known opening move (${b.name}, ${b.eco}).` : `${name} — a known opening move.`;
    }
    case 'best':
      if (a.checkmate) return `${name} — checkmate!`;
      return isBestMove ? `${name} — the best move.` : `${name} — as good as the best move (${a.bestSan}).`;
    case 'great':
      return `${name} — the only good move here: the next best loses ${Math.round(a.labelReason.great?.secondBestLoss ?? 0)}% winning chances.`;
    case 'excellent':
      return `${name} — almost as good as the best move ${a.bestSan} (${loss}).`;
    case 'good':
      return `${name} — a little weaker than ${a.bestSan} (${loss}).`;
    case 'inaccuracy':
      return `${name} — ${a.bestSan} was better (${loss}).${why}`;
    case 'miss':
      if (a.labelReason.missedMate) return `${name} — ${a.bestSan} was ${mateIn(a.labelReason.missedMate.mateIn)}, and this move doesn't force mate (${loss}).`;
      return `${name} — ${opp}'s last move was a mistake, and ${a.bestSan} would have punished it (${loss}).${why}`;
    case 'mistake':
    case 'blunder': {
      // M3 mate rules: an allowed / missed short mate is the reason, even when win% hardly moves
      const am = a.labelReason.allowedMate;
      if (am && a.label === 'blunder') {
        const avoid = am.bestMatedIn ? `${a.bestSan} would have lasted ${am.bestMatedIn} moves` : `${a.bestSan} would have avoided it`;
        const already = a.labelReason.winChance !== 'blunder' ? ` ${me} was already losing, but ${avoid} — watch for mating threats.` : ` ${avoid}.`;
        return `${name} — this allows ${am.matedIn === 1 ? 'mate in one' : `a forced mate in ${am.matedIn}`}.${already}`;
      }
      if (a.labelReason.missedMate && a.label === 'blunder') return `${name} — ${a.bestSan} was ${mateIn(a.labelReason.missedMate.mateIn)}. ${capitalize(chances)}.`;
      // the hung piece is named only from the move's own verified 'hangs' fact (a piece standing on that square
      // after the move, confirmed by the engine line), with that fact's number; otherwise the line's net loss
      const vh = a.verifiedHang;
      const lossText = vh ? `${vh.already ? "does not save" : "leaves"} ${the(vh.piece)}${vh.already ? ", which is still hanging" : " hanging"} (${points(-vh.loss)})` : m ? `loses material: with best play it ends ${Math.abs(m.loss)} ${Math.abs(m.loss) === 1 ? "point" : "points"} worse than after ${a.bestSan}` : '';
      // (M5b) the engine sees a forced mate against the mover after this move (longer than the mate rule's 3): that
      // is the reason, not the material count
      const after = a.evalAfter.mate !== undefined ? (a.color === 'white' ? a.evalAfter.mate : -a.evalAfter.mate) : undefined;
      if (materialDecides && m && after !== undefined && after < 0 && a.evalBefore.mate === undefined) {
        return `${name} — ${a.san ? `${a.san} ` : 'this '}allows a forced mate in ${-after}. ${capitalize(chances)}.${why}`;
      }
      if (materialDecides && m) {
        const still = a.winAfter >= settings.suggest.winningMin
          ? ` ${me} is still winning (eval ${formatEval(a.evalBefore)} → ${formatEval(a.evalAfter)}), but this is the habit to fix.`
          : ` ${chances}.`;
        return `${name} — ${a.san ? `${a.san} ` : ''}${lossText}.${still}${why}`;
      }
      const hung = vh && m?.label ? `: ${a.san ?? 'the move'} ${lossText}` : '';
      return `${name} — ${a.bestSan} was much better${hung}.${why} ${capitalize(chances)}.`;
    }
  }
}

/** Caption for a confirmed move (Book / Forced / Best / Great); null for labels that get a suggestion. */
export function verdictText(label: Label, playedIsBest: boolean): string | null {
  switch (label) {
    case 'book':
      return 'Opening theory.';
    case 'forced':
      return 'The only legal move.';
    case 'great':
      return 'Great find — the only good move here.';
    case 'best':
      return playedIsBest ? 'This was the best move.' : "As good as the best move.";
    default:
      return null;
  }
}

// --- Suggestion captions (UI / report) -----------------------------------------------------------------------

export const SUGGESTION_TEXT = {
  deepOnly: 'a deep move — hard to explain',
  lossVsBest: (winLoss: number): string => (winLoss < 0.5 ? "as good as the best move" : `${MINUS}${winLoss.toFixed(1)}% winning chances vs the best move`),
} as const;
