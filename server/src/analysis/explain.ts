// The ONLY place that produces prose. Facts (data) -> short, plain English for a beginner.
//
// Rules
//  - Mover-neutral: the same text is shown for both sides' moves, so it names colours ("Attacks Black's queen"),
//    never "you". The subject of an Immediate sentence is the move itself ("Wins…", "Leaves…").
//  - Nothing is stated that isn't in the facts (piece names, squares, numbers all come from fact fields).
//  - Material numbers are pawn units from the mover's point of view: (+3) = the mover gains 3, (−3) = loses 3.
//  - Each level is deduplicated (check implied by a fork/skewer on the king, attacks already covered by a fork /
//    pin / skewer / discovered attack, several attacks by one piece merged) and capped at MAX_SENTENCES.
//  - `Level.facts` keeps every fact of the level (structured data for a later rephrasing step); `Level.text`
//    holds the rendered sentences (not 1:1 with the facts).

import type { AnalysisSettings, Color, Explanation, Fact, Label, Level, LineStep, MoveAnalysis, PieceRef, PieceRole, Score } from '@chess-coach/shared';
import { PIECE_VALUES } from '../chess/material';

export const MAX_SENTENCES = 4;

export interface ExplainContext {
  /** The side that played the move being explained. */
  mover: Color;
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

// --- Immediate ----------------------------------------------------------------------------------------------------

const IMMEDIATE_ORDER: readonly Fact['type'][] = [
  'checkmate', 'stalemate', 'allows-mate', 'hangs', 'fork', 'skewer', 'discovered-attack', 'pin', 'capture', 'promotion', 'check',
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
        ? `Wins ${c} for free (${signed(f.net)})`
        : `Takes ${c} and comes out ahead in the exchange (${signed(f.net)})`;
    case 'even-trade':
      return `Takes ${c} — an even trade`;
    case 'recapture':
      return `Recaptures: takes ${c}`;
    case 'loses-material':
      return `Takes ${c}, but loses material in the exchange (${signed(f.net)})`;
  }
}

/** What a threat does: verb phrase in -ing form or base form ("forking …" / "fork …"), with the gain. */
function threatPoint(f: { gain: number; facts: readonly Fact[] }, form: 'ing' | 'base'): string {
  const gain = `(${signed(f.gain)})`;
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
  // the gain is the opponent's: shown from their side, e.g. "which would win a knight (+3 for Black)"
  return `Stops ${opp}'s threat ${f.san}, which would ${threatPoint(f, 'base').replace(/\(([^)]*)\)$/, `($1 for ${opp})`)}`;
}

function immediateFactText(f: Fact, ctx: ExplainContext): string | null {
  const opp = colorName(other(ctx.mover));
  switch (f.type) {
    case 'checkmate':
      return `Checkmate — ${colorName(ctx.mover)} wins`;
    case 'stalemate':
      return `Stalemate — ${opp} has no legal move and is not in check, so the game is a draw`;
    case 'check':
      return f.double ? 'Double check — the king has to move' : f.discovered ? 'Discovered check' : 'Gives check';
    case 'capture':
      return captureText(f);
    case 'promotion':
      return `Promotes the pawn to ${an(f.to)}`;
    case 'castle':
      return `Castles ${f.side === 'king' ? 'kingside' : 'queenside'}`;
    case 'develop':
      return `Develops the ${f.piece.role} to ${f.piece.square}`;
    case 'attack':
      return f.reason === 'undefended' ? `Attacks ${owned(f.target)}, which is undefended` : `Attacks ${owned(f.target)} with ${an(f.attacker.role)}`;
    case 'fork':
      return `Fork: ${the(f.attacker)} attacks ${targetsPhrase(f.targets)} at once`;
    case 'pin':
      return f.absolute ? `Pins ${owned(f.pinned)} to the king` : `Pins ${owned(f.pinned)} to the ${f.behind.role} on ${f.behind.square}`;
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
        ? `Leaves ${the(f.piece)} hanging — it was already attacked and ${opp} can still win it (${signed(-f.loss)})`
        : `Leaves ${the(f.piece)} hanging (${signed(-f.loss)})`;
    case 'allows-mate':
      return f.inMoves === 1 ? `Allows checkmate: ${opp} can mate next move` : `Allows ${opp} a forced mate in ${f.inMoves}`;
    case 'threat':
      return threatText(f);
    case 'defends-threat':
      return defendsText(f, ctx);
    default:
      return null;
  }
}

