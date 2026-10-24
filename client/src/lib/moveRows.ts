// Layout of the move list: main-line rows (number | White | Black) with side-line blocks inserted after the
// main-line move they are an alternative to (lichess style: "12. Nf3 … (12. Bd3 …) 12... Nc6").
import { fullmoveNumber, sideToMove } from './chess';
import type { MoveTree, TreeNode } from './moveTree';

export type MoveRowItem =
  | { kind: 'row'; key: string; number: number; white: TreeNode | null; black: TreeNode | null }
  | { kind: 'variations'; key: string; starts: TreeNode[] };

export function buildMoveRows(tree: MoveTree): MoveRowItem[] {
  const items: MoveRowItem[] = [];
  let row: Extract<MoveRowItem, { kind: 'row' }> | null = null;
  const flush = () => {
    if (row) items.push(row);
    row = null;
  };
  for (let p = 1; p <= tree.lastMainPly; p++) {
    const node = tree.mainLine[p]!;
    const parent = tree.mainLine[p - 1]!;
    const n = fullmoveNumber(node.fenBefore!);
    const white = sideToMove(node.fenBefore!) === 'white';
    if (white) {
      flush();
      row = { kind: 'row', key: `r${p}`, number: n, white: node, black: null };
    } else {
      if (!row) row = { kind: 'row', key: `r${p}`, number: n, white: null, black: node };
      else row.black = node;
    }
    const vars = tree.variations(parent);
    if (vars.length) {
      flush();
      items.push({ kind: 'variations', key: `v${p}`, starts: vars });
    }
  }
  flush();
  return items;
}
