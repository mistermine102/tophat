// Screen layout switch (UI prototypes): `?ui=classic|a|b|c`, default classic. Only presentation differs — every
// layout uses the same session store.
import { ref } from 'vue';

export type UiMode = 'classic' | 'a' | 'b' | 'c';

export const UI_MODES: readonly { id: UiMode; short: string; name: string; hint: string }[] = [
  { id: 'classic', short: 'Classic', name: 'Classic', hint: 'The current three-column screen' },
  { id: 'a', short: 'A', name: 'Board-first', hint: 'Big board, the verdict bubble next to the moved piece, details on demand' },
  { id: 'b', short: 'B', name: 'Coach + replay', hint: 'A coach card that replays the consequences on the board' },
  { id: 'c', short: 'C', name: 'Good vs bad', hint: 'What goes wrong / what it does, and the better move' },
];

export function parseUiMode(search: string): UiMode {
  const v = new URLSearchParams(search).get('ui')?.toLowerCase();
  return v === 'a' || v === 'b' || v === 'c' || v === 'classic' ? v : 'classic';
}

export const uiMode = ref<UiMode>(typeof location === 'undefined' ? 'classic' : parseUiMode(location.search));

export function setUiMode(mode: UiMode) {
  uiMode.value = mode;
  if (typeof location === 'undefined') return;
  const url = new URL(location.href);
  if (mode === 'classic') url.searchParams.delete('ui');
  else url.searchParams.set('ui', mode);
  history.replaceState(null, '', url);
}
