// The ONLY place that produces prose. Facts (data) -> short, plain English for a beginner.
//
// Rules
//  - Mover-neutral: the same text is shown for both sides' moves, so it names colours ("Attacks Black's queen"),
//    never "you". The subject of an Immediate sentence is the move itself ("Wins…", "Leaves…").
//  - Nothing is stated that isn't in the facts (piece names, squares, numbers all come from fact fields).
//  - Material numbers are points from the mover's point of view (pawn = 1, knight/bishop = 3, rook = 5,
//    queen = 9): "(+3 points)" = the mover gains 3, "(−1 point)" = loses one.
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

import type { AnalysisSettings, Color, Explanation, Fact, Label, Level, LineStep, MoveAnalysis, PieceRef, PieceRole, Score } from '@chess-coach/shared';
import { PIECE_VALUES } from '../chess/material';

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
  'checkmate', 'stalemate', 'allows', 'allows-mate', 'hangs', 'fork', 'skewer', 'discovered-attack', 'pin', 'capture', 'promotion', 'check',
  'defends-threat', 'threat', 'attack', 'escape', 'defend', 'escape-check', 'block-check', 'castle', 'develop',
];

function targetsPhrase(targets: readonly PieceRef[]): string {
  // "Black's king on e8 and rook on a8" (targets of one colour)
  const color = targets[0]?.color ?? 'black';
  return `${colorName(color)}'s ${joinList(targets.map((t) => `${t.role} on ${t.square}`))}`;
}

function captureText(f: F<'capture'>): string {
  const c = owned(f.captured);
  switch (f.outcome) {
    case 'wins-material':
      return f.net >= PIECE_VALUES[f.captured.role]
        ? `Wins ${c} (${points(f.net)})` // (no "for free": SEE can win a defended pawn too)
        : `Takes ${c} and comes out ahead in the exchange of pieces (${points(f.net)})`;
    case 'even-trade':
      return `Takes ${c} — an even trade`;
    case 'recapture':
      return `Takes back: captures ${c}`;
    case 'loses-material':
      return `Takes ${c}, but loses material when the pieces are traded off (${points(f.net)})`;
  }
}

/** What a threat does: verb phrase in -ing form or base form ("forking …" / "fork …"), with the gain. */
function threatPoint(f: { gain: number; facts: readonly Fact[] }, form: 'ing' | 'base', forWhom?: string): string {
  const gain = forWhom ? `(${points(f.gain)} for ${forWhom})` : `(${points(f.gain)})`;
  const v = (ing: string, base: string) => (form === 'ing' ? ing : base);
  const tactic = f.facts.find((x) => x.type === 'fork' || x.type === 'skewer' || x.type === 'discovered-attack');
  if (tactic?.type === 'fork') return `${v('forking', 'fork')} ${targetsPhrase(tactic.targets)} ${gain}`;
  if (tactic?.type === 'skewer') return `${v('skewering', 'skewer')} ${owned(tactic.front)} ${gain}`;
  if (tactic?.type === 'discovered-attack') return `${v('uncovering', 'uncover')} an attack on ${owned(tactic.target)} ${gain}`;
  const cap = f.facts.find((x): x is F<'capture'> => x.type === 'capture');
  if (cap && f.gain === PIECE_VALUES[cap.captured.role]) return `${v('winning', 'win')} ${an(cap.captured.role)} ${gain}`;
  return `${v('winning', 'win')} material ${gain}`;
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
  // the gain is the opponent's: shown from their side, e.g. "which would win a knight (+3 points for Black)"
  return `Stops ${opp}'s threat ${f.san}, which would ${threatPoint(f, 'base', opp)}`;
}

