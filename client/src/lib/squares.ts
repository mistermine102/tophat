// Square names in explanation text ("the knight on f6", "Nxd7", "Rd8#") -> segments, so hovering a square name can
// highlight it on the board.

export interface TextSegment {
  text: string;
  /** Square named by this segment (e.g. "f6"), if any. */
  square?: string;
}

// A square is [a-h][1-8] not followed by a digit and not glued to an ordinary word: the previous character must be
// a non-letter/non-digit, or part of a SAN move (piece letter K/Q/R/B/N, capture "x", a disambiguating file a-h or
// rank 1-8 as in "Nbd7" / "R1e2").
const SQUARE = /[a-h][1-8](?![0-9])/g;

function sanPrefixOk(text: string, i: number): boolean {
  // walk back over a SAN prefix like "N", "Nb", "Nbx", "exd" ... and require a word boundary before it
  let j = i - 1;
  let steps = 0;
  while (j >= 0 && steps < 4 && /[KQRBNxa-h1-8]/.test(text[j]!)) {
    j--;
    steps++;
  }
  if (steps === 0) return true;
  const before = j >= 0 ? text[j]! : ' ';
  if (/[A-Za-z0-9]/.test(before)) return false;
  // the prefix must look like SAN: optional piece, optional file/rank, optional x
  const prefix = text.slice(j + 1, i);
  return /^[KQRBN]?[a-h1-8]?x?$/.test(prefix) && prefix !== '';
}

export function squareSegments(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(SQUARE)) {
    const i = m.index;
    const prev = i > 0 ? text[i - 1]! : ' ';
    const ok = /[A-Za-z0-9]/.test(prev) ? sanPrefixOk(text, i) : true;
    if (!ok) continue;
    if (i > last) out.push({ text: text.slice(last, i) });
    out.push({ text: m[0], square: m[0] });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
