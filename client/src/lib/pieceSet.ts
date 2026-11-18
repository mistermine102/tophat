// The Tophat piece set: Staunton pieces drawn like the rest of the page (an ink outline, flat two-tone shading, cream
// and chocolate). Each piece is a few soft, chunky parts, each outlined, stacked on one shared base (the king set the
// language); inner lines, eyes and the knight's mane go on top. The style (outline, shading, colours) is applied here,
// so one change restyles the whole set. The pieces are served to chessground as CSS background images
// (pieceSetCss); roles without a design keep chessground's cburnett art.
//
// Coordinates: a 100×100 square, x = 50 the axis, the pieces standing on the base at y = 74–86.5.

export type Role = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';
export type PieceColor = 'white' | 'black';

const f = (n: number) => +n.toFixed(2);
type Pt = [number, number];

export interface Design {
  /** Filled, outlined shapes (path data), back to front. */
  parts: string[];
  /** Inner lines (path data), stroked in the detail colour. */
  lines?: string[];
  /** Small filled marks (eyes, nostrils) in the detail colour. */
  dots?: string[];
  /** Shade offset for this piece (the light comes from the upper left). */
  shade?: Pt;
}

/** A rounded rectangle as path data. */
function rrect(x: number, y: number, w: number, h: number, r: number): string {
  return `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${r} ${r} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}A${r} ${r} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${r} ${r} 0 0 1 ${f(x)} ${f(y + h - r)}V${f(y + r)}A${r} ${r} 0 0 1 ${f(x + r)} ${f(y)}Z`;
}

/** A circle as path data. */
function circle(cx: number, cy: number, r: number): string {
  return `M${f(cx - r)} ${f(cy)}A${r} ${r} 0 1 1 ${f(cx + r)} ${f(cy)}A${r} ${r} 0 1 1 ${f(cx - r)} ${f(cy)}Z`;
}

// The set's language: simple, plain parts (circles, straight-sided shapes, rounded bars), each outlined, stacked on
// one base. No concave flares: straight sides keep the pieces plain.
const BASE = rrect(22, 74, 56, 12.5, 6.25);

// ---------------------------------------------------------------- king

// a cross on a crown (wide at the top), a collar, a body widening to the base
const KING: Design = {
  parts: [
    'M45.5 3.5H54.5V9.5H61V18H54.5V27H45.5V18H39V9.5H45.5Z',
    'M38 52L31 76H69L62 52Z',
    BASE,
    'M29 25H71L62.5 46H37.5Z',
    rrect(31.5, 43, 37, 10, 5),
  ],
  lines: ['M33.5 31.5H66.5'],
};

// ---------------------------------------------------------------- pawn

// a round head on a collar, a body widening to the base
const PAWN: Design = {
  parts: ['M41.5 50L34 76H66L58.5 50Z', rrect(24, 74, 52, 12.5, 6.25), rrect(34, 44, 32, 9, 4.5), circle(50, 31, 12.8)],
};

// ---------------------------------------------------------------- knight

// the classic "?" in a few plain strokes: up the front of the neck, the cut under the jaw, the jaw, the round muzzle,
// the straight face, one ear, the arched crest and back
const KNIGHT: Design = {
  parts: [
    'M33 76C34.5 66 44.5 60 46.4 49.5' + // front of the neck
      'L44 47.6' + // the cut under the jaw
      'L22.5 56.4' + // jaw
      'C15.8 59 10.4 54.6 10.6 48.6C10.8 45.4 12.4 42.6 15 40.6' + // muzzle
      'L37.4 14.4' + // face
      'L42.6 5.2L47.8 13.6' + // ear
      'C66 14 80 28 80.6 46C81 60 79 68 76.4 76Z', // crest, back
    BASE,
  ],
  lines: ['M53 18.6C66.6 21.4 74.4 32.6 75.2 46.4C75.8 57 74.6 66 72.4 72.6'],
  dots: [circle(32.6, 26.4, 2.7)],
  // flatter light: the long jaw would get a heavy band under it
  shade: [-5, -2],
};

// ---------------------------------------------------------------- the set

export const DESIGNS: Partial<Record<Role, Design>> = {
  pawn: PAWN,
  knight: KNIGHT,
  king: KING,
};

// ---------------------------------------------------------------- style

