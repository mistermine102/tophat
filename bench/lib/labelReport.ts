// Report for bench/label-benchmark.ts: reads data/bench/labels-<tag>.json and writes bench/reports/labels.md
// (summary) + bench/reports/labels-details.md (full lists). Hand verdicts for material/mate/Great/Miss firings come
// from bench/labels.eyeball.json ({ "<gameId>:<ply>": { "verdict": "ok" | "wrong" | "debatable", "note": "..." } }).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Label, Score } from '@chess-coach/shared';
import type { GameRecord, PlyRecord, ProfileName, RunFile } from '../label-benchmark';
import { type Judgement, type LichessScore, lichessJudgement } from './lichessPgn';

type J = Judgement | 'none';
const JS: J[] = ['none', 'inaccuracy', 'mistake', 'blunder'];
const LABELS: Label[] = ['book', 'forced', 'best', 'great', 'excellent', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder'];
const THRESHOLDS: Record<ProfileName, number[]> = { default: [0.5, 2, 5, 10, 20], lichess: [0.5, 2, 5, 10, 15] };

interface Eyeball {
  verdict: 'ok' | 'wrong' | 'debatable';
  note?: string;
}

export interface ReportOptions {
  outDir: string;
  reportDir: string;
  main: string;
  cold?: string | undefined;
  depths?: string[] | undefined;
  ref?: string | undefined;
  /** Verification experiment: [main+verify tag, cold+verify tag]. */
  verify?: string[] | undefined;
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '–');
const f1 = (x: number) => x.toFixed(1);
const fmtScore = (s: Score | LichessScore | undefined): string => {
  if (!s) return '?';
  if (s.mate !== undefined) return `#${s.mate}`;
  const v = (s.cp ?? 0) / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
};
const moveNo = (p: PlyRecord) => `${Math.ceil(p.ply / 2)}${p.color === 'white' ? '.' : '...'}`;
const lichessUrl = (g: GameRecord, p: PlyRecord) => `https://lichess.org/${g.id}#${p.ply}`;
const key = (g: GameRecord, p: PlyRecord) => `${g.id}:${p.ply}`;

/** Our label -> Lichess judgement class (Miss = its win-chance label; Book/Forced/Best... = none). */
export function toJudgement(label: Label, winChance: Label): J {
  if (label === 'inaccuracy' || label === 'mistake' || label === 'blunder') return label;
  if (label === 'miss') return winChance === 'inaccuracy' || winChance === 'mistake' || winChance === 'blunder' ? winChance : 'inaccuracy';
  return 'none';
}

function loadRun(dir: string, tag: string): RunFile | null {
  const p = join(dir, `labels-${tag}.json`);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as RunFile) : null;
}

function confusion(pairs: [J, J][]): { table: string; agree: number; total: number; perClass: string } {
  const m = new Map<string, number>();
  for (const [ours, li] of pairs) m.set(`${ours}|${li}`, (m.get(`${ours}|${li}`) ?? 0) + 1);
  const get = (o: J, l: J) => m.get(`${o}|${l}`) ?? 0;
  const L: string[] = ['| ours \\ Lichess | none | inaccuracy | mistake | blunder | total |', '|---|---|---|---|---|---|'];
  let agree = 0;
  for (const o of JS) {
    const row = JS.map((l) => get(o, l));
    agree += get(o, o);
    L.push(`| **${o}** | ${row.map((n, i) => (JS[i] === o ? `**${n}**` : String(n))).join(' | ')} | ${row.reduce((a, b) => a + b, 0)} |`);
  }
  L.push(`| total | ${JS.map((l) => JS.reduce((a, o) => a + get(o, l), 0)).join(' | ')} | ${pairs.length} |`);
  const pc: string[] = ['| class | precision | recall |', '|---|---|---|'];
  for (const c of JS.slice(1)) {
    const tp = get(c, c);
    const predicted = JS.reduce((a, l) => a + get(c, l), 0);
    const actual = JS.reduce((a, o) => a + get(o, c), 0);
    pc.push(`| ${c} | ${pct(tp, predicted)} (${tp}/${predicted}) | ${pct(tp, actual)} (${tp}/${actual}) |`);
  }
  // "any judgement" (flagged vs not)
  const flaggedBoth = pairs.filter(([o, l]) => o !== 'none' && l !== 'none').length;
  const flaggedOurs = pairs.filter(([o]) => o !== 'none').length;
  const flaggedLi = pairs.filter(([, l]) => l !== 'none').length;
  pc.push(`| any (?!/?/??) | ${pct(flaggedBoth, flaggedOurs)} (${flaggedBoth}/${flaggedOurs}) | ${pct(flaggedBoth, flaggedLi)} (${flaggedBoth}/${flaggedLi}) |`);
  return { table: L.join('\n'), agree, total: pairs.length, perClass: pc.join('\n') };
}