function renderImmediate(facts: readonly Fact[], ctx: ExplainContext, line?: F<'line'>): string[] {
  let fs = [...facts];
  // a sacrifice that the short line justifies is not "hanging": say so (both facts are verified)
  const paysOff = !line ? null : line.result === 'mate' ? 'it leads to mate' : line.result === 'wins-material' ? 'the follow-up wins it back with interest' : null;
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

  const rank = (t: Fact['type']) => {
    const i = IMMEDIATE_ORDER.indexOf(t);
    return i < 0 ? IMMEDIATE_ORDER.length : i;
  };
  fs = fs.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f.type) - rank(b.f.type) || a.i - b.i).map((x) => x.f);

  const out: string[] = [];
  const check = fs.find((f): f is F<'check'> => f.type === 'check');
  // a capture also 'saves' the capturing piece when it takes its attacker: the capture sentence says enough
  if (fs.some((f) => f.type === 'capture')) fs = fs.filter((f) => f.type !== 'escape');
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
        out.push(`Attacks ${targetsPhrase(group.map((g) => g.target))}`);
        continue;
      }
    }
    let text = immediateFactText(f, ctx);
    if (paysOff && f.type === 'hangs' && !f.already) text = `Sacrifices ${the(f.piece)} (${signed(-f.loss)}) — ${paysOff}`;
    if (paysOff && f.type === 'capture' && f.outcome === 'loses-material') text = `Takes ${owned(f.captured)} as a sacrifice (${signed(f.net)}) — ${paysOff}`;
    if (!text) continue;
    if (f === capture && check && !check.double && !check.discovered) text += ', with check';
    out.push(text);
  }
  return out.slice(0, MAX_SENTENCES).map((s) => `${s}.`);
}

// --- Short term ---------------------------------------------------------------------------------------------------

function stepClause(step: LineStep): string {
  const f = step.facts.find((x) => x.type !== 'check');
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
      return f.absolute ? ` pins the ${f.pinned.role}` : ` pins the ${f.pinned.role} to the ${f.behind.role}`;
    case 'discovered-attack':
      return ` uncovers an attack on the ${f.target.role}`;
    case 'capture':
      if (f.outcome === 'recapture') return ' takes back';
      if (f.outcome === 'wins-material' && f.net >= PIECE_VALUES[f.captured.role]) return ` wins the ${f.captured.role}`;
      return ` takes the ${f.captured.role}`;
    case 'promotion':
      return ` promotes to ${an(f.to)}`;
    case 'attack':
      return ` attacks the ${f.target.role}`;
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
  const d = `(${signed(line.materialDelta)})`;
  const isExchange = (a: readonly PieceRole[], b: readonly PieceRole[]) => a.length === 1 && a[0] === 'rook' && b.length === 1 && (b[0] === 'knight' || b[0] === 'bishop');
  const firstIsRecapture = line.steps[0]?.facts.some((f) => f.type === 'capture' && f.outcome === 'recapture');
  if (line.result === 'wins-material') {
    if (isExchange(won, lost)) return `${who} wins the exchange ${d}`;
    if (lost.length === 0 && won.length > 0 && won.length <= 2) return `${who} ${firstIsRecapture ? 'wins back' : 'wins'} ${piecesPhrase(won)} ${d}`;
    if (won.length > 0 && won.length <= 2 && lost.length <= 2) return `${who} wins ${piecesPhrase(won)} for ${piecesPhrase(lost)} ${d}`;
    return `${who} comes out ahead in material ${d}`;
  }
  if (isExchange(lost, won)) return `${who} loses the exchange ${d}`;
  if (won.length === 0 && lost.length > 0 && lost.length <= 2) return `${who} loses ${piecesPhrase(lost)} ${d}`;
  if (lost.length > 0 && lost.length <= 2 && won.length <= 2) return `${who} gives ${piecesPhrase(lost)} for ${piecesPhrase(won)} ${d}`;
  return `${who} ends up behind in material ${d}`;
}