/** The refutation: "Allows Qb3, attacking Black's pawns on b7 and f7 at once". `hung`: merged hang, if any. */
export function allowsText(f: F<'allows'>, ctx: ExplainContext): string {
  const r = f.reply.san;
  const opp = colorName(other(ctx.mover));
  // the reply worked before the move too: the move simply doesn't deal with it
  const verb = f.already ? "Doesn't stop" : 'Allows';
  if (f.facts.some((x) => x.type === 'checkmate')) return `${verb} checkmate: ${r}`;
  // what the reply's own piece does …
  const direct: string[] = [];
  const cap = f.facts.find((x): x is F<'capture'> => x.type === 'capture');
  const tactic = f.facts.find((x) => x.type === 'fork' || x.type === 'skewer' || x.type === 'discovered-attack' || x.type === 'pin');
  if (tactic?.type === 'fork') direct.push(`forking ${targetsPhrase(tactic.targets)}`);
  else if (tactic?.type === 'skewer') direct.push(`skewering ${owned(tactic.front)} (when it moves, ${the(tactic.behind)} can be taken)`);
  else if (tactic?.type === 'discovered-attack') direct.push(`uncovering an attack on ${owned(tactic.target)}`);
  else if (tactic?.type === 'pin' && tactic.pinner.square !== f.reply.uci.slice(2, 4)) direct.push(`uncovering a pin by ${the(tactic.pinner)} on ${owned(tactic.pinned)}`);
  else if (tactic?.type === 'pin') direct.push(tactic.absolute ? `pinning ${owned(tactic.pinned)} to the king` : `pinning ${owned(tactic.pinned)} to the ${tactic.behind.role} behind it`);
  if (cap) direct.push(`winning ${owned(cap.captured)} (${points(-cap.net)})`);
  // … and what it leaves the mover facing (the attackers may be other pieces: told as a situation, not as the
  // reply piece's attack)
  const then: string[] = [];
  const threat = f.facts.find((x): x is F<'threat'> => x.type === 'threat');
  const targets = f.targets ?? [];
  const threatOnTarget = !!threat && !threat.mateIn && targets.some((t) => t.square === threat.move.slice(2, 4));
  if (targets.length >= 2) then.push(`${piecesOn(targets)} are both under attack`);
  else if (targets.length === 1 && !threatOnTarget) then.push(`${owned(targets[0]!)} is under attack`);
  if (threat) {
    if (threat.mateIn === 1) then.push(`${opp} threatens checkmate with ${threat.san}`);
    else if (threat.mateIn) then.push(`${opp} threatens a forced mate starting with ${threat.san}`);
    else if (!(targets.length >= 2 && threatOnTarget)) then.push(`${opp} threatens ${threat.san}, ${threatPoint(threat, 'ing', opp)}`);
  }
  const check = f.facts.some((x) => x.type === 'check') ? ' (check)' : '';
  let s = `${verb} ${r}${direct.length ? '' : check}`;
  if (direct.length) s += `, ${joinList(direct.slice(0, 2))}${check ? ', with check' : ''}`;
  if (then.length) s += `: then ${joinList(then.slice(0, 2))}`;
  if (f.mateIn !== undefined) s += ` — it starts a forced mate in ${f.mateIn} for ${opp}`;
  else if (!direct.length && !then.length && (f.gain ?? 0) >= 1) s += ` — in the engine line this costs ${colorName(ctx.mover)} ${points(f.gain!).replace(/^\+/, '')}`;
  return s;
}

