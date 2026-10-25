// Compare label-benchmark runs (data/bench/labels-<tag>.json) on their common plies — e.g. the M4 performance
// check: did a faster engine configuration change the labels more than run-to-run noise does?
//
//   npx tsx bench/label-compare.ts <tagA>[+tagA2...] <tagB>[+tagB2...] [<tagC> ...]
//
// "a+b" merges runs (e.g. two benchmark processes that ran in parallel on different games). Prints for every pair:
// common plies, label differs, severity class differs (ok / ?! / ? or Miss / ??), ?!/?/?? differs, Great / Miss
// flips, and for every run its agreement with Lichess (lichess threshold profile, exact) on the common plies, the
// engine time per ply and the share of deep searches stopped by the time cap.

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunFile } from './label-benchmark';
import { confusion, loadRun, pairStats, toJudgement } from './lib/labelReport';

const OUT_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'data', 'bench');
const specs = process.argv.slice(2);
if (specs.length < 2) {
  console.error('usage: npx tsx bench/label-compare.ts <tagA>[+tagA2] <tagB>[+tagB2] [...]');
  process.exit(2);
}

function load(spec: string): RunFile {
  const runs = spec.split('+').map((t) => {
    const r = loadRun(OUT_DIR, t);
    if (!r) throw new Error(`no run ${t} in ${OUT_DIR}`);
    return r;
  });
  return { ...runs[0]!, tag: spec, games: runs.flatMap((r) => r.games) };
}

const runs = specs.map(load);
// common games/plies of all runs
const common = new Set(runs[0]!.games.flatMap((g) => g.plies.map((p) => `${g.id}:${p.ply}`)));
for (const r of runs.slice(1)) {
  const mine = new Set(r.games.flatMap((g) => g.plies.map((p) => `${g.id}:${p.ply}`)));
  for (const k of common) if (!mine.has(k)) common.delete(k);
}
const restrict = (r: RunFile): RunFile => ({ ...r, games: r.games.map((g) => ({ ...g, plies: g.plies.filter((p) => common.has(`${g.id}:${p.ply}`)) })).filter((g) => g.plies.length) });
const rs = runs.map(restrict);
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '–');

console.log(`common plies: ${common.size}\n`);
console.log('| run | depth / cap | threads | engine s/ply | deep capped | vs Lichess (lichess profile, exact) |');
console.log('|---|---|---|---|---|---|');
for (const r of rs) {
  const pl = r.games.flatMap((g) => g.plies);
  const ms = pl.reduce((a, p) => a + p.deep.timeMs + (p.searchmoves?.timeMs ?? 0), 0);
  const capped = pl.filter((p) => p.deep.depth < r.depth).length;
  const lc = confusion(pl.map((p) => [toJudgement(p.labels.lichess.label, p.labels.lichess.winChance), p.lichess.judgement ?? 'none']));
  console.log(`| \`${r.tag}\` | d${r.depth} / ${r.maxMs || 'none'} | ${r.threads} | ${(ms / 1000 / pl.length).toFixed(2)} | ${pct(capped, pl.length)} | ${pct(lc.agree, lc.total)} |`);
}
console.log('\n| comparison | plies | label differs | severity class differs | ?!/?/?? differs | Great flips | Miss flips | engine #1 differs |');
console.log('|---|---|---|---|---|---|---|---|');
for (let i = 0; i < rs.length; i++) {
  for (let j = i + 1; j < rs.length; j++) {
    const s = pairStats(rs[i]!, rs[j]!);
    console.log(`| \`${rs[i]!.tag}\` vs \`${rs[j]!.tag}\` | ${s.n} | ${pct(s.exact, s.n)} | **${pct(s.coarse, s.n)}** | ${pct(s.judge, s.n)} | ${s.great} | ${s.miss} | ${pct(s.bestMove, s.n)} |`);
  }
}
