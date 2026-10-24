import { describe, expect, it } from 'vitest';
import { fixtureGame } from '../fixtures/game';
import { pgnToGame } from '../fixtures/pgnGame';
import { buildMoveRows } from './moveRows';
import { MoveTree } from './moveTree';

const short = pgnToGame('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. O-O Nf6', null);

describe('MoveTree navigation', () => {
  it('builds the main line and steps through it', () => {
    const t = new MoveTree(short);
    expect(t.lastMainPly).toBe(8);
    expect(t.current).toBe(t.root);
    expect(t.prev()).toBe(false);
    expect(t.next()).toBe(true);
    expect(t.current.san).toBe('e4');
    t.last();
    expect(t.current.san).toBe('Nf6');
    expect(t.next()).toBe(false);
    t.first();
    expect(t.current.ply).toBe(0);
    t.goToMainPly(3);
    expect(t.current.san).toBe('Nf3');
    t.goToMainPly(99);
    expect(t.current.ply).toBe(8);
    expect(t.inSideLine).toBe(false);
  });

  it('playing the next main-line move just advances', () => {
    const t = new MoveTree(short);
    t.goToMainPly(2);
    const r = t.play('g1f3')!;
    expect(r.created).toBe(false);
    expect(r.node).toBe(t.mainLine[3]);
    expect(t.mainLine[2]!.children).toHaveLength(1);
  });

  it('castling in either notation matches the main-line move', () => {
    const t = new MoveTree(short);
    t.goToMainPly(6);
    expect(t.play('e1h1')!.node).toBe(t.mainLine[7]);
    t.goToMainPly(6);
    expect(t.play('e1g1')!.node).toBe(t.mainLine[7]);
  });

  it('a different move creates a side line; replaying it re-enters the same branch', () => {
    const t = new MoveTree(short);
    t.goToMainPly(4); // after 2... Nc6
    const a = t.play('f1c4')!;
    expect(a.created).toBe(true);
    expect(a.node.san).toBe('Bc4');
    expect(a.node.mainPly).toBeNull();
    expect(t.inSideLine).toBe(true);
    expect(t.branchPoint()).toBe(t.mainLine[4]);
    t.play('f8c5');
    t.play('c2c3');
    expect(t.path().map((n) => n.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3']);

    t.goToMainPly(4);
    const again = t.play('f1c4')!;
    expect(again.created).toBe(false);
    expect(again.node).toBe(a.node);
    expect(t.mainLine[4]!.children).toHaveLength(2);
    expect(t.variations(t.mainLine[4]!)).toEqual([a.node]);
  });

  it('▶▶ in a side line goes to its end, "back to game" returns to the branch point', () => {
    const t = new MoveTree(short);
    t.goToMainPly(4);
    const start = t.play('f1c4')!.node;
    t.play('f8c5');
    t.play('c2c3');
    t.goTo(start);
    t.last();
    expect(t.current.san).toBe('c3');
    t.prev();
    expect(t.current.san).toBe('Bc5');
    t.backToGame();
    expect(t.current).toBe(t.mainLine[4]);
    expect(t.inSideLine).toBe(false);
  });

  it('supports nested variations and lines played from an engine PV', () => {
    const t = new MoveTree(short);
    t.goToMainPly(4);
    const bc4 = t.play('f1c4')!.node;
    const bc5 = t.play('f8c5')!.node;
    t.goTo(bc4);
    const nf6 = t.play('g8f6')!.node; // sub-variation inside the side line
    expect(bc4.children).toEqual([bc5, nf6]);
    expect(t.branchPoint(nf6)).toBe(t.mainLine[4]);
    const nodes = t.playLine(['d2d3', 'f8e7'], nf6);
    expect(nodes.map((n) => n.san)).toEqual(['d3', 'Be7']);
    expect(t.lineFrom(nf6).map((n) => n.san)).toEqual(['Nf6', 'd3', 'Be7']);
    expect(t.findById(nodes[1]!.id)).toBe(nodes[1]);
    expect(t.isOnCurrentPath(bc4)).toBe(true);
    expect(t.isOnCurrentPath(bc5)).toBe(false);
  });

  it('rejects illegal moves', () => {
    const t = new MoveTree(short);
    expect(t.play('e2e5')).toBeNull();
    expect(t.play('zz')).toBeNull();
    expect(t.current).toBe(t.root);
  });

  it('handles promotions in side lines', () => {
    const t = new MoveTree({ startFen: '8/4P3/8/8/8/k7/8/K7 w - - 0 1', moves: [] });
    const r = t.play('e7e8q')!;
    expect(r.node.san).toBe('e8=Q');
    expect(r.node.mainPly).toBeNull();
  });
});

describe('move list rows', () => {
  it('puts side lines after the main-line move they replace', () => {
    const t = new MoveTree(short);
    t.goToMainPly(4);
    t.play('f1c4'); // alternative to 3. Bb5 (White's move)
    t.goToMainPly(5);
    t.play('g8f6'); // alternative to 3... a6 (Black's move)
    const rows = buildMoveRows(t);
    const shape = rows.map((r) =>
      r.kind === 'row' ? `${r.number}:${r.white?.san ?? '…'}/${r.black?.san ?? ''}` : `var:${r.starts.map((s) => s.san).join(',')}`,
    );
    expect(shape).toEqual(['1:e4/e5', '2:Nf3/Nc6', '3:Bb5/', 'var:Bc4', '3:…/a6', 'var:Nf6', '4:O-O/Nf6']);
  });

  it('lays out the 72-ply fixture game in 36 rows', () => {
    const t = new MoveTree(fixtureGame().game);
    const rows = buildMoveRows(t);
    expect(rows).toHaveLength(36);
  });
});
