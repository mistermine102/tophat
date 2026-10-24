/**
 * Collects real amateur games with Lichess server analysis, for label benchmarks and explanation reviews.
 *
 * Game ids come from the puzzle dump (puzzles are mined from server-analysed games). The games are fetched with
 * `POST /api/games/export/_ids` (evals + literate annotations) and filtered by rating and time control.
 *
 *   npx tsx bench/fetch-lichess-games.ts [--min 800] [--max 1500] [--want 60] [--scan 40000]
 *
 * Output: bench/games/lichess/<id>.pgn and bench/games/lichess/index.json.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdLines } from './lib/zstd';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = join(ROOT, 'data', 'bench', 'lichess_db_puzzle.csv.zst');
const OUT = join(ROOT, 'bench', 'games', 'lichess');

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}

const minElo = arg('min', 800);
const maxElo = arg('max', 1500);
const want = arg('want', 60);
const scan = arg('scan', 40000);

function header(pgn: string, key: string): string | undefined {
  return new RegExp(`\\[${key} "([^"]*)"\\]`).exec(pgn)?.[1];
}

async function collectIds(): Promise<string[]> {
  const ids = new Set<string>();
  let n = 0;
  for await (const line of zstdLines(DB)) {
    if (n++ === 0) continue; // CSV header
    if (n > scan) break;
    const url = line.split(',')[8];
    const id = /lichess\.org\/(\w{8})/.exec(url ?? '')?.[1];
    if (id) ids.add(id);
  }
  // Deterministic shuffle so reruns pick the same games.
  const arr = [...ids].sort();
  let seed = 42;
  for (let i = arr.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function exportGames(ids: string[]): Promise<string[]> {
  const res = await fetch(
    'https://lichess.org/api/games/export/_ids?evals=true&literate=true&clocks=false&opening=true',
    { method: 'POST', body: ids.join(','), headers: { Accept: 'application/x-chess-pgn', 'Content-Type': 'text/plain' } },
  );
  if (res.status === 429) {
    console.error('rate limited, waiting 60 s');
    await new Promise((r) => setTimeout(r, 60_000));
    return exportGames(ids);
  }
  if (!res.ok) throw new Error(`export failed: ${res.status}`);
  const text = await res.text();
  return text.split(/\n\n(?=\[Event )/).map((g) => g.trim()).filter(Boolean);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const ids = await collectIds();
  console.error(`${ids.length} candidate game ids`);
  const kept: { id: string; white: string; black: string; whiteElo: number; blackElo: number; timeControl: string; opening?: string; plies: number }[] = [];
  for (let i = 0; i < ids.length && kept.length < want; i += 300) {
    const games = await exportGames(ids.slice(i, i + 300));
    for (const pgn of games) {
      if (kept.length >= want) break;
      const we = Number(header(pgn, 'WhiteElo')), be = Number(header(pgn, 'BlackElo'));
      const tc = header(pgn, 'TimeControl') ?? '-';
      const base = Number(tc.split('+')[0]);
      if (!(we >= minElo && we <= maxElo && be >= minElo && be <= maxElo)) continue;
      if (!(base >= 300)) continue; // rapid-ish and slower blitz: fewer pure time-scramble games
      if (header(pgn, 'Variant') && header(pgn, 'Variant') !== 'Standard') continue;
      if (!pgn.includes('[%eval')) continue;
      const id = /lichess\.org\/(?:game\/)?(\w{8})/.exec(header(pgn, 'Site') ?? '')?.[1];
      if (!id) continue;
      const plies = (pgn.match(/\[%eval/g) ?? []).length;
      if (plies < 30) continue;
      writeFileSync(join(OUT, `${id}.pgn`), pgn + '\n');
      kept.push({ id, white: header(pgn, 'White')!, black: header(pgn, 'Black')!, whiteElo: we, blackElo: be, timeControl: tc, opening: header(pgn, 'Opening'), plies });
    }
    console.error(`fetched batch ${i / 300 + 1}, kept ${kept.length}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(kept, null, 2) + '\n');
  console.error(`kept ${kept.length} games in ${OUT}`);
  if (!existsSync(join(OUT, 'index.json'))) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