/** Lichess' delta (win% points, mover POV) from two White-POV evals; undefined if a mate is involved. */
function deltaWin(before: Score | LichessScore | undefined, after: Score | LichessScore | undefined, color: 'white' | 'black', clamp: boolean): number | undefined {
  if (!before || !after || before.cp === undefined || after.cp === undefined) return undefined;
  const wc = (cp: number) => {
    const c = clamp ? Math.max(-1000, Math.min(1000, cp)) : cp;
    return 2 / (1 + Math.exp(-0.00368208 * c)) - 1;
  };
  const d = 50 * (wc(before.cp) - wc(after.cp));
  return color === 'white' ? d : -d;
}

/** winLoss within `margin` of a label threshold (winLoss 0 = the engine's own #1 move: never "near"). */
function nearThreshold(winLoss: number, prof: ProfileName, margin: number): boolean {
  return winLoss > 0 && THRESHOLDS[prof].some((t) => Math.abs(winLoss - t) <= margin);
}

/** Coarse severity class for agreement between runs. */
function coarse(l: Label): string {
  if (l === 'inaccuracy') return 'inaccuracy';
  if (l === 'mistake' || l === 'miss') return 'mistake/miss';
  if (l === 'blunder') return 'blunder';
  return 'ok';
}

interface PairStats { n: number; exact: number; coarse: number; judge: number; great: number; miss: number; bestMove: number; coarseNear: number; rows: string[] }

