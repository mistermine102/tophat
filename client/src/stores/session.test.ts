import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { MockApiClient } from '../api/mock';
import { FIXTURE_ID } from '../fixtures/game';
import { createSession } from './session';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function setup() {
  const api = new MockApiClient({ intervalMs: 150, analyseDelayMs: 300, createDelayMs: 0 });
  const focus = vi.spyOn(api, 'focus');
  const analyse = vi.spyOn(api, 'analyse');
  const session = createSession(api, { focusDebounceMs: 250 });
  const opened = session.openGame(FIXTURE_ID);
  await vi.advanceTimersByTimeAsync(1);
  expect(await opened).toBe(true);
  return { api, session, focus, analyse };
}

describe('session store', () => {
  it('opens a game oriented to the user and fills in analyses from the stream', async () => {
    const { session } = await setup();
    expect(session.state.you).toBe('black');
    expect(session.state.orientation).toBe('black');
    expect(session.current.value?.ply).toBe(0);
    await vi.advanceTimersByTimeAsync(151 * 3);
    expect(Object.keys(session.state.analyses).length).toBe(3);
    expect(session.progress.value).toEqual({ done: 3, total: 72 });
    expect(session.summary.value?.done).toBe(3);
  });

  it('debounces focus() while stepping quickly and only focuses unanalysed main-line plies', async () => {
    const { session, focus } = await setup();
    for (let i = 0; i < 30; i++) {
      session.next();
      await nextTick();
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(300);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledWith(FIXTURE_ID, 30);
    // The focused ply arrives next.
    await vi.advanceTimersByTimeAsync(150);
    expect(session.currentAnalysis.value?.san).toBe('exd4');
  });

  it('a board move creates a side line analysed with the previous move as context; back to game', async () => {
    const { session, analyse } = await setup();
    session.goToMainPly(20);
    await nextTick();
    const node = session.playMove('g1h1')!;
    await nextTick();
    expect(node.mainPly).toBeNull();
    expect(session.isPending(node)).toBe(true);
    expect(analyse).toHaveBeenCalledTimes(1);
    const req = analyse.mock.calls[0]![0];
    expect(req.uci).toBe('g1h1');
    expect(req.fenBefore).toBe(session.state.game!.moves[19]!.fenAfter);
    expect(req.prev).toEqual({ fenBefore: session.state.game!.moves[19]!.fenBefore, uci: session.state.game!.moves[19]!.uci });
    await vi.advanceTimersByTimeAsync(301);
    expect(session.isPending(node)).toBe(false);
    expect(session.currentAnalysis.value?.san).toBe('Kh1');

    // Re-entering the same branch doesn't analyse again.
    session.goToMainPly(20);
    await nextTick();
    expect(session.playMove('g1h1')).toBe(node);
    await nextTick();
    expect(analyse).toHaveBeenCalledTimes(1);

    session.backToGame();
    await nextTick();
    expect(session.current.value?.mainPly).toBe(20);
    // Playing the game's own next move just advances along the main line.
    expect(session.playMove('h2h3')?.mainPly).toBe(21);
  });

  it('playLine enters an engine line as a side line from the position before the move', async () => {
    const { session } = await setup();
    session.goToMainPly(21);
    const parent = session.current.value!.parent!;
    session.playLine(parent, ['b2b4', 'h5g3', 'h2g3'], 2);
    await nextTick();
    expect(session.current.value?.san).toBe('Nxg3');
    expect(session.state.tree!.inSideLine).toBe(true);
  });

  it('settings change re-orients the open game', async () => {
    const { session } = await setup();
    const p = session.saveSettings({ username: 'BishopBlunder99' });
    await vi.advanceTimersByTimeAsync(60);
    await p;
    expect(session.state.you).toBe('white');
    expect(session.state.orientation).toBe('white');
    session.flip();
    expect(session.state.orientation).toBe('black');
  });

  it('reports unknown games', async () => {
    const api = new MockApiClient();
    const session = createSession(api);
    const p = session.openGame('nope');
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe(false);
    expect(session.state.loadError).toBe('Game not found.');
  });
});