function immediateFactText(f: Fact, ctx: ExplainContext): string | null {
  const opp = colorName(other(ctx.mover));
  switch (f.type) {
    case 'checkmate':
      return `Checkmate — ${colorName(ctx.mover)} wins`;
    case 'stalemate':
      return `Stalemate — ${opp} has no legal move and is not in check, so the game is a draw`;
    case 'check':
      return f.double ? 'Double check — the king has to move' : f.discovered ? 'Discovered check: moving this piece opens a line to the king' : 'Gives check';
    case 'capture':
      return captureText(f);
    case 'promotion':
      return `Promotes the pawn to ${an(f.to)}`;
    case 'castle':
      return `Castles ${f.side === 'king' ? 'kingside' : 'queenside'}`;
    case 'develop':
      return `Develops the ${f.piece.role} to ${f.piece.square}`;
    case 'attack':
      // a bigger piece attacked by a smaller one has to move whether defended or not: say so, not "undefended"
      return f.reason === 'undefended' && PIECE_VALUES[f.target.role] <= PIECE_VALUES[f.attacker.role] ? `Attacks ${owned(f.target)}, which is undefended` : `Attacks ${owned(f.target)} with ${an(f.attacker.role)}`;
    case 'fork':
      return `Fork: ${the(f.attacker)} attacks ${targetsPhrase(f.targets)} at once`;
    case 'pin':
      if (ctx.uci && f.pinner.square !== ctx.uci.slice(2, 4)) return `Uncovers a pin: ${the(f.pinner)} now pins ${owned(f.pinned)} to the ${f.absolute ? 'king' : `${f.behind.role} on ${f.behind.square}`}`;
      return f.absolute
        ? `Pins ${owned(f.pinned)} to the king — it is not allowed to move`
        : `Pins ${owned(f.pinned)} to the ${f.behind.role} on ${f.behind.square} — if it moves, the ${f.behind.role} can be taken`;
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
      return f.already
        ? `Leaves ${the(f.piece)} hanging — it was already attacked and ${opp} can still win it (${points(-f.loss)})`
        : `Leaves ${the(f.piece)} hanging: ${opp} can win it (${points(-f.loss)})`;
    case 'allows-mate':
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

function renderImmediate(facts: readonly Fact[], ctx: ExplainContext, line?: F<'line'>): string[] {
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
  // "stops the threat on X" and "saves / defends X" say the same thing once
  const stopped = new Set(fs.filter((f): f is F<'defends-threat'> => f.type === 'defends-threat').map((f) => f.move.slice(2, 4)));
  fs = fs.filter((f) => !((f.type === 'escape' && stopped.has(f.from)) || (f.type === 'defend' && stopped.has(f.piece.square))));
  if (paysOff) {
    // the sacrificed piece's other attacks are beside the point
    const offered = new Set(fs.filter((f): f is F<'hangs'> => f.type === 'hangs' && !f.already).map((f) => f.piece.square));
    fs = fs.filter((f) => !(f.type === 'attack' && offered.has(f.attacker.square)));
  }
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
  }
  fs = fs.filter((f) => !(f.type === 'attack' && covered.has(f.target.square)));
  // an attack whose capture is exactly the verified threat: the threat sentence says it (with the gain)
  const threatTo = fs.find((f): f is F<'threat'> => f.type === 'threat' && !f.mateIn)?.move.slice(2, 4);
  if (threatTo) fs = fs.filter((f) => !(f.type === 'attack' && f.target.square === threatTo));

  // the refutation merged with what it refutes: a hang the reply takes, a mate in one the reply delivers
  const merged = new Map<Fact, string>();
  if (allows) {
    const cap = allows.facts.find((x): x is F<'capture'> => x.type === 'capture');
    const hang = cap && fs.find((f): f is F<'hangs'> => f.type === 'hangs' && f.piece.square === cap.captured.square);
    if (hang) {
      const opp = colorName(other(ctx.mover));
      merged.set(hang, `${hang.already ? "Still leaves" : "Leaves"} ${the(hang.piece)} hanging: ${opp} takes it with ${allows.reply.san} (${points(-hang.loss)})`);
      fs = fs.filter((f) => f !== allows);
    }
    // one mate sentence: the refutation already says "can force mate"
    if (allows.facts.some((x) => x.type === 'checkmate') || allows.mateIn !== undefined) fs = fs.filter((f) => f.type !== 'allows-mate');
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
      fs = fs.filter((f) => f !== allows);
    } else merged.set(givenBack, base);
  }

  const rank = (t: Fact['type']) => {
    const i = IMMEDIATE_ORDER.indexOf(t);
    return i < 0 ? IMMEDIATE_ORDER.length : i;
  };
  fs = fs.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f.type) - rank(b.f.type) || a.i - b.i).map((x) => x.f);
  // a merged hang leads like the refutation would have
  const lead = [...merged.keys()];
  fs = [...lead, ...fs.filter((f) => !merged.has(f))];

  const out: string[] = [];
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
        out.push(`Attacks ${targetsPhrase(group.map((g) => g.target))} at once`);
        continue;
      }
    }
    let text = merged.get(f) ?? immediateFactText(f, ctx);
    if (paysOff && f.type === 'hangs' && !f.already) text = `Sacrifices ${the(f.piece)} (${points(-f.loss)}) — ${paysOff}`;
    if (paysOff && f.type === 'capture' && f.outcome === 'loses-material') text = `Takes ${owned(f.captured)} as a sacrifice (${points(f.net)}) — ${paysOff}`;
    if (!text) continue;
    if (f === capture && check && !check.double && !check.discovered && !merged.has(f)) text += ', with check';
    out.push(text);
  }
  // a move that starts a forced mate: that is the point, told first
  if (line?.result === 'mate' && line.mateIn && line.mateIn > 1 && !fs.some((f) => f.type === 'checkmate') && !out.some((s) => s.includes('mate'))) out.unshift(`Starts a forced mate in ${line.mateIn}`);
  return out.slice(0, MAX_SENTENCES).map((s) => `${s}.`);
}