export interface PieceStyle {
  /** Outline width (in the 100-unit square). */
  outline: number;
  /** Flat shading: a darker crescent on each part's lower right. */
  shading: boolean;
  /** A solid ink "drop" under the piece, like the buttons' shadow. */
  drop: boolean;
  white: PiecePalette;
  black: PiecePalette;
}

export interface PiecePalette {
  fill: string;
  shade: string;
  ink: string;
  /** Inner lines and eyes. */
  detail: string;
}

export const WHITE_PALETTES = {
  paper: { fill: '#fffaf0', shade: '#ecdcbc', ink: '#4a2e1f', detail: '#4a2e1f' },
  ivory: { fill: '#fff6e2', shade: '#e6cfa6', ink: '#3b2418', detail: '#3b2418' },
} satisfies Record<string, PiecePalette>;

export const BLACK_PALETTES = {
  chocolate: { fill: '#5a3a28', shade: '#3e2617', ink: '#2e1b11', detail: '#f1e4c9' },
  ink: { fill: '#3d2519', shade: '#2a170d', ink: '#24140b', detail: '#e9d6b4' },
  rust: { fill: '#8f3d1f', shade: '#6a2a13', ink: '#3a1d10', detail: '#f6e3c8' },
} satisfies Record<string, PiecePalette>;

export const DEFAULT_STYLE: PieceStyle = {
  outline: 4.2,
  shading: true,
  drop: true,
  white: WHITE_PALETTES.paper,
  black: BLACK_PALETTES.chocolate,
};

/** The SVG for one piece, or null when the set has no design for it. */
export function pieceSvg(role: Role, color: PieceColor, style: PieceStyle = DEFAULT_STYLE): string | null {
  const d = DESIGNS[role];
  return d ? designSvg(d, color, style) : null;
}

export function designSvg(d: Design, color: PieceColor, style: PieceStyle = DEFAULT_STYLE): string {
  const p = style[color];
  const w = style.outline;
  const [sx, sy] = d.shade ?? [-4.5, -3.5];
  const defs: string[] = [];
  const out: string[] = [];
  const use = (i: number, attrs = '') => `<use href="#p${i}"${attrs ? ' ' + attrs : ''}/>`;
  d.parts.forEach((part, i) => defs.push(`<path id="p${i}" d="${part}"/>`));
  if (style.drop) {
    // the whole silhouette, outlined and moved down: shows as a solid ink lip under the base
    out.push(`<g transform="translate(0 3.2)" fill="${p.ink}" stroke="${p.ink}" stroke-width="${w}" stroke-linejoin="round">${d.parts.map((_, i) => use(i)).join('')}</g>`);
  }
  d.parts.forEach((_, i) => {
    out.push(use(i, `fill="${p.fill}"`));
    if (style.shading) {
      // the part in the shade colour, then again in the fill colour moved towards the light: a crescent on the lower right
      defs.push(`<clipPath id="c${i}">${use(i)}</clipPath>`);
      out.push(`<g clip-path="url(#c${i})">${use(i, `fill="${p.shade}"`)}${use(i, `fill="${p.fill}" transform="translate(${sx} ${sy})"`)}</g>`);
    }
    out.push(use(i, `fill="none" stroke="${p.ink}" stroke-width="${w}" stroke-linejoin="round"`));
  });
  for (const l of d.lines ?? []) out.push(`<path d="${l}" fill="none" stroke="${p.detail}" stroke-width="${f(w * 0.72)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  for (const dot of d.dots ?? []) out.push(`<path d="${dot}" fill="${p.detail}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>${defs.join('')}</defs>${out.join('')}</svg>`;
}

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** CSS putting the set's pieces into chessground's <piece> elements under `scope` (other roles stay cburnett). */
export function pieceSetCss(scope: string, style: PieceStyle = DEFAULT_STYLE): string {
  const rules: string[] = [];
  for (const role of Object.keys(DESIGNS) as Role[]) {
    for (const color of ['white', 'black'] as const) {
      const svg = pieceSvg(role, color, style)!;
      rules.push(`html ${scope} piece.${role}.${color} { background-image: url("${svgDataUri(svg)}"); }`);
    }
  }
  return rules.join('\n');
}

/** Puts (or replaces) the set's CSS in the page, in a <style> element with this id. */
export function installPieceSet(id: string, scope: string, style: PieceStyle = DEFAULT_STYLE): void {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = pieceSetCss(scope, style);
}
