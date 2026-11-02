// The identity directions for "Tophat". Colours, fonts and card shapes live in identity.css (`[data-dir=…]`);
// here: names for the lab panel, the two background patterns of each direction and the board arrow colours.

export type DirId = 'waistcoat' | 'garden' | 'lemon' | 'card';
export type Shadow = 'hard' | 'soft' | 'none';
export type Bg = '0' | '1' | '2';
export type Mark = 'theme' | 'blackletter';

export interface Direction {
  id: DirId;
  name: string;
  lead: string;
  tagline: string;
  fonts: string;
  /** Move list as columns (a score sheet) or as running text (a printed game). */
  moves: 'columns' | 'prose';
  patterns: [{ name: string; css: string }, { name: string; css: string }];
  arrows: { better: string; threat: string };
}

const svg = (body: string, w: number, h = w) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`)}")`;

/** Lace doily: a ring of 12 eyelets around two circles, tiled. */
function doily(color: string): string {
  const eyelets = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6;
    return `<circle cx='${(70 + 27 * Math.cos(a)).toFixed(1)}' cy='${(70 + 27 * Math.sin(a)).toFixed(1)}' r='7'/>`;
  }).join('');
  const holes = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6 + Math.PI / 12;
    return `<circle cx='${(70 + 14 * Math.cos(a)).toFixed(1)}' cy='${(70 + 14 * Math.sin(a)).toFixed(1)}' r='1.6' fill='${color}' fill-opacity='.6'/>`;
  }).join('');
  return svg(
    `<g fill='none' stroke='${color}' stroke-width='1.1'><circle cx='70' cy='70' r='34'/><circle cx='70' cy='70' r='20'/>${eyelets}${holes}` +
      `<circle cx='0' cy='0' r='9'/><circle cx='140' cy='0' r='9'/><circle cx='0' cy='140' r='9'/><circle cx='140' cy='140' r='9'/></g>`,
    140,
  );
}

/** Victorian lattice: thin diagonals with a small four-point star where they cross. */
function damask(line: string, star: string): string {
  return svg(
    `<path d='M0 0 48 48M48 0 0 48' stroke='${line}' stroke-width='.8' fill='none'/>` +
      `<path d='M24 17 25.6 22.4 31 24 25.6 25.6 24 31 22.4 25.6 17 24 22.4 22.4Z' fill='${star}'/>` +
      `<path d='M0 -6 1.4 -1.4 6 0 1.4 1.4 0 6 -1.4 1.4 -6 0 -1.4 -1.4Z' transform='translate(0 0)' fill='${star}'/>` +
      `<path d='M0 -6 1.4 -1.4 6 0 1.4 1.4 0 6 -1.4 1.4 -6 0 -1.4 -1.4Z' transform='translate(48 0)' fill='${star}'/>` +
      `<path d='M0 -6 1.4 -1.4 6 0 1.4 1.4 0 6 -1.4 1.4 -6 0 -1.4 -1.4Z' transform='translate(0 48)' fill='${star}'/>` +
      `<path d='M0 -6 1.4 -1.4 6 0 1.4 1.4 0 6 -1.4 1.4 -6 0 -1.4 -1.4Z' transform='translate(48 48)' fill='${star}'/>`,
    48,
  );
}

