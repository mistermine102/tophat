// Benchmarks the Immediate-fact detectors (server/src/facts/immediate.ts) against Lichess puzzle themes.
//
// Usage: npx tsx bench/puzzle-facts.ts [--theme fork|all] [--n 500] [--neg 3000] [--samples 20] [--report]
//        [--db path/to/lichess_db_puzzle.csv.zst] [--max-scan 2000000] [--seed 1]
//
// Puzzle rows: FEN is the position BEFORE the opponent's move Moves[0]; Moves[1], Moves[3], … are the solver's.
// For each theme row we measure
//   - recall on the first solver move (or on the opponent's move Moves[0] for "opp" rows),
//   - recall on any solver move (the theme is often realised later in the line),
//   - fire rate of the same detector on the first solver move of puzzles WITHOUT the theme (an upper bound on the
//     false-positive rate: Lichess theme tags are incomplete, so many of these are legitimate),
// and dump a random sample of those non-theme firings to bench/reports/puzzle-facts-samples.md for eyeballing.
// Eyeballed precision (judged by hand from the samples) is read from bench/puzzle-facts.eyeball.json.

import { closeSync, createReadStream, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { createZstdDecompress } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseUci, type NormalMove } from 'chessops';
import { makeFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import type { Fact } from '@chess-coach/shared';
import { immediateFactsFromPosition } from '../server/src/facts/immediate';
import { positionFromFen } from '../server/src/chess/material';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const flag = (name: string) => args.includes(`--${name}`);

// Default: <repo>/data/bench/…; from a git worktree under <repo>/.claude/worktrees/<name> use the main checkout's.
const DB_CANDIDATES = [
  arg('db', ''),
  join(here, '..', 'data', 'bench', 'lichess_db_puzzle.csv.zst'),
  join(here, '..', '..', '..', '..', 'data', 'bench', 'lichess_db_puzzle.csv.zst'),
].filter(Boolean);
const N = Number(arg('n', '500'));
const NEG = Number(arg('neg', '3000'));
const SAMPLES = Number(arg('samples', '20'));
const MAX_SCAN = Number(arg('max-scan', '3000000'));
let seed = Number(arg('seed', '1'));
const THEME_ARG = arg('theme', 'all');

type Pred = (facts: Fact[], move: NormalMove, fenBefore: string) => boolean;
interface Row {
  id: string;
  theme: string;
  /** which move is checked for "first-move" recall and fire rate */
  at: 'solver' | 'opponent' | 'last';
  pred: Pred;
  describe: string;
}

const has = (t: Fact['type']): Pred => (facts) => facts.some((f) => f.type === t);
const ROWS: Row[] = [
  { id: 'fork', theme: 'fork', at: 'solver', pred: has('fork'), describe: '`fork`' },
  { id: 'pin', theme: 'pin', at: 'solver', pred: has('pin'), describe: '`pin`' },
  { id: 'skewer', theme: 'skewer', at: 'solver', pred: has('skewer'), describe: '`skewer`' },
  {
    id: 'discoveredAttack', theme: 'discoveredAttack', at: 'solver', describe: '`discovered-attack` or discovered `check`/`checkmate`',
    pred: (facts) => facts.some((f) => f.type === 'discovered-attack' || ((f.type === 'check' || f.type === 'checkmate') && f.discovered)),
  },
  {
    id: 'doubleCheck', theme: 'doubleCheck', at: 'solver', describe: '`check`/`checkmate` with `double`',
    pred: (facts) => facts.some((f) => (f.type === 'check' || f.type === 'checkmate') && f.double),
  },
  {
    id: 'hangingPiece', theme: 'hangingPiece', at: 'solver', describe: '`capture` wins-material',
    pred: (facts) => facts.some((f) => f.type === 'capture' && f.outcome === 'wins-material'),
  },
  {
    id: 'hangingPiece (opp move hangs)', theme: 'hangingPiece', at: 'opponent', describe: '`hangs` or losing `capture` on Moves[0]',
    pred: (facts) => facts.some((f) => f.type === 'hangs' || (f.type === 'capture' && f.outcome === 'loses-material')),
  },
  { id: 'mateIn1', theme: 'mateIn1', at: 'solver', pred: has('checkmate'), describe: '`checkmate`' },
  { id: 'mateIn1 (opp move allows)', theme: 'mateIn1', at: 'opponent', pred: has('allows-mate'), describe: '`allows-mate` on Moves[0]' },
  { id: 'mate (last move)', theme: 'mate', at: 'last', pred: has('checkmate'), describe: '`checkmate` on the last solver move' },
  { id: 'promotion', theme: 'promotion', at: 'solver', pred: has('promotion'), describe: '`promotion`' },
  {
    id: 'enPassant', theme: 'enPassant', at: 'solver', describe: 'en-passant `capture`',
    pred: (facts, move) => facts.some((f) => f.type === 'capture' && f.captured.square !== sqName(move.to)),
  },
  { id: 'castling', theme: 'castling', at: 'solver', pred: has('castle'), describe: '`castle`' },
];

/** Index of the last solver move (solver plies are the odd indices). */
const lastSolver = (len: number) => (len % 2 === 0 ? len - 1 : len - 2);
const FILES = 'abcdefgh';
const sqName = (sq: number) => `${FILES[sq & 7]}${(sq >> 3) + 1}`;

const rows = THEME_ARG === 'all' ? ROWS : ROWS.filter((r) => r.theme === THEME_ARG || r.id === THEME_ARG);
if (!rows.length) throw new Error(`unknown theme ${THEME_ARG}; known: ${ROWS.map((r) => r.theme).join(', ')}`);

interface Puzzle { id: string; fen: string; moves: string[]; themes: Set<string>; url: string }

/** Plays the puzzle and returns per-ply (fenBefore, move, facts). */
function analyse(p: Puzzle) {
  const pos = positionFromFen(p.fen);
  const plies: { fen: string; uci: string; move: NormalMove; san: string; facts: Fact[] }[] = [];
  for (const uci of p.moves) {
    const move = parseUci(uci) as NormalMove;
    const fen = makeFen(pos.toSetup());
    const san = makeSan(pos, move);
    const facts = immediateFactsFromPosition(pos, uci);
    plies.push({ fen, uci, move, san, facts });
    pos.play(move);
  }
  return plies;
}

/**
 * Lines of a zstd-compressed text file. The Lichess dump is in pzstd format: every zstd frame is preceded by a
 * skippable frame (magic 0x184D2A50) holding the compressed size of the next frame, which Node's decoder rejects —
 * so frames are located by hand and decompressed one by one. Plain single-frame files work too.
 */
async function* zstdLines(path: string): AsyncGenerator<string> {
  const fd = openSync(path, 'r');
  const size = fstatSync(fd).size;
  const head = Buffer.alloc(12);
  const frames: [number, number][] = [];
  let at = 0;
  while (at + 12 <= size) {
    readSync(fd, head, 0, 12, at);
    if (head.readUInt32LE(0) !== 0x184d2a50 || head.readUInt32LE(4) !== 4) break;
    const len = head.readUInt32LE(8);
    frames.push([at + 12, at + 12 + len - 1]);
    at += 12 + len;
  }
  closeSync(fd);
  if (!frames.length) frames.push([0, size - 1]);
  let rest = '';
  for (const [start, end] of frames) {
    const stream = createReadStream(path, { start, end }).pipe(createZstdDecompress());
    for await (const chunk of stream) {
      const text = rest + (chunk as Buffer).toString('utf8');
      const lines = text.split('\n');
      rest = lines.pop()!;
      for (const l of lines) yield l.replace(/\r$/, '');
    }
  }
  if (rest) yield rest;
}

function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

async function main() {
  const db = DB_CANDIDATES.find((p) => existsSync(p));
  if (!db) throw new Error(`puzzle DB not found (tried ${DB_CANDIDATES.join(', ')}); pass --db`);
  const pos = new Map<string, Puzzle[]>(rows.map((r) => [r.id, []]));
  const pool: Puzzle[] = [];
  let scanned = 0;
  for await (const line of zstdLines(db)) {
    if (scanned++ === 0) continue; // header
    if (scanned > MAX_SCAN) break;
    const c = line.split(',');
    if (c.length < 9) continue;
    const p: Puzzle = { id: c[0], fen: c[1], moves: c[2].split(' '), themes: new Set(c[7].split(' ')), url: c[8] };

    for (const r of rows) {
      const list = pos.get(r.id)!;
      if (list.length < N && p.themes.has(r.theme)) {
        list.push(p);

      }
    }
    if (pool.length < NEG && rand() < 0.5) pool.push(p);
    if (pool.length >= NEG && rows.every((r) => pos.get(r.id)!.length >= N)) break;
  }

  const cache = new Map<string, ReturnType<typeof analyse>>();
  const get = (p: Puzzle) => {
    let a = cache.get(p.id);
    if (!a) {
      a = analyse(p);
      cache.set(p.id, a);
    }
    return a;
  };

  const eyeballPath = join(here, 'puzzle-facts.eyeball.json');
  const eyeball: Record<string, string> = existsSync(eyeballPath) ? JSON.parse(readFileSync(eyeballPath, 'utf8')) : {};
  const table: string[] = [
    '| theme row | detector | n | first-move recall | any-solver-move recall | fire rate on non-theme puzzles (n) | eyeballed precision of non-theme firings |',
    '|---|---|---|---|---|---|---|',
  ];
  const samplesOut: string[] = ['# Non-theme firings (random samples for eyeballing)', ''];
  const missesOut: string[] = ['# Misses (detector fired on no solver move; opponent/last rows: on the checked move), random samples', ''];
  const t0 = performance.now();
  let factCalls = 0;
  for (const r of rows) {
    const list = pos.get(r.id)!;
    let first = 0;
    let any = 0;
    const misses: Puzzle[] = [];
    for (const p of list) {
      const plies = get(p);
      factCalls += plies.length;
      const idx = r.at === 'opponent' ? 0 : r.at === 'last' ? lastSolver(plies.length) : 1;
      const at = plies[idx];
      const hit1 = at ? r.pred(at.facts, at.move, at.fen) : false;
      if (hit1) first++;
      const solver = plies.filter((_, i) => i % 2 === 1);
      const hitAny = r.at === 'opponent' ? hit1 : solver.some((s) => r.pred(s.facts, s.move, s.fen));
      if (hitAny) any++;
      // the misses file lists puzzles where the detector never fired on any checked move
      if (!hitAny || (r.at !== 'solver' && !hit1)) misses.push(p);
    }
    const neg = pool.filter((p) => !p.themes.has(r.theme));
    const fired: { p: Puzzle; ply: ReturnType<typeof analyse>[number] }[] = [];
    for (const p of neg) {
      const plies = get(p);
      const idx = r.at === 'opponent' ? 0 : r.at === 'last' ? lastSolver(plies.length) : 1;
      const at = plies[idx];
      if (at && r.pred(at.facts, at.move, at.fen)) fired.push({ p, ply: at });
    }
    const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : 'n/a');
    table.push(`| ${r.id} | ${r.describe} | ${list.length} | ${pct(first, list.length)} | ${r.at === 'solver' ? pct(any, list.length) : '—'} | ${pct(fired.length, neg.length)} (${neg.length}) | ${eyeball[r.id] ?? '—'} |`);
    console.log(`${r.id}: n=${list.length} first=${pct(first, list.length)} any=${pct(any, list.length)} fire=${pct(fired.length, neg.length)} of ${neg.length}`);

    // samples
    const pick = <T,>(xs: T[], k: number) => {
      const c = [...xs];
      const out: T[] = [];
      while (c.length && out.length < k) out.push(c.splice(Math.floor(rand() * c.length), 1)[0]);
      return out;
    };
    samplesOut.push(`## ${r.id} (${fired.length} firings)`, '');
    for (const { p, ply } of pick(fired, SAMPLES)) {
      samplesOut.push(`- ${p.id} ${p.url} — \`${ply.fen}\` **${ply.san}** (${ply.uci}) themes: ${[...p.themes].join(' ')}`);
      samplesOut.push(`  - ${JSON.stringify(ply.facts.filter((f) => r.pred([f], ply.move, ply.fen)))}`);
    }
    samplesOut.push('');
    missesOut.push(`## ${r.id} (${misses.length} misses)`, '');
    for (const p of pick(misses, SAMPLES)) {
      const plies = get(p);
      const idx = r.at === 'opponent' ? 0 : r.at === 'last' ? lastSolver(plies.length) : 1;
      const at = plies[idx];
      missesOut.push(`- ${p.id} ${p.url} — \`${at.fen}\` **${at.san}** (${at.uci}) line: ${plies.map((x) => x.san).join(' ')} themes: ${[...p.themes].join(' ')}`);
      missesOut.push(`  - facts: ${JSON.stringify(at.facts.map((f) => f.type))}`);
    }
    missesOut.push('');
  }
  const ms = performance.now() - t0;
  console.log(`\n${table.join('\n')}`);
  console.log(`\n${cache.size} puzzles, ${factCalls} fact calls, ${(ms / Math.max(1, cache.size)).toFixed(2)} ms/puzzle (incl. replay), scanned ${scanned} lines`);

  const reports = join(here, 'reports');
  mkdirSync(reports, { recursive: true });
  writeFileSync(join(reports, 'puzzle-facts-samples.md'), samplesOut.join('\n'));
  writeFileSync(join(reports, 'puzzle-facts-misses.md'), missesOut.join('\n'));
  if (flag('report')) {
    const notesPath = join(here, 'puzzle-facts.notes.md');
    const notes = existsSync(notesPath) ? readFileSync(notesPath, 'utf8') : '';
    writeFileSync(
      join(reports, 'puzzle-facts.md'),
      [
        '# Puzzle-theme benchmark of Immediate facts',
        '',
        `Generated by \`npx tsx bench/puzzle-facts.ts --report --n ${N} --neg ${NEG}\` (Lichess puzzle DB, first ${scanned} rows scanned, seed ${arg('seed', '1')}).`,
        '',
        table.join('\n'),
        '',
        notes,
      ].join('\n'),
    );
    console.log('wrote bench/reports/puzzle-facts.md');
  }
}

await main();
