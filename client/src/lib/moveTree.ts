// Move tree: the game's main line plus user-created side lines, with a cursor. Pure TS (no Vue) so it can be
// unit-tested; the session wraps it in `reactive()`.
//
// Invariants:
//  - `root` is the start position (ply 0). Main-line nodes have `mainPly` = their ply (1-based).
//  - For a main-line node, `children[0]` is the next main-line node (if any); further children are side lines.
//  - For a side-line node, `children[0]` is the first continuation that was played; others are sub-variations.
//  - A move from a node is stored at most once: playing the same move again re-enters the existing child.
import type { Color, GameInfo } from '@chess-coach/shared';
import { playUci } from './chess';

export interface TreeNode {
  id: string;
  parent: TreeNode | null;
  children: TreeNode[];
  /** Plies from the start position (root = 0). */
  ply: number;
  /** Move that led here (empty for the root). */
  uci: string;
  san: string;
  color: Color | null;
  fenBefore: string | null;
  /** Position after the move (root: start FEN). */
  fen: string;
  /** Ply on the main line, or null for side-line nodes. */
  mainPly: number | null;
}

export interface PlayResult {
  node: TreeNode;
  /** True if a new side-line node was created. */
  created: boolean;
}

let sideCounter = 0;

export class MoveTree {
  readonly root: TreeNode;
  /** mainLine[p] = node after ply p (mainLine[0] = root). */
  readonly mainLine: TreeNode[];
  current: TreeNode;

  constructor(game: Pick<GameInfo, 'startFen' | 'moves'>) {
    this.root = {
      id: 'root', parent: null, children: [], ply: 0, uci: '', san: '', color: null,
      fenBefore: null, fen: game.startFen, mainPly: 0,
    };
    this.mainLine = [this.root];
    let prev = this.root;
    for (const m of game.moves) {
      const node: TreeNode = {
        id: `m${m.ply}`, parent: prev, children: [], ply: m.ply, uci: m.uci, san: m.san, color: m.color,
        fenBefore: m.fenBefore, fen: m.fenAfter, mainPly: m.ply,
      };
      prev.children.push(node);
      this.mainLine.push(node);
      prev = node;
    }
    this.current = this.root;
  }

  /** See backToGame(). Set by the session when an alternative to a game move is played from its panel. */
  returnTo: TreeNode | null = null;

  get lastMainPly(): number {
    return this.mainLine.length - 1;
  }

  isMain(node: TreeNode = this.current): boolean {
    return node.mainPly !== null;
  }

  get inSideLine(): boolean {
    return !this.isMain(this.current);
  }

  /** The main-line node a side line branches from (the current node itself when on the main line). */
  branchPoint(node: TreeNode = this.current): TreeNode {
    let n: TreeNode = node;
    while (n.mainPly === null && n.parent) n = n.parent;
    return n;
  }

  /**
   * Play a move (UCI, either castling notation) from the current position. If the move already exists as a child
   * (main-line continuation or an earlier side line) the cursor just moves there; otherwise a side-line node is
   * created. Returns null for an illegal move.
   */
  play(uci: string, from: TreeNode = this.current): PlayResult | null {
    const played = playUci(from.fen, uci);
    if (!played) return null;
    const existing = from.children.find((c) => c.uci === played.uci);
    if (existing) {
      this.current = existing;
      // Return via `this.current` so a reactive tree hands out its proxy (stable identity for callers).
      return { node: this.current, created: false };
    }
    const node: TreeNode = {
      id: `s${++sideCounter}`, parent: from, children: [], ply: from.ply + 1, uci: played.uci, san: played.san,
      color: played.color, fenBefore: from.fen, fen: played.fenAfter, mainPly: null,
    };
    from.children.push(node);
    this.current = node;
    return { node: this.current, created: true };
  }

  /** Play a sequence of UCI moves from `from` (e.g. an engine line). Returns the nodes visited/created. */
  playLine(ucis: readonly string[], from: TreeNode = this.current): TreeNode[] {
    const out: TreeNode[] = [];
    let cur = from;
    for (const u of ucis) {
      const r = this.play(u, cur);
      if (!r) break;
      out.push(r.node);
      cur = r.node;
    }
    return out;
  }

  goTo(node: TreeNode): void {
    this.current = node;
  }

  goToMainPly(ply: number): void {
    const p = Math.max(0, Math.min(this.lastMainPly, ply));
    this.current = this.mainLine[p]!;
  }

  /** ▶: follow the first child. Returns false at the end of a line. */
  next(): boolean {
    const c = this.current.children[0];
    if (!c) return false;
    this.current = c;
    return true;
  }

  /** ◀: go to the parent. Returns false at the root. */
  prev(): boolean {
    if (!this.current.parent) return false;
    this.current = this.current.parent;
    return true;
  }

  /** ◀◀ */
  first(): void {
    this.current = this.root;
  }

  /** ▶▶: end of the current line (main line: last move of the game; side line: its last move). */
  last(): void {
    let n = this.current;
    while (n.children[0]) n = n.children[0];
    this.current = n;
  }

  /**
   * "Back to game": return to the main-line position the current side line branched from — or to `returnTo`, the
   * game move the user was looking at when they played an alternative to it (e.g. "Play it" on a suggestion for a
   * blunder returns to the blunder, not to the move before it).
   */
  backToGame(): void {
    const bp = this.branchPoint(this.current);
    const r = this.returnTo;
    this.returnTo = null;
    this.current = r && r.mainPly !== null && r.parent?.id === bp.id && this.current.mainPly === null ? r : bp;
  }

  /** Nodes from the root (exclusive) to `node` (inclusive). */
  path(node: TreeNode = this.current): TreeNode[] {
    const out: TreeNode[] = [];
    for (let n: TreeNode | null = node; n && n.parent; n = n.parent) out.push(n);
    return out.reverse();
  }

  /** The line continuing from `node` (inclusive) along first children. */
  lineFrom(node: TreeNode): TreeNode[] {
    const out: TreeNode[] = [];
    for (let n: TreeNode | undefined = node; n; n = n.children[0]) out.push(n);
    return out;
  }

  /** Side-line starts branching from `node` (children other than the main/first continuation). */
  variations(node: TreeNode): TreeNode[] {
    return node.children.slice(1);
  }

  /** True if `node` is on the path to the current node (for highlighting the active line). */
  isOnCurrentPath(node: TreeNode): boolean {
    for (let n: TreeNode | null = this.current; n; n = n.parent) if (n === node) return true;
    return false;
  }

  findById(id: string): TreeNode | null {
    const stack: TreeNode[] = [this.root];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.id === id) return n;
      stack.push(...n.children);
    }
    return null;
  }
}