// --- Short term ---------------------------------------------------------------------------------------------------

/** The step fact to narrate: taking a piece (worth 3+) beats "uncovers an attack" / "pins" / "attacks". */
function stepMainFact(step: LineStep): Fact | undefined {
  const facts = step.facts.filter((x) => x.type !== 'check');
  const big = facts.find((x) => x.type === 'capture' && PIECE_VALUES[x.captured.role] >= 3);
  const mate = facts.find((x) => x.type === 'checkmate');
  const fork = facts.find((x) => x.type === 'fork');
  const block = facts.find((x) => x.type === 'block-check');
  return mate ?? fork ?? big ?? block ?? facts[0];
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
      return ` forks the ${joinList(f.targets.map((t) => t.role))}`;
    case 'skewer':
      return ` skewers the ${f.front.role} and ${f.behind.role}`;
    case 'pin':
      // a pin made by another piece (the move opened its line) is uncovered, not made by the moving piece
      if (f.pinner.square !== step.uci.slice(2, 4)) return ` uncovers a pin: the ${f.pinner.role} on ${f.pinner.square} pins the ${f.pinned.role} to the ${f.absolute ? 'king' : f.behind.role}`;
      return f.absolute ? ` pins the ${f.pinned.role} to the king` : ` pins the ${f.pinned.role} to the ${f.behind.role}`;
    case 'discovered-attack':
      return ` uncovers an attack on the ${f.target.role}`;
    case 'capture':
      // by the running balance of the line: a capture of a bigger piece than was lost is no plain take-back
      if (back ?? f.outcome === 'recapture') return ' takes back';
      if (mayWin && f.outcome === 'wins-material' && f.net >= PIECE_VALUES[f.captured.role]) return ` wins the ${f.captured.role}`;
      return ` takes the ${f.captured.role}`;
    case 'promotion':
      return ` promotes to ${an(f.to)}`;
    case 'attack':
      return ` attacks the ${f.target.role}`;
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
  const d = `(${points(line.materialDelta)})`;
  const isExchange = (a: readonly PieceRole[], b: readonly PieceRole[]) => a.length === 1 && a[0] === 'rook' && b.length === 1 && (b[0] === 'knight' || b[0] === 'bishop');
  // "wins back": the mover started behind and the gain only makes up (part of) that deficit
  const start = line.balance !== undefined ? line.balance - line.materialDelta : null;
  const firstIsRecapture = start !== null ? start < 0 && line.materialDelta <= -start : !!line.steps[0]?.facts.some((f) => f.type === 'capture' && f.outcome === 'recapture');
  if (line.result === 'wins-material' && firstIsRecapture && !(won.length > 0 && won.length <= 2 && lost.length <= 2)) return `${who} wins back material ${d}`;
  if (line.result === 'wins-material') {
    if (isExchange(won, lost)) return `${who} wins the exchange — a rook for ${an(lost[0]!)} ${d}`;
    if (lost.length === 0 && won.length > 0 && won.length <= 2) return `${who} ${firstIsRecapture ? 'wins back' : 'wins'} ${piecesPhrase(won)} ${d}`;
    if (won.length > 0 && won.length <= 2 && lost.length <= 2) return `${who} ${firstIsRecapture ? 'wins back' : 'wins'} ${piecesPhrase(won)} for ${piecesPhrase(lost)} ${d}`;
    return `${who} comes out ahead in material ${d}`;
  }
  if (isExchange(lost, won)) return `${who} loses the exchange — a rook for ${an(won[0]!)} ${d}`;
  if (won.length === 0 && lost.length > 0 && lost.length <= 2) return `${who} loses ${piecesPhrase(lost)} ${d}`;
  if (lost.length > 0 && lost.length <= 2 && won.length <= 2) return `${who} gives ${piecesPhrase(lost)} for ${piecesPhrase(won)} ${d}`;
  return `${who} ends up behind in material ${d}`;
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
  if (f.type === 'checkmate' || f.type === 'fork' || f.type === 'skewer' || f.type === 'promotion') return 4;
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
}