/** Label differences between two runs on their common plies (default profile). */
function pairStats(ra: RunFile, rb: RunFile): PairStats {
  const s: PairStats = { n: 0, exact: 0, coarse: 0, judge: 0, great: 0, miss: 0, bestMove: 0, coarseNear: 0, rows: [] };
  const byId = new Map(ra.games.map((g) => [g.id, g]));
  for (const gb of rb.games) {
    const ga = byId.get(gb.id);
    if (!ga) continue;
    for (const pb of gb.plies) {
      const pa = ga.plies.find((x) => x.ply === pb.ply);
      if (!pa) continue;
      s.n++;
      const a = pa.labels.default, b = pb.labels.default;
      if (pa.bestUci !== pb.bestUci) s.bestMove++;
      if (toJudgement(a.label, a.winChance) !== toJudgement(b.label, b.winChance)) s.judge++;
      if ((a.label === 'great') !== (b.label === 'great')) s.great++;
      if ((a.label === 'miss') !== (b.label === 'miss')) s.miss++;
      if (a.label === b.label) continue;
      s.exact++;
      if (coarse(a.label) !== coarse(b.label)) {
        s.coarse++;
        const near = (w: number) => w > 0 && [5, 10, 20].some((t) => Math.abs(w - t) <= 1);
        if (near(a.winLoss) || near(b.winLoss)) s.coarseNear++;
      }
      s.rows.push(`| [${gb.id}](${lichessUrl(gb, pb)}) | ${moveNo(pb)} ${pb.san} | ${a.label} (${f1(a.winLoss)}) | ${b.label} (${f1(b.winLoss)}) | ${pa.bestSan} / ${pb.bestSan} | ${fmtScore(pa.bestScore)} / ${fmtScore(pb.bestScore)} | ${fmtScore(pa.playedScore)} / ${fmtScore(pb.playedScore)} | d${pa.deep.depth} ${pa.deep.timeMs} ms / d${pb.deep.depth} ${pb.deep.timeMs} ms |`);
    }
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------

export function report(o: ReportOptions): void {
  const main = loadRun(o.outDir, o.main);
  if (!main) throw new Error(`no run ${o.main} in ${o.outDir}`);
  const eyePath = join(o.reportDir, '..', 'labels.eyeball.json');
  const eye: Record<string, Eyeball> = existsSync(eyePath) ? JSON.parse(readFileSync(eyePath, 'utf8')) : {};
  const R: string[] = [];
  const D: string[] = ['# Label benchmark — details', '', `Run \`${o.main}\` (see labels.md). Lichess links jump to the ply.`, ''];
  const games = main.games;
  const plies = games.flatMap((g) => g.plies.map((p) => ({ g, p })));
  const totalPlies = plies.length;
  const engineS = games.reduce((a, g) => a + g.engineMs, 0) / 1000;

  R.push('# Label benchmark — our labels vs Lichess on 60 amateur games');
  R.push('');
  R.push(`Generated by \`npx tsx bench/label-benchmark.ts report\` from run \`${main.tag}\`: ${games.length} Lichess games (players ~1500–1600, ≥ 5 min), ${totalPlies} plies, ${main.engine}, deep d${main.depth} MultiPV 5${main.maxMs ? `, time cap ${main.maxMs} ms` : ''}, ${main.threads} threads (CPU shared with another engine). Engine time ${f1(engineS / 60)} min (${f1(engineS / totalPlies)} s/ply). Full lists: [labels-details.md](labels-details.md).`);
  R.push('');
  R.push('Lichess rules (lila `modules/tree/src/main/Advice.scala`, scalachess `eval.scala`): mover\'s drop in `winningChances = 2/(1+e^(−0.00368208·cp))−1` between the eval before and after the move ≥ 0.1 / 0.2 / 0.3 → Inaccuracy / Mistake / Blunder — i.e. **5 / 10 / 15 win% points** (win% = 50 + 50·winningChances), not 10/20/30. No ±1000 cp ceiling in the advice (raw cp; verified: the 60 games\' judgements are reproduced from their own `[%eval]`s on 4781 of the 4810 plies that have an eval before and after; the 29 others are all plies Lichess left unjudged although their evals qualify — apparently plies stored without a variation). Mate rules: cp → mate against the mover = Blunder (Mistake if the mover was already < −7, Inaccuracy if < −9.99); losing a forced mate = Blunder (Mistake if still > +7, Inaccuracy if > +9.99); a longer mate is never judged.');
  R.push('');

  R.push('<!-- ANALYSIS:summary -->');
  R.push('');
  // --- 1. pipeline validation -------------------------------------------------------------------------------
  R.push('## 1. Pipeline validation (Lichess thresholds)');
  R.push('');
  const pairsRules: [J, J][] = [];
  const pairsWin: [J, J][] = [];
  const pairsFull: [J, J][] = [];
  type Dis = { g: GameRecord; p: PlyRecord; ours: J; li: J; rulesOnOurs: J; cat: string };
  const dis: Dis[] = [];
  for (const { g, p } of plies) {
    const li: J = p.lichess.judgement ?? 'none';
    const prev = g.plies.find((x) => x.ply === p.ply - 1);
    const ourBefore = p.evalBefore;
    const rulesOnOurs: J = (p.evalAfter ? lichessJudgement(ourBefore, p.evalAfter, p.color) : undefined) ?? 'none';
    const L = p.labels.lichess;
    const winOnly = toJudgement(L.winChance, L.winChance);
    const full = toJudgement(L.label, L.winChance);
    pairsRules.push([rulesOnOurs, li]);
    pairsWin.push([winOnly, li]);
    pairsFull.push([full, li]);
    if (full !== li) {
      // categorise
      const liBefore = prev?.lichess.evalAfter ?? (p.ply === 1 ? { cp: 20 } : undefined);
      const liDelta = deltaWin(liBefore, p.lichess.evalAfter, p.color, false);
      let cat: string;
      if (L.label === 'book') cat = 'book move';
      else if (L.label === 'forced') cat = 'forced (single legal move)';
      else if (full !== winOnly) cat = L.reason.allowedMate ? 'rule: allowed mate' : L.reason.missedMate ? 'rule: missed mate' : L.reason.material?.label ? 'rule: material' : 'rule: other';
      else if (rulesOnOurs === li) {
        // Lichess rules on OUR evals agree: the difference is how we measure (best vs played in one search)
        const decided = [p.bestScore, p.playedScore].some((s) => s.mate !== undefined || Math.abs(s.cp ?? 0) > 1000) || [p.evalBefore, p.evalAfter].some((s) => s && (s.mate !== undefined || Math.abs(s.cp ?? 0) > 1000));
        cat = decided ? 'method: decided position (clamp / mate rules)' : nearThreshold(L.winLoss, 'lichess', 1.5) ? 'method: near a threshold (±1.5)' : 'method: one-search winLoss vs eval before/after';
      } else {
        const ourDelta = deltaWin(ourBefore, p.evalAfter, p.color, false);
        const decided = [liBefore, p.lichess.evalAfter, ourBefore, p.evalAfter].some((s) => s && (s.mate !== undefined || Math.abs(s.cp ?? 0) > 1000));
        if (decided) cat = 'engine: decided position (mate / > ±10)';
        else if (liDelta !== undefined && ourDelta !== undefined && Math.abs(liDelta - ourDelta) <= 3 && (nearThreshold(liDelta, 'lichess', 1.5) || nearThreshold(ourDelta, 'lichess', 1.5))) cat = 'engine: near a threshold';
        else cat = 'engine: evals differ';
      }
      dis.push({ g, p, ours: full, li, rulesOnOurs, cat });
    }
  }
  const cr = confusion(pairsRules);
  const cw = confusion(pairsWin);
  const cf = confusion(pairsFull);
  R.push(`**(a) Lichess' own rules on our evals** (our deep eval before vs after each move — isolates engine differences): exact agreement **${pct(cr.agree, cr.total)}**.`);
  R.push('');
  R.push(cr.table);
  R.push('');
  R.push(`**(b) Our classifier with the \`lichess\` threshold profile, win-chance label only** (winLoss = best vs played from the same deep search): exact agreement **${pct(cw.agree, cw.total)}**.`);
  R.push('');
  R.push(cw.table);
  R.push('');
  R.push(`**(c) Our classifier with the \`lichess\` profile, final label** (+ material rule, mate rules, Miss → its win-chance class, Book/Forced/Great → none): exact agreement **${pct(cf.agree, cf.total)}**.`);
  R.push('');
  R.push(cf.table);
  R.push('');
  R.push(cf.perClass);
  R.push('');
  const cats = new Map<string, Dis[]>();
  for (const d of dis) cats.set(d.cat, [...(cats.get(d.cat) ?? []), d]);
  R.push(`Disagreements of (c): ${dis.length}, automatically categorised (details + every case in labels-details.md):`);
  R.push('');
  R.push('| category | n | ours stricter | Lichess stricter |');
  R.push('|---|---|---|---|');
  const sev = (j: J) => JS.indexOf(j);
  for (const [c, ds] of [...cats].sort((a, b) => b[1].length - a[1].length)) {
    R.push(`| ${c} | ${ds.length} | ${ds.filter((d) => sev(d.ours) > sev(d.li)).length} | ${ds.filter((d) => sev(d.ours) < sev(d.li)).length} |`);
  }
  R.push('');
  R.push('<!-- ANALYSIS:validation -->');
  R.push('');
  D.push('## Disagreements with Lichess (lichess profile, final label)', '');
  for (const [c, ds] of [...cats].sort((a, b) => b[1].length - a[1].length)) {
    D.push(`### ${c} (${ds.length})`, '');
    D.push('| game | move | ours (lichess profile) | Lichess | winLoss | our eval before → after | Lichess eval before → after | our best | Lichess comment |');
    D.push('|---|---|---|---|---|---|---|---|---|');
    for (const d of ds) {
      const prev = d.g.plies.find((x) => x.ply === d.p.ply - 1);
      D.push(`| [${d.g.id}](${lichessUrl(d.g, d.p)}) | ${moveNo(d.p)} ${d.p.san} | ${d.p.labels.lichess.label} | ${d.li} | ${f1(d.p.labels.lichess.winLoss)} | ${fmtScore(d.p.evalBefore)} → ${fmtScore(d.p.evalAfter)} | ${fmtScore(prev?.lichess.evalAfter)} → ${fmtScore(d.p.lichess.evalAfter)} | ${d.p.bestSan} | ${d.p.lichess.comment ?? ''} |`);
    }
    D.push('');
  }

  // --- 2. default distribution --------------------------------------------------------------------------------
  R.push('## 2. Our default labels (chess.com-like thresholds 5 / 10 / 20)');
  R.push('');
  const count = (pred: (p: PlyRecord) => boolean) => plies.filter(({ p }) => pred(p)).length;
  const sides = games.length * 2;
  R.push(`Per game and side (average over ${sides} game-sides), next to Lichess' judgements of the same moves:`);
  R.push('');
  R.push('| label | total | per side per game | share of moves |');
  R.push('|---|---|---|---|');
  for (const l of LABELS) {
    const n = count((p) => p.labels.default.label === l);
    R.push(`| ${l} | ${n} | ${(n / sides).toFixed(2)} | ${pct(n, totalPlies)} |`);
  }
  for (const j of ['inaccuracy', 'mistake', 'blunder'] as const) {
    const n = count((p) => p.lichess.judgement === j);
    R.push(`| *Lichess ${j}* | ${n} | ${(n / sides).toFixed(2)} | ${pct(n, totalPlies)} |`);
  }
  R.push('');
  // default vs Lichess
  const pairsDef: [J, J][] = plies.map(({ p }) => [toJudgement(p.labels.default.label, p.labels.default.winChance), p.lichess.judgement ?? 'none']);
  const cd = confusion(pairsDef);
  R.push(`Default labels vs Lichess (Miss mapped to its win-chance class): exact ${pct(cd.agree, cd.total)}.`);
  R.push('');
  R.push(cd.table);
  R.push('');
  R.push('<!-- ANALYSIS:distribution -->');
  R.push('');
  D.push('## Default label counts per game', '');
  D.push(`| game | plies | ${LABELS.map((l) => l).join(' | ')} | Lichess ?!/?/?? |`);
  D.push(`|---|---|${LABELS.map(() => '---').join('|')}|---|`);
  for (const g of games) {
    const c = (l: Label) => g.plies.filter((p) => p.labels.default.label === l).length;
    const lj = (j: Judgement) => g.plies.filter((p) => p.lichess.judgement === j).length;
    D.push(`| ${g.id} | ${g.plies.length} | ${LABELS.map(c).join(' | ')} | ${lj('inaccuracy')}/${lj('mistake')}/${lj('blunder')} |`);
  }
  D.push('');

  // --- 3. material rule ------------------------------------------------------------------------------------
  const verdictCell = (g: GameRecord, p: PlyRecord) => {
    const e = eye[key(g, p)];
    return e ? `${e.verdict}${e.note ? ` — ${e.note}` : ''}` : '(not reviewed)';
  };
  const precision = (rows: { g: GameRecord; p: PlyRecord }[]) => {
    const rev = rows.filter(({ g, p }) => eye[key(g, p)]);
    const ok = rev.filter(({ g, p }) => eye[key(g, p)]!.verdict === 'ok').length;
    const deb = rev.filter(({ g, p }) => eye[key(g, p)]!.verdict === 'debatable').length;
    return `${rev.length} reviewed by hand: ${ok} ok, ${deb} debatable, ${rev.length - ok - deb} wrong`;
  };
  R.push('## 3. Material rule firings (default profile)');
  R.push('');
  const mat = plies.filter(({ p }) => p.labels.default.reason.material?.label);
  const matDecides = mat.filter(({ p }) => p.labels.default.label === p.labels.default.reason.material!.label && p.labels.default.winChance !== p.labels.default.label);
  R.push(`The material rule fired on ${mat.length} moves; it changed the label on ${matDecides.length} (the others were at least as bad by win chance). ${precision(matDecides)}.`);
  R.push('');
  const firstLoss = (p: PlyRecord) => p.labels.default.reason.material?.lostInLine?.[0]?.ply;
  const bucket = (n: number | undefined) => (n === undefined ? 'no lost piece' : n <= 2 ? 'reply (ply 2)' : n <= 4 ? 'ply 3–4' : n <= 6 ? 'ply 5–6' : 'ply 7+');
  const buckets = new Map<string, number>();
  for (const { p } of matDecides) buckets.set(bucket(firstLoss(p)), (buckets.get(bucket(firstLoss(p))) ?? 0) + 1);
  R.push(`Where the first piece is lost in the played line (label-changing firings): ${[...buckets].map(([k, v]) => `${k}: ${v}`).join(', ')}; with a \`hung\` piece (en prise right after the move): ${matDecides.filter(({ p }) => p.labels.default.reason.material!.hung).length}.`);
  R.push('');
  R.push('| game | move | label (win-chance) | loss | eval drop | hung / lost | our eval before → after | played line | verdict |');
  R.push('|---|---|---|---|---|---|---|---|---|');
  for (const { g, p } of matDecides) {
    const m = p.labels.default.reason.material!;
    const what = m.hung ? `hung ${m.hung.role} ${m.hung.square}` : m.lostInLine?.length ? `lost ${m.lostInLine.map((x) => `${x.role} ${x.square} @${x.ply}`).join(', ')}` : '–';
    R.push(`| [${g.id}](${lichessUrl(g, p)}) | ${moveNo(p)} ${p.san} | ${p.labels.default.label} (${p.labels.default.winChance}) | −${m.loss} | ${m.evalDropCp} | ${what} | ${fmtScore(p.evalBefore)} → ${fmtScore(p.evalAfter)} | ${p.playedPvSan.slice(0, 8).join(' ')} | ${verdictCell(g, p)} |`);
  }
  R.push('');
  D.push('## Material rule firings where the win-chance label was already as bad', '');
  for (const { g, p } of mat.filter((x) => !matDecides.includes(x))) {
    const m = p.labels.default.reason.material!;
    D.push(`- [${g.id}](${lichessUrl(g, p)}) ${moveNo(p)} ${p.san}: ${p.labels.default.label}, loss −${m.loss}, drop ${m.evalDropCp} cp, ${m.hung ? `hung ${m.hung.role} ${m.hung.square}` : 'no hung piece'}; line ${p.playedPvSan.slice(0, 8).join(' ')}`);
  }
  D.push('');
  // hung descriptions: how many claimed hung vs lost later
  const withLoss = plies.filter(({ p }) => (p.labels.default.reason.material?.loss ?? 0) > 0);
  R.push(`Hung-piece descriptions (all moves with material loss > 0, ${withLoss.length}): \`hung\` (en prise right after the move) ${withLoss.filter(({ p }) => p.labels.default.reason.material!.hung).length}, only \`lostInLine\` (lost later in the line) ${withLoss.filter(({ p }) => !p.labels.default.reason.material!.hung && p.labels.default.reason.material!.lostInLine?.length).length}.`);
  R.push('');
  R.push('<!-- ANALYSIS:material -->');
  R.push('');

  // --- 4. mate rules ---------------------------------------------------------------------------------------
  R.push('## 4. Mate rules (allowed mate ≤ 3 → ≥ Blunder; missed mate ≤ 3 → ≥ Miss)');
  R.push('');
  const allowed = plies.filter(({ p }) => p.labels.default.reason.allowedMate);
  const missed = plies.filter(({ p }) => p.labels.default.reason.missedMate);
  const changedBy = (rows: typeof plies, l: Label) => rows.filter(({ p }) => p.labels.default.winChance !== l && p.labels.default.label === l && !(p.labels.default.reason.material?.label === l));
  R.push(`Allowed mate: ${allowed.length} moves, label changed on ${changedBy(allowed, 'blunder').length}. Missed mate: ${missed.length} moves, label changed on ${changedBy(missed, 'miss').length}. ${precision([...changedBy(allowed, 'blunder'), ...changedBy(missed, 'miss')])}.`);
  R.push('');
  R.push('| game | move | rule | label (win-chance) | best | played score | best score | Lichess | verdict |');
  R.push('|---|---|---|---|---|---|---|---|---|');
  for (const { g, p } of [...allowed, ...missed]) {
    const r = p.labels.default.reason;
    const rule = r.allowedMate ? `allows #${r.allowedMate.matedIn}${r.allowedMate.bestMatedIn ? ` (best #−${r.allowedMate.bestMatedIn})` : ''}` : `missed #${r.missedMate!.mateIn}`;
    R.push(`| [${g.id}](${lichessUrl(g, p)}) | ${moveNo(p)} ${p.san} | ${rule} | ${p.labels.default.label} (${p.labels.default.winChance}) | ${p.bestSan} | ${fmtScore(p.playedScore)} | ${fmtScore(p.bestScore)} | ${p.lichess.judgement ?? '–'} | ${verdictCell(g, p)} |`);
  }
  R.push('');

  R.push('<!-- ANALYSIS:mate -->');
  R.push('');

  // --- 5. Great / Miss -------------------------------------------------------------------------------------
  R.push('## 5. Great and Miss');
  R.push('');
  const greats = plies.filter(({ p }) => p.labels.default.label === 'great');
  const misses = plies.filter(({ p }) => p.labels.default.label === 'miss');
  R.push(`Great: ${greats.length} (${(greats.length / sides).toFixed(2)} per side per game, ${pct(greats.length, totalPlies)} of moves). ${precision(greats)}.`);
  R.push(`Miss: ${misses.length} (${(misses.length / sides).toFixed(2)} per side per game). ${precision(misses)}.`);
  R.push('');
  R.push('<!-- ANALYSIS:great -->');
  R.push('');
  D.push('## Great', '');
  D.push('| game | move | 2nd best (loss) | win% best | legal | played line | verdict |');
  D.push('|---|---|---|---|---|---|---|');
  for (const { g, p } of greats) {
    D.push(`| [${g.id}](${lichessUrl(g, p)}) | ${moveNo(p)} ${p.san} | ${p.secondSan ?? '?'} (${f1(p.labels.default.reason.great!.secondBestLoss)}) | ${f1(p.winBest)} | ${p.legalMoves} | ${p.playedPvSan.slice(0, 6).join(' ')} | ${verdictCell(g, p)} |`);
  }
  D.push('');
  D.push('## Miss', '');
  D.push('| game | move | reason | winLoss | best | win% best | Lichess | verdict |');
  D.push('|---|---|---|---|---|---|---|---|');
  for (const { g, p } of misses) {
    const r = p.labels.default.reason;
    D.push(`| [${g.id}](${lichessUrl(g, p)}) | ${moveNo(p)} ${p.san} | ${r.missedMate ? `missed #${r.missedMate.mateIn}` : 'punish'} (${r.winChance}) | ${f1(p.labels.default.winLoss)} | ${p.bestSan} | ${f1(p.winBest)} | ${p.lichess.judgement ?? '–'} | ${verdictCell(g, p)} |`);
  }
  D.push('');

  // --- 6. stability --------------------------------------------------------------------------------------------
  R.push('## 6. Stability (cold cache re-run)');
  R.push('');
  const cold = o.cold ? loadRun(o.outDir, o.cold) : null;
  if (cold) {
    const pairs: [string, RunFile, RunFile][] = [[`\`${main.tag}\` vs \`${cold.tag}\``, main, cold]];
    const vA = o.verify?.[0] ? loadRun(o.outDir, o.verify[0]) : null;
    const vB = o.verify?.[1] ? loadRun(o.outDir, o.verify[1]) : null;
    if (vA && vB) pairs.push([`with verification: \`${vA.tag}\` vs \`${vB.tag}\``, vA, vB]);
    R.push(`Same settings, fresh engine process and empty search cache (\`${cold.tag}\`: ${cold.games.length} games, ${cold.threads} threads, run after the main run on the same busy CPU). "Severity class" = ok (Book/Forced/Best/Great/Excellent/Good) / Inaccuracy / Mistake+Miss / Blunder.`);
    R.push('');
    R.push('| comparison | plies | label differs | severity class differs | ?!/?/?? differs | Great flips | Miss flips | engine #1 move differs | class changes with winLoss within ±1 of 5/10/20 |');
    R.push('|---|---|---|---|---|---|---|---|---|');
    for (const [name, a, b] of pairs) {
      const s = pairStats(a, b);
      R.push(`| ${name} | ${s.n} | ${pct(s.exact, s.n)} | **${pct(s.coarse, s.n)}** | ${pct(s.judge, s.n)} | ${s.great} | ${s.miss} | ${pct(s.bestMove, s.n)} | ${s.coarseNear} of ${s.coarse} |`);
      if (a === main) D.push('## Stability: labels that changed on the cold re-run', '', '| game | move | main (winLoss) | cold (winLoss) | best main / cold | best score | played score | deep search |', '|---|---|---|---|---|---|---|---|', ...s.rows, '');
    }
    R.push('');
    R.push('<!-- ANALYSIS:stability -->');
    R.push('');
  } else R.push('(no cold run)\n');

  // --- 7. depth --------------------------------------------------------------------------------------------
  R.push('## 7. Depth trade-off');
  R.push('');
  const depthRuns = (o.depths ?? []).map((t) => loadRun(o.outDir, t)).filter((x): x is RunFile => !!x);
  const ref = o.ref ? loadRun(o.outDir, o.ref) : null;
  const all = [...depthRuns, ...(ref && !depthRuns.some((r) => r.tag === ref.tag) ? [ref] : [])];
  if (all.length) {
    R.push('Cost and Lichess agreement of each run on its own games (engine time = the deep searches a label needs: one MultiPV-5 search per position + `searchmoves` for a played move outside the top 5; the product adds ≈ 0.3–1 s/ply of explanation searches):');
    R.push('');
    R.push('| run | games | plies | threads | s/ply (engine) | min per 80 plies | deep searches stopped by the cap | median nodes per deep search | vs Lichess (lichess profile, exact) |');
    R.push('|---|---|---|---|---|---|---|---|---|');
    for (const r of all) {
      const pl = r.games.flatMap((g) => g.plies);
      const ms = r.games.reduce((a, g) => a + g.engineMs, 0);
      const capped = pl.filter((p) => p.deep.depth < r.depth).length;
      const nodes = pl.map((p) => p.deep.nodes).sort((a, b) => a - b);
      const lc = confusion(pl.map((p): [J, J] => [toJudgement(p.labels.lichess.label, p.labels.lichess.winChance), p.lichess.judgement ?? 'none']));
      R.push(`| \`${r.tag}\` (d${r.depth}${r.maxMs ? `, cap ${r.maxMs} ms` : ', no cap'}) | ${r.games.length} | ${pl.length} | ${r.threads} | ${f1(ms / 1000 / pl.length)} | ${f1((80 * ms) / 1000 / pl.length / 60)} | ${pct(capped, pl.length)} | ${((nodes[nodes.length >> 1] ?? 0) / 1e6).toFixed(1)} M | ${pct(lc.agree, lc.total)} |`);
    }
    R.push('');
    const cmp: [string, RunFile, RunFile][] = [];
    if (ref) for (const r of all) if (r !== ref) cmp.push([`\`${r.tag}\` vs reference \`${ref.tag}\``, r, ref]);
    for (let i = 0; i < depthRuns.length; i++) for (let j = i + 1; j < depthRuns.length; j++) if (depthRuns[i] !== ref && depthRuns[j] !== ref) cmp.push([`\`${depthRuns[i]!.tag}\` vs \`${depthRuns[j]!.tag}\``, depthRuns[i]!, depthRuns[j]!]);
    if (cold) cmp.push([`(noise floor: \`${main.tag}\` vs \`${cold.tag}\`, same depth)`, main, cold]);
    R.push('Label agreement between runs (common plies, default profile):');
    R.push('');
    R.push('| comparison | plies | label differs | severity class differs | ?!/?/?? differs | Great flips | Miss flips |');
    R.push('|---|---|---|---|---|---|---|');
    for (const [name, a, b] of cmp) {
      const s = pairStats(a, b);
      R.push(`| ${name} | ${s.n} | ${pct(s.exact, s.n)} | **${pct(s.coarse, s.n)}** | ${pct(s.judge, s.n)} | ${s.great} | ${s.miss} |`);
    }
    R.push('');
    R.push('<!-- ANALYSIS:depth -->');
    R.push('');
  } else R.push('(no depth runs)\n');

  // per-ply timing distribution of the main run
  const times = plies.map(({ p }) => p.deep.timeMs + (p.searchmoves?.timeMs ?? 0)).sort((a, b) => a - b);
  const q = (x: number) => times[Math.min(times.length - 1, Math.floor(x * times.length))]!;
  R.push(`Main run per-ply engine time (deep + searchmoves): median ${q(0.5)} ms, p90 ${q(0.9)} ms, max ${q(1)} ms; deep search stopped by the time cap before d${main.depth}: ${pct(plies.filter(({ p }) => p.deep.depth < main.depth).length, totalPlies)}.`);
  R.push('');
  R.push('<!-- ANALYSIS:end -->');

  // splice hand-written analysis sections (bench/labels.analysis.md: "## <marker>" blocks)
  const anaPath = join(o.reportDir, '..', 'labels.analysis.md');
  let text = R.join('\n');
  if (existsSync(anaPath)) {
    const ana = readFileSync(anaPath, 'utf8');
    for (const block of ana.split(/^<!-- /m).slice(1)) {
      const m = /^(ANALYSIS:\w+) -->\n([\s\S]*)$/.exec(block);
      if (m) text = text.replace(`<!-- ${m[1]} -->`, m[2]!.trim());
    }
  }
  text = text.replace(/<!-- ANALYSIS:\w+ -->\n?/g, '');
  writeFileSync(join(o.reportDir, 'labels.md'), text + '\n');
  writeFileSync(join(o.reportDir, 'labels-details.md'), D.join('\n') + '\n');
  process.stderr.write(`wrote ${join(o.reportDir, 'labels.md')} and labels-details.md\n`);
}
