// Board looks tried in the piece lab: square palettes and coordinate styles. The palette sets --th-sq-light /
// --th-sq-dark (style.css paints the squares from them); a coordinate style is a class (co-<id>, PieceLab.vue).

export interface BoardPalette {
  id: string;
  name: string;
  light: string;
  dark: string;
  /** Last-move tint. */
  last: string;
  note: string;
}

export const BOARD_PALETTES: BoardPalette[] = [
  { id: 'chocolate', name: 'Chocolate', light: '#f3e3c3', dark: '#b98a5e', last: 'rgba(163, 74, 40, 0.3)', note: 'today' },
  { id: 'caramel', name: 'Caramel', light: '#f6e8cc', dark: '#cfa46f', last: 'rgba(163, 74, 40, 0.28)', note: 'lighter, warmer' },
  { id: 'walnut', name: 'Walnut', light: '#eedbb8', dark: '#9c6d4a', last: 'rgba(214, 120, 60, 0.38)', note: 'more contrast' },
  { id: 'sage', name: 'Sage', light: '#f1e8d1', dark: '#9aab84', last: 'rgba(210, 150, 50, 0.42)', note: 'green on cream' },
  { id: 'slate', name: 'Slate', light: '#efe6d3', dark: '#8aa0ac', last: 'rgba(210, 150, 50, 0.42)', note: 'the info blue' },
  { id: 'terracotta', name: 'Terracotta', light: '#f5e4c9', dark: '#c98b66', last: 'rgba(120, 60, 30, 0.25)', note: 'the rust accent' },
];

export interface CoordStyle {
  id: string;
  name: string;
  note: string;
}

export const COORD_STYLES: CoordStyle[] = [
  { id: 'ink', name: 'Ink', note: 'today: faint ink everywhere' },
  { id: 'contrast', name: 'Two-tone', note: 'each in the other square colour' },
  { id: 'serif', name: 'Fraunces', note: 'two-tone, in the display face' },
  { id: 'frame', name: 'Frame', note: 'outside, on a chocolate rim' },
  { id: 'none', name: 'None', note: '' },
];