function storyUnits(steps: readonly LineStep[], result?: F<'line'>['result']): Unit[] {
  const mover = steps[0]?.color;
  // "wins" only for the side that comes out of the line ahead: a pawn grab that loses a knight just "takes"
  const mayWin = (s: LineStep) => (s.color === mover ? result === 'wins-material' || result === 'mate' : result === 'loses-material' || result === 'mated');
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
    const back = cap.outcome === 'recapture' && (i === 0 || sameKind || (side < 0 && side + v <= 0));
    bal += s.color === mover ? v : -v;
    return back;
  });
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const traded = i >= 1 ? tradeAt(steps, i) : null; // the move itself always stands alone
    if (traded && traded !== 'pawn') {
      const t = steps[i + 1]!;
      units.push({ from: i, to: i + 1, text: `${s.san} ${t.san} (${traded === 'king' ? 'kings' : `${traded}s`} are traded)`, weight: 3 });
      i++;
      continue;
    }
    units.push({ from: i, to: i, text: `${s.san}${stepClause(s, mayWin(s), backAt[i])}${s.forced ? ' (forced)' : ''}`, weight: stepWeight(s) });
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
  const fixed = new Set([0, 1, last].filter((i) => i >= 0 && i <= last));
  const rest = units.map((u, i) => ({ u, i })).filter(({ u, i }) => !fixed.has(i) && u.weight > 0);
  rest.sort((a, b) => b.u.weight - a.u.weight || a.i - b.i);
  const chosen = new Set([...fixed, ...rest.slice(0, Math.max(0, MAX_SHOWN_STEPS - fixed.size)).map((x) => x.i)]);
  return units.filter((_, i) => chosen.has(i));
}

/** "material is level", "White is a pawn up", "Black is 3 points up" (balance = mover POV). */
function balanceText(balance: number, mover: Color): string {
  if (balance === 0) return 'material is level';
  const who = colorName(balance > 0 ? mover : other(mover));
  const n = Math.abs(balance);
  return `${who} is ${n === 1 ? 'a pawn' : `${n} points`} up`;
}