export const DIRECTIONS: Direction[] = [
  {
    id: 'waistcoat',
    name: 'Waistcoat',
    lead: 'The striped vest, told by the UI alone: wide muted stripes, ink outlines, buttons you want to press.',
    tagline: 'your games, tailored',
    fonts: 'Fraunces (soft serif) + Figtree',
    moves: 'columns',
    // colours come from the palette (--stripe / --stripe-line in identity.css)
    patterns: [
      { name: 'Wide stripes', css: 'repeating-linear-gradient(90deg, transparent 0 110px, var(--stripe) 110px 220px)' },
      { name: 'Pinstripe', css: 'repeating-linear-gradient(90deg, transparent 0 55px, var(--stripe-line) 55px 56px)' },
    ],
    arrows: { better: '#3f7d4e', threat: '#b5402a' },
  },
  {
    id: 'garden',
    name: 'Garden party',
    lead: 'The lawn, the lace, the parasol: linen, hedge green, scalloped lace cards.',
    tagline: 'a gentle review of your games',
    fonts: 'Gloock (display serif) + Instrument Sans',
    moves: 'prose',
    patterns: [
      { name: 'Lace doily', css: `${doily('rgba(47,61,44,.10)')} 0 0 / 140px 140px` },
      { name: 'Mown lawn', css: 'repeating-linear-gradient(90deg, #f1f3e6 0 160px, #e8edda 160px 320px)' },
    ],
    arrows: { better: '#2f7a4a', threat: '#b8473a' },
  },
  {
    id: 'lemon',
    name: 'Lemonade',
    lead: 'The pastel game UI: butter yellow, olive outlines, chunky buttons, stitched panels, tabs.',
    tagline: 'chess review, with a hat on',
    fonts: 'Fredoka (rounded) + Lexend',
    moves: 'columns',
    patterns: [
      { name: 'Polka dots', css: 'radial-gradient(circle, rgba(140,120,20,.16) 2px, transparent 2.6px) 0 0 / 26px 26px' },
      {
        name: 'Picnic gingham',
        css:
          'repeating-linear-gradient(90deg, rgba(214,190,60,.16) 0 18px, transparent 18px 36px), repeating-linear-gradient(0deg, rgba(214,190,60,.16) 0 18px, transparent 18px 36px)',
      },
    ],
    arrows: { better: '#4f8a2b', threat: '#d64545' },
  },
  {
    id: 'card',
    name: 'Calling card',
    lead: 'The Lalka poster: ink on paper, gold foil, Bodoni, double rules and corner ornaments.',
    tagline: 'chess, properly reviewed · est. 2026',
    fonts: 'Bodoni Moda (didone) + Jost',
    moves: 'prose',
    patterns: [
      { name: 'Damask lattice', css: `${damask('rgba(22,20,18,.07)', 'rgba(168,132,44,.22)')} 0 0 / 48px 48px` },
      { name: 'Engraving', css: 'repeating-linear-gradient(135deg, rgba(22,20,18,.045) 0 1px, transparent 1px 7px)' },
    ],
    arrows: { better: '#2f5a43', threat: '#9e2b25' },
  },
];

/** Colour palettes for Waistcoat (identity.css `[data-palette=…]`); `swatch` = paper, ink, accent, dark square. */
export const PALETTES = [
  { id: 'chocolate', name: 'Chocolate', swatch: ['#fffaf0', '#4a2e1f', '#a34a28', '#b98a5e'] },
  { id: 'tophat', name: 'Top hat', swatch: ['#fdfcf8', '#1f2a3d', '#b08a3e', '#8e9aae'] },
  { id: 'powder', name: 'Powder blue', swatch: ['#fbfcfd', '#4a2e1f', '#a9c7de', '#a7bccd'] },
  { id: 'blush', name: 'Blush', swatch: ['#fffaf8', '#4a2b2a', '#eeb3a8', '#d7aaa2'] },
  { id: 'sage', name: 'Sage', swatch: ['#fdfdf8', '#363a2b', '#b6cfa4', '#a9bb98'] },
  { id: 'lavender', name: 'Lavender', swatch: ['#fdfbff', '#3a2e47', '#c9b6e4', '#b1a4c7'] },
  { id: 'mint', name: 'Mint', swatch: ['#fbfefc', '#2c3f38', '#a8dcc5', '#9fc4b2'] },
  { id: 'apricot', name: 'Apricot', swatch: ['#fffbf6', '#4a2e1f', '#f5bf94', '#dcab84'] },
] as const;
export type PaletteId = (typeof PALETTES)[number]['id'];

export function parseParams(search: string) {
  const q = new URLSearchParams(search);
  const p = q.get('p');
  const d = q.get('d');
  const s = q.get('shadow');
  const b = q.get('bg');
  return {
    dir: (DIRECTIONS.some((x) => x.id === d) ? d : 'waistcoat') as DirId,
    shadow: (s === 'soft' || s === 'none' ? s : 'hard') as Shadow,
    bg: (b === '0' || b === '2' ? b : '1') as Bg,
    mark: (q.get('mark') === 'blackletter' ? 'blackletter' : 'theme') as Mark,
    palette: (PALETTES.some((x) => x.id === p) ? p : 'chocolate') as PaletteId,
  };
}