export function lineText(line: F<'line'>, ctx: ExplainContext): string {
  const mover = ctx.mover;
  const steps = line.steps.map((s) => `${s.san}${stepClause(s)}${s.forced ? ' (forced)' : ''}`);
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
    case 'loses-material':
      result = materialResult(line, mover);
      break;
    case 'trade':
      result = 'material stays level';
      break;
    case 'quiet':
      break;
  }
  if (result && line.measuredAt) result = `a few moves later, ${result}`;
  const story = line.steps.some((s) => s.forced || s.facts.length > 0);
  if (!story && (line.result === 'quiet' || line.result === 'trade')) {
    return `No forcing follow-up; material stays level (engine line: ${line.steps.map((s) => s.san).join(' ')}).`;
  }
  return `${[...steps, ...(result ? [result] : [])].join(' → ')}.`;
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
      s = good ? `${who} gets ${plural ? 'passed pawns' : 'a passed pawn'}${onSquares(f.squares)}` : `${who} no longer has ${plural ? 'passed pawns' : 'a passed pawn'}${onSquares(f.squares)}`;
      break;
    case 'isolated-pawn':
      s = good ? `${who}'s pawn${plural ? 's' : ''}${onSquares(f.squares)} ${plural ? 'are' : 'is'} no longer isolated` : `${who} gets ${plural ? 'isolated pawns' : 'an isolated pawn'}${onSquares(f.squares)}`;
      break;
    case 'doubled-pawn':
      s = good ? `${who}'s doubled pawns${filesOf(f.squares)} are gone` : `${who} gets doubled pawns${filesOf(f.squares)}`;
      break;
    case 'open-file-rook':
      if (f.detail === 'open') s = `${who}'s rook${onSquares(f.squares)} now stands on a fully open file`;
      else s = good ? `${who}'s rook${onSquares(f.squares)} gets an open file` : `${who}'s rook${onSquares(f.squares)} no longer has an open file`;
      break;
    case 'bishop-pair':
      s = good ? `${who} gets the bishop pair` : `${who} gives up the bishop pair`;
      if (!own && !good) s = `${who} loses the bishop pair`;
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
  return f.at === 'line-end' ? `After the line, ${s}.` : `${s}.`;
}

function longFactText(f: Fact, ctx: ExplainContext, all: AllFacts): string | null {
  const me = colorName(ctx.mover);
  switch (f.type) {
    case 'positional':
      return positionalText(f, ctx);
    case 'positional-gain': {
      const pawns = (f.cp / 100).toFixed(1);
      const line = all.short.find((x): x is F<'line'> => x.type === 'line');
      if (line && line.materialDelta < 0) return `${me} gives up material, but the engine sees about ${pawns} pawns of compensation in the position.`;
      return `The engine rates ${me}'s position about ${pawns} pawns better than the material count suggests.`;
    }
    case 'deep-payoff':
      return 'The payoff is far away: a quick engine look rates this move lower — only a deep search sees why it works.';
    case 'necessary':
      return f.onlyMove ? 'It was the only legal move.' : `${me} just had to play this — every other move is much worse.`;
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
  const shortText = line && line.steps.length > 0 ? [lineText(line, ctx)] : [];
  const longText = all.long.map((f) => longFactText(f, ctx, all)).filter((t): t is string => !!t).slice(0, MAX_SENTENCES);
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
      return `${name} — ${a.bestSan} was better (${loss}).`;
    case 'miss':
      return `${name} — ${opp}'s last move was a mistake, and ${a.bestSan} would have punished it (${loss}).`;
    case 'mistake':
    case 'blunder': {
      if (materialDecides && m) {
        const what = m.hung ? `leaves ${the(m.hung)} hanging (${signed(-m.loss)})` : `throws away material (${signed(-m.loss)})`;
        const still = a.winAfter >= settings.suggest.winningMin
          ? ` ${me} is still winning (${formatEval(a.evalBefore)} → ${formatEval(a.evalAfter)}), but this is the habit to fix.`
          : ` ${chances}.`;
        return `${name} — ${what}.${still}`;
      }
      const hung = m?.hung && m.label ? `; it leaves ${the(m.hung)} hanging (${signed(-m.loss)})` : '';
      return `${name} — ${a.bestSan} was much better${hung}. ${capitalize(chances)}.`;
    }
  }
}

// --- Suggestion captions (UI / report) -----------------------------------------------------------------------

export const SUGGESTION_TEXT = {
  confirm: 'Good — this was the move.',
  deepOnly: 'deep engine move — hard to explain',
  lossVsBest: (winLoss: number): string => (winLoss < 0.5 ? "as good as the engine's top move" : `${MINUS}${winLoss.toFixed(1)}% winning chances vs the engine's top`),
} as const;