export function lineText(line: F<'line'>, ctx: ExplainContext): string {
  const mover = ctx.mover;
  const story = line.steps.some((s) => s.forced || s.facts.length > 0);
  if (!story && (line.result === 'quiet' || line.result === 'trade' || line.result === 'unclear')) return 'No forcing follow-up.';
  const parts: string[] = [];
  let prevTo = -1;
  for (const u of shownUnits(line.steps, line.result)) {
    if (u.from > prevTo + 1) parts.push('…');
    parts.push(u.text);
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
      // point); material is level" = a gambit pawn given back)
      result = materialResult(line, mover);
      const start = line.balance !== undefined ? line.balance - line.materialDelta : 0;
      if (line.balance !== undefined && start !== 0) result += `; ${balanceText(line.balance, mover)}`;
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
  return `${[...parts, ...(result ? [result] : [])].join(' → ')}.`;
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
      s = good ? `${who} gets the bishop pair (both bishops against fewer)` : `${who} gives up the bishop pair (both bishops)`;
      if (!own && !good) s = `${who} loses the bishop pair (both bishops)`;
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
      if (line && line.materialDelta < 0) return `${me} gives up material, but the engine sees about ${pawns} pawns' worth of compensation in the position.`;
      return `The engine rates ${me}'s position about ${pawns} pawns better than the material count suggests.`;
    }
    case 'deep-payoff':
      return 'The payoff is far away: a quick engine look rates this move lower — only a deep search sees why it works.';
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

export function renderExplanation(all: AllFacts, ctx: ExplainContext): Explanation {
  const line = all.short.find((f): f is F<'line'> => f.type === 'line');
  const immediateText = renderImmediate(all.immediate.filter((f) => f.type !== 'nothing-notable'), ctx, line);
  // Book: opening theory needs no narration unless the move itself is forcing
  const bookQuiet = ctx.label === 'book' && !!line && !(line.steps[0]?.facts.length) && !all.immediate.some((f) => f.type === 'threat');
  const shortText = line && line.steps.length > 0 ? [bookQuiet ? NOTHING.short : lineText(line, ctx)] : [];
  const mates = all.immediate.some((f) => f.type === 'checkmate');
  const forcedMate = line?.result === 'mate' || line?.result === 'mated';
  // the verdict of a Great / Forced move already says "the only good / legal move"
  const longFacts = ctx.label === 'great' || ctx.label === 'forced' ? all.long.filter((f) => f.type !== 'necessary') : all.long;
  const longText = mates
    ? ['The game is over.']
    : forcedMate
      ? ['There is a forced mate, so long-term features don\'t matter here.']
      : longFacts.map((f) => longFactText(f, ctx, all)).filter((t): t is string => !!t).slice(0, MAX_LONG_SENTENCES);
  const level = (facts: readonly Fact[], text: string[], kind: keyof typeof NOTHING): Level => {
    if (facts.length === 0) return { facts: [{ type: 'nothing-notable' }], text: [NOTHING[kind]] };
    return { facts: [...facts], text: text.length ? text : [NOTHING[kind]] };
  };
  return {
    immediate: level(all.immediate, immediateText, 'immediate'),
    short: level(all.short, shortText, 'short'),
    long: level(all.long, longText, 'long'),
  };
}

// --- Comparison with the better move ------------------------------------------------------------------------------

const sameSquare = (a: PieceRef, b: PieceRef) => a.square === b.square && a.role === b.role;

/**
 * Why the better move is better, from its own verified facts (immediate + short line), as verb phrases
 * ("defends the pawn on f7", "attacks Black's pawn on b7 and wins it"). Only facts the played move doesn't
 * share; at most two.
 */
export function betterReasons(better: readonly Fact[], played: readonly Fact[], mover: Color): string[] {
  const opp = colorName(other(mover));
  const out: string[] = [];
  const line = better.find((f): f is F<'line'> => f.type === 'line');
  const has = (pred: (f: Fact) => boolean) => played.some(pred);
  let lineUsed = false;
  for (const f of better) {
    switch (f.type) {
      case 'checkmate':
        out.push('is checkmate');
        break;
      case 'capture':
        if (f.outcome === 'wins-material') out.push(`wins ${owned(f.captured)}`);
        break;
      case 'fork':
        out.push(`forks ${targetsPhrase(f.targets)}`);
        break;
      case 'skewer':
        out.push(`skewers ${owned(f.front)}`);
        break;
      case 'pin':
        out.push(`pins ${owned(f.pinned)}`);
        break;
      case 'discovered-attack':
        out.push(`uncovers an attack on ${owned(f.target)}`);
        break;
      case 'defends-threat':
        if (!has((x) => x.type === 'defends-threat' && x.move === f.move)) out.push(f.mateIn ? `stops ${opp}'s mate threat (${f.san})` : `stops ${opp}'s threat ${f.san}`);
        break;
      case 'defend':
        if (!has((x) => x.type === 'defend' && sameSquare(x.piece, f.piece))) out.push(`defends ${the(f.piece)}`);
        break;
      case 'escape':
        if (!has((x) => x.type === 'escape' && x.from === f.from)) out.push(`saves the ${f.piece.role} on ${f.from}`);
        break;
      case 'threat':
        if (!has((x) => x.type === 'threat' && x.move === f.move)) out.push(f.mateIn ? `threatens mate (${f.san})` : `threatens ${f.san}, ${threatPoint(f, 'ing')}`);
        break;
      case 'attack': {
        // only an attack the line really converts
        const wins = line?.result === 'wins-material' && line.steps.some((s) => s.color === mover && s.uci.slice(2, 4) === f.target.square && s.facts.some((x) => x.type === 'capture'));
        if (wins) {
          out.push(`attacks ${owned(f.target)} and wins it`);
          lineUsed = true;
        }
        break;
      }
      default:
        break;
    }
  }
  const playedLine = played.find((f): f is F<'line'> => f.type === 'line');
  // a line result the played move matches is no reason ("leads to winning a pawn" when both win a pawn)
  const playedAsGood = !!line && !!playedLine && playedLine.result === line.result && playedLine.materialDelta >= line.materialDelta;
  if (line && !lineUsed && !playedAsGood && !out.some((r) => r.startsWith('wins'))) {
    if (line.result === 'mate' && line.mateIn) out.push(`forces mate in ${line.mateIn}`);
    else if (line.result === 'wins-material' && line.won?.length && !line.lost?.length) out.push(`leads to winning ${piecesPhrase(line.won)}`);
  }
  return [...new Set(out)].slice(0, 2);
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
  /** The played move (SAN), named in the material sentence. */
  san?: string;
  /** The played move's own verified 'hangs' fact (Immediate level), if any. */
  verifiedHang?: { piece: PieceRef; loss: number; already?: boolean } | null;
};

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
  const why = a.better?.length ? ` ${a.bestSan} ${a.better[0]}${a.better[1] ? `, and it ${a.better[1]}` : ''}.` : '';
  switch (a.label) {
    case 'forced':
      return `${name} — the only legal move.`;
    case 'book': {
      const b = a.labelReason.book;
      return b ? `${name} — a known opening move (${b.name}, ${b.eco}).` : `${name} — a known opening move.`;
    }
    case 'best':
      if (a.checkmate) return `${name} — checkmate!`;
      return isBestMove ? `${name} — the engine's top choice.` : `${name} — as good as the engine's top move (${a.bestSan}).`;
    case 'great':
      return `${name} — the only good move here: the next best loses ${Math.round(a.labelReason.great?.secondBestLoss ?? 0)}% winning chances.`;
    case 'excellent':
      return `${name} — almost as good as the best move ${a.bestSan} (${loss}).`;
    case 'good':
      return `${name} — a little weaker than ${a.bestSan} (${loss}).`;
    case 'inaccuracy':
      return `${name} — ${a.bestSan} was better (${loss}).${why}`;
    case 'miss':
      return `${name} — ${opp}'s last move was a mistake, and ${a.bestSan} would have punished it (${loss}).${why}`;
    case 'mistake':
    case 'blunder': {
      // the hung piece is named only from the move's own verified 'hangs' fact (a piece standing on that square
      // after the move, confirmed by the engine line), with that fact's number; otherwise the line's net loss
      const vh = a.verifiedHang;
      const lossText = vh ? `${vh.already ? "does not save" : "leaves"} ${the(vh.piece)}${vh.already ? ", which is still hanging" : " hanging"} (${points(-vh.loss)})` : m ? `loses material: the engine line ends ${Math.abs(m.loss)} ${Math.abs(m.loss) === 1 ? "point" : "points"} worse than after ${a.bestSan}` : '';
      if (materialDecides && m) {
        const still = a.winAfter >= settings.suggest.winningMin
          ? ` ${me} is still winning (engine eval ${formatEval(a.evalBefore)} → ${formatEval(a.evalAfter)}), but this is the habit to fix.`
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
      return playedIsBest ? 'This was the best move.' : "As good as the engine's top move.";
    default:
      return null;
  }
}

// --- Suggestion captions (UI / report) -----------------------------------------------------------------------

export const SUGGESTION_TEXT = {
  deepOnly: 'deep engine move — hard to explain',
  lossVsBest: (winLoss: number): string => (winLoss < 0.5 ? "as good as the engine's top move" : `${MINUS}${winLoss.toFixed(1)}% winning chances vs the engine's top`),
} as const;
