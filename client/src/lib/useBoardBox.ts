// Geometry for overlays drawn over the chessground board (badge, square tags): the board square area inside the
// overlay's parent (chessground's cg-container, which can be a few px smaller than its wrapper), kept up to date.
import type { Color } from '@chess-coach/shared';
import { onBeforeUnmount, onMounted, type Ref, ref } from 'vue';

export interface BoardBox {
  size: number;
  x: number;
  y: number;
}

export function useBoardBox(root: Ref<HTMLElement | null>) {
  const box = ref<BoardBox>({ size: 0, x: 0, y: 0 });
  let ro: ResizeObserver | null = null;
  let raf = 0;
  onMounted(() => {
    const parent = root.value?.parentElement;
    if (!parent) return;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const c = parent.querySelector<HTMLElement>('cg-container');
        const pr = parent.getBoundingClientRect();
        const r = c?.getBoundingClientRect() ?? pr;
        box.value = { size: r.width, x: r.left - pr.left, y: r.top - pr.top };
      });
    };
    measure();
    ro = new ResizeObserver(measure);
    ro.observe(parent);
    const c = parent.querySelector('cg-container');
    if (c) ro.observe(c);
  });
  onBeforeUnmount(() => {
    ro?.disconnect();
    cancelAnimationFrame(raf);
  });
  return box;
}

/** Top-left corner and size of `square` in a board box (null for a bad square / unmeasured board). */
export function squareRect(box: BoardBox, square: string, orientation: Color): { left: number; top: number; size: number } | null {
  const s = box.size;
  if (!s || !/^[a-h][1-8]$/.test(square)) return null;
  const sq = s / 8;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  return { left: box.x + col * sq, top: box.y + row * sq, size: sq };
}
