// Opening book lookup (SPEC "Move labels" -> Book).
//
// Data: Lichess `chess-openings` (https://github.com/lichess-org/chess-openings, CC0, see
// server/data/openings/COPYING.txt), files a.tsv..e.tsv with columns `eco  name  pgn`, vendored unchanged.
//
// The book is loaded lazily on first use: every `pgn` is replayed with chessops and every position along it is
// keyed by its EPD (board, turn, castling, legal en-passant square; no clocks), so transpositions are found.
// Names: a position that ends a TSV line gets that line's name (the shortest such line wins; ties -> first in file
// order a..e). A position that only occurs *inside* lines gets the name of its deepest named ancestor on the
// shortest line through it (e.g. the position after 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 is named by its own entry,
// an unnamed intermediate position inherits the opening it belongs to).

//
// Loading is environment-neutral: the TSV contents come from a registered source — `setBookSource` (sync; Node:
// core/src/node.ts reads data/openings/ from disk) or `loadBookAsync(read)` (the browser worker fetches the files
// as static assets). Lookups before either throw.

import { Chess } from 'chessops/chess';
import { INITIAL_FEN, makeFen, parseFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';

export interface BookEntry {
  eco: string;
  name: string;
  /** Plies from the initial position on the line the name was taken from. */
  ply: number;
}

export interface BookInfo {
  /** Book entry of the position after the move, or null if that position isn't in the book. */
  after: BookEntry | null;
  /** The position before the move is the standard initial position or is itself in the book. */
  beforeIsStartOrBook: boolean;
}

export const BOOK_FILES = ['a.tsv', 'b.tsv', 'c.tsv', 'd.tsv', 'e.tsv'];

export interface BookFile {
  file: string;
  content: string;
}

let source: (() => BookFile[]) | null = null;

/** Register a synchronous source of the TSV files (read on first lookup). */
export function setBookSource(read: (() => BookFile[]) | null): void {
  source = read;
}

/**
 * Position key: EPD = board + turn + castling + en-passant square (only if an en-passant capture is legal, as
 * chessops' `toSetup()` normalises it), no move clocks. Returns null for an invalid/illegal FEN.
 */
export function positionKey(fen: string): string | null {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) return null;
  return keyOf(pos.value);
}

function keyOf(pos: Chess): string {
  return makeFen(pos.toSetup(), { epd: true });
}

export const INITIAL_KEY: string = positionKey(INITIAL_FEN)!;

interface ParsedLine {
  eco: string;
  name: string;
  keys: string[]; // key after ply 1..n
}

/** Parse one TSV file's content into lines (skips the header and malformed rows; throws on illegal SAN). */
function parseTsv(content: string, file: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  const rows = content.split(/\r?\n/);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    if (!row.trim()) continue;
    const [eco, name, pgn] = row.split('\t');
    if (r === 0 && eco === 'eco') continue;
    if (!eco || !name || !pgn) continue;
    const pos = Chess.default();
    const keys: string[] = [];
    for (const tok of pgn.trim().split(/\s+/)) {
      if (/^\d+\.+$/.test(tok) || tok === '*') continue;
      const san = tok.replace(/^\d+\.+/, '');
      if (!san) continue;
      const move = parseSan(pos, san);
      if (!move) throw new Error(`book ${file}:${r + 1}: illegal SAN "${san}" in "${pgn}"`);
      pos.play(move);
      keys.push(keyOf(pos));
    }
    if (keys.length > 0) out.push({ eco, name, keys });
  }
  return out;
}

/** Build the position map from TSV contents (exported for tests). */
export function buildBook(contents: readonly { file: string; content: string }[]): Map<string, BookEntry> {
  const lines = contents.flatMap(({ file, content }) => parseTsv(content, file));
  const map = new Map<string, BookEntry>();
  // 1. Named endpoints: shortest line wins, ties -> first.
  for (const l of lines) {
    const key = l.keys[l.keys.length - 1]!;
    const prev = map.get(key);
    if (!prev || l.keys.length < prev.ply) map.set(key, { eco: l.eco, name: l.name, ply: l.keys.length });
  }
  const named = new Set(map.keys());
  // 2. Intermediate positions: inherit the deepest named ancestor on the line (or the line itself), keeping the
  //    entry from the line on which the position is reached soonest.
  const reachedAt = new Map<string, number>();
  for (const l of lines) {
    const own: BookEntry = { eco: l.eco, name: l.name, ply: l.keys.length };
    let lastNamed: BookEntry | null = null;
    for (let i = 0; i < l.keys.length; i++) {
      const key = l.keys[i]!;
      if (named.has(key)) {
        lastNamed = map.get(key)!;
        continue;
      }
      const ancestor = lastNamed ?? own;
      const ply = i + 1;
      const seen = reachedAt.get(key);
      if (seen === undefined || ply < seen) {
        reachedAt.set(key, ply);
        map.set(key, { eco: ancestor.eco, name: ancestor.name, ply });
      }
    }
  }
  return map;
}

let book: Map<string, BookEntry> | null = null;
let loadMs = 0;

/** Load (once, from the registered source) and return the book. */
export function loadBook(): Map<string, BookEntry> {
  if (book) return book;
  if (!source) throw new Error('opening book not loaded (setBookSource / loadBookAsync)');
  const t0 = performance.now();
  book = buildBook(source());
  loadMs = performance.now() - t0;
  return book;
}

/** Load the book (once) from an async reader of the TSV files, e.g. `fetch` of static assets. */
export async function loadBookAsync(read: (file: string) => Promise<string>): Promise<Map<string, BookEntry>> {
  if (book) return book;
  const contents = await Promise.all(BOOK_FILES.map(async (file) => ({ file, content: await read(file) })));
  if (book) return book;
  const t0 = performance.now();
  book = buildBook(contents);
  loadMs = performance.now() - t0;
  return book;
}

/** Milliseconds the last `loadBook()` took (0 before loading). */
export function bookLoadMs(): number {
  return loadMs;
}

/** Book entry of the position `fen` (move clocks ignored), or null. */
export function lookupBook(fen: string): BookEntry | null {
  const key = positionKey(fen);
  if (!key) return null;
  return loadBook().get(key) ?? null;
}

/** Book info for a move fenBefore -> fenAfter (see BookInfo). */
export function bookInfo(fenBefore: string, fenAfter: string): BookInfo {
  const beforeKey = positionKey(fenBefore);
  const before = beforeKey !== null && (beforeKey === INITIAL_KEY || loadBook().has(beforeKey));
  return { after: lookupBook(fenAfter), beforeIsStartOrBook: before };
}

/**
 * True when the position after the move is in the book and the position before is the initial position or in the
 * book. (The SPEC chain rule "every earlier move was book" is checked by the caller: see ClassifyInput.book.)
 */
export function isBookMove(fenBefore: string, fenAfter: string): boolean {
  const info = bookInfo(fenBefore, fenAfter);
  return info.after !== null && info.beforeIsStartOrBook;
}
