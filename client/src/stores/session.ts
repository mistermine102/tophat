// Session store: the loaded game, streamed analyses, the move tree/cursor, side-line analyses, your side.
// "You" = the side at the bottom of the board: flipping the board switches it, and the choice is remembered per game
// (lib/sides.ts). A game opens with the remembered side, else the side whose player name matches the chess.com name
// last looked up in the Open dialog, else the server's guess (GameInfo.you).
// Plain Vue reactivity; one instance per app (provided via `provide`/`inject`, see useSession()).
import type { Color, GameInfo, GameSummary, MoveAnalysis, Tone } from '@chess-coach/shared';
import { computed, inject, reactive, watch, type InjectionKey } from 'vue';
import { ApiError, type ApiClient, type Health, type Unsubscribe } from '../api/types';
import { MoveTree, type TreeNode } from '../lib/moveTree';
import { loadRecent, recentKey, rememberGame, type RecentGame } from '../lib/recent';
import { loadChessComName, loadSide, saveChessComName, saveSide, sideOfName } from '../lib/sides';
import { LABELS } from '../lib/labels';
import { computeSummary } from '../lib/summary';

export interface SideEntry {
  status: 'pending' | 'done' | 'error';
  analysis?: MoveAnalysis;
  error?: string;
}

export interface Preview {
  /** Position shown on the board instead of the current node. */
  fen: string;
  /** Move leading to it (for highlight). */
  uci: string;
  /** Short description shown above the board. */
  caption: string;
  /** (UI prototypes) Arrows to draw on the previewed position (default: none). */
  arrows?: PreviewArrow[];
  /** (UI prototypes) A ✓ / ✗ / • marker at the corner of a square (e.g. the destination of a replayed step). */
  marker?: { square: string; tone: Tone };
}

export interface PreviewArrow {
  from: string;
  to: string;
  /** Brush: a suggestion colour ('pick' green, 'best' blue, 'threat' red, 'played' grey) or a tone. */
  brush: 'pick' | 'best' | 'threat' | 'played' | Tone;
}

export interface SessionOptions {
  focusDebounceMs?: number;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Called when the loaded game changes (e.g. to update the URL). */
  onGameChange?: (id: string | null) => void;
}

/** How often the engine's health is checked again while it is offline. */
export const HEALTH_RETRY_MS = 5000;

export function createSession(api: ApiClient, opts: SessionOptions = {}) {
  const focusDebounceMs = opts.focusDebounceMs ?? 250;
  const storage = opts.storage ?? null;

  const state = reactive({
    game: null as GameInfo | null,
    tree: null as MoveTree | null,
    analyses: {} as Record<number, MoveAnalysis>,
    plyErrors: {} as Record<number, string>,
    side: new Map<string, SideEntry>(),
    progress: { done: 0, total: 0 },
    serverSummary: null as GameSummary | null,
    you: 'white' as Color,
    orientation: 'white' as Color,
    loading: false,
    loadError: null as string | null,
    connectionError: null as string | null,
    preview: null as Preview | null,
    /** The chess.com username last looked up in the Open dialog (remembered in the browser). */
    chessComName: loadChessComName(storage, api.mode),
    recent: loadRecent(storage, recentKey(api.mode)) as RecentGame[],
    /** Last /api/health answer (null = not checked yet). */
    health: null as Health | null,
    /** Squares highlighted on the board (hovering a square name in an explanation). */
    highlight: [] as string[],
    /** For the time-left estimate: when this session started waiting for the stream, and how many plies were done then. */
    rate: null as { start: number; doneAtStart: number; last: number } | null,
  });

  let unsubscribe: Unsubscribe | null = null;
  let focusTimer: ReturnType<typeof setTimeout> | null = null;
  const focused = new Set<number>();

  const current = computed<TreeNode | null>(() => state.tree?.current ?? null);

  function analysisFor(node: TreeNode | null | undefined): MoveAnalysis | null {
    if (!node || node.ply === 0) return null;
    if (node.mainPly !== null) return state.analyses[node.mainPly] ?? null;
    return state.side.get(node.id)?.analysis ?? null;
  }

  function isPending(node: TreeNode | null | undefined): boolean {
    if (!node || node.ply === 0) return false;
    if (node.mainPly !== null) return !state.analyses[node.mainPly] && !state.plyErrors[node.mainPly];
    const e = state.side.get(node.id);
    return !e || e.status === 'pending';
  }

  function errorFor(node: TreeNode | null | undefined): string | null {
    if (!node || node.ply === 0) return null;
    if (node.mainPly !== null) return state.plyErrors[node.mainPly] ?? null;
    return state.side.get(node.id)?.error ?? null;
  }

  const currentAnalysis = computed(() => analysisFor(current.value));

  const summary = computed<GameSummary | null>(() => {
    if (!state.game) return null;
    const local = computeSummary(state.game, state.analyses);
    const s = state.serverSummary;
    return s && s.done >= local.done ? s : local;
  });

  const progress = computed(() => {
    const total = state.game?.moves.length ?? 0;
    const done = Math.max(state.progress.done, Object.keys(state.analyses).length);
    const failed = Object.keys(state.plyErrors).filter((p) => !state.analyses[Number(p)]).length;
    return { done: Math.min(done, total), total, failed };
  });

  /**
   * Rough seconds left for the whole game, from the pace since this session started streaming (null until a few
   * moves have arrived — the first ones are fast because the opening is quick for the engine).
   */
  const etaSeconds = computed<number | null>(() => {
    const r = state.rate;
    const p = progress.value;
    if (!r) return null;
    const doneHere = p.done - r.doneAtStart;
    const left = p.total - p.done - p.failed;
    if (doneHere < 4 || left <= 0 || r.last <= r.start) return null;
    return Math.round(((r.last - r.start) / 1000 / doneHere) * left);
  });

  function stopStream() {
    unsubscribe?.();
    unsubscribe = null;
  }

  function reset() {
    stopStream();
    if (focusTimer) clearTimeout(focusTimer);
    focusTimer = null;
    focused.clear();
    state.game = null;
    state.tree = null;
    state.analyses = {};
    state.plyErrors = {};
    state.side = new Map();
    state.progress = { done: 0, total: 0 };
    state.serverSummary = null;
    state.preview = null;
    state.highlight = [];
    state.connectionError = null;
    state.rate = null;
  }

  function applyGame(game: GameInfo) {
    state.game = game;
    state.tree = new MoveTree(game);
    const side = loadSide(storage, api.mode, game.id) ?? sideOfName(game.headers, state.chessComName) ?? game.you;
    state.you = side;
    state.orientation = side;
    state.progress = { done: 0, total: game.moves.length };
    state.recent = rememberGame(storage, recentKey(api.mode), game);
  }

  function startStream(id: string) {
    stopStream();
    const now = Date.now();
    state.rate = { start: now, doneAtStart: Object.keys(state.analyses).length, last: now };
    unsubscribe = api.stream(id, {
      onAnalysis(ply, analysis) {
        if (state.game?.id !== id) return;
        if (!state.analyses[ply] && state.rate) state.rate.last = Date.now();
        state.analyses[ply] = analysis;
        delete state.plyErrors[ply];
        state.connectionError = null;
      },
      onProgress(done, total) {
        if (state.game?.id !== id) return;
        state.progress = { done, total };
      },
      onSummary(s) {
        if (state.game?.id !== id) return;
        state.serverSummary = s;
        if (s.done >= s.total) stopStream();
      },
      onPlyError(ply, message) {
        if (state.game?.id !== id) return;
        if (state.analyses[ply]) return; // stale replay of an error that was retried successfully
        state.plyErrors[ply] = message;
        focused.delete(ply);
        void checkHealth();
      },
      onConnectionError(message) {
        if (state.game?.id !== id) return;
        state.connectionError = message;
      },
      onOpen() {
        if (state.game?.id !== id) return;
        state.connectionError = null;
        // the stream is back, so the server is: refresh a stale "Engine offline"
        if (state.health && !state.health.ok) void checkHealth();
      },
    });
  }

  // While the engine (or the server) is down, look again every few seconds: "Engine offline" clears by itself once
  // it is back (e.g. after the dev server restarts), instead of staying until the page is reloaded.
  let healthTimer: ReturnType<typeof setTimeout> | null = null;
  async function checkHealth(): Promise<Health> {
    if (healthTimer) clearTimeout(healthTimer);
    healthTimer = null;
    const h = await api.health();
    state.health = h;
    if (!h.ok) healthTimer = setTimeout(() => void checkHealth(), HEALTH_RETRY_MS);
    return h;
  }

  /** Ask the server to analyse a failed main-line ply again (focus re-queues failed plies). */
  function retryPly(ply: number) {
    const game = state.game;
    if (!game || state.analyses[ply]) return;
    delete state.plyErrors[ply];
    focused.add(ply);
    api.focus(game.id, ply).catch((e: unknown) => {
      state.plyErrors[ply] = (e as Error).message;
      focused.delete(ply);
    });
  }

  /** Analyse a failed side-line move again. */
  function retrySide(node: TreeNode) {
    if (node.mainPly !== null) return;
    state.side.delete(node.id);
    requestSide(node);
  }

  function setHighlight(squares: string[]) {
    if (squares.length === 0 && state.highlight.length === 0) return;
    state.highlight = squares;
  }

  async function openGame(id: string): Promise<boolean> {
    state.loading = true;
    state.loadError = null;
    try {
      const snap = await api.getGame(id);
      reset();
      applyGame(snap.game);
      state.analyses = { ...snap.analyses };
      state.serverSummary = snap.summary;
      state.progress = { done: Object.keys(snap.analyses).length, total: snap.game.moves.length };
      opts.onGameChange?.(snap.game.id);
      if (Object.keys(snap.analyses).length < snap.game.moves.length) startStream(snap.game.id);
      else if (!snap.summary) startStream(snap.game.id);
      return true;
    } catch (e) {
      state.loadError = e instanceof ApiError ? e.message : `Could not open the game: ${(e as Error).message}`;
      return false;
    } finally {
      state.loading = false;
    }
  }

  /** Import a PGN (`side`: your side, when known — e.g. a game from your chess.com list). Throws ApiError (e.g. 400 bad PGN) for the dialog to show. */
  async function importPgn(pgn: string, side?: Color): Promise<void> {
    state.loading = true;
    try {
      const game = await api.createGame(pgn);
      if (side) saveSide(storage, api.mode, game.id, side);
      const ok = await openGame(game.id);
      if (!ok) throw new ApiError(state.loadError ?? 'Could not open the game.');
    } finally {
      state.loading = false;
    }
  }

  // --- side-line analysis + focus ---------------------------------------------------------------------------

  function requestSide(node: TreeNode) {
    if (node.mainPly !== null || state.side.has(node.id) || !node.fenBefore) return;
    state.side.set(node.id, { status: 'pending' });
    const parent = node.parent;
    const prev = parent && parent.fenBefore ? { fenBefore: parent.fenBefore, uci: parent.uci } : undefined;
    const gameId = state.game?.id;
    api
      .analyse({ fenBefore: node.fenBefore, uci: node.uci, ...(prev ? { prev } : {}) })
      .then((analysis) => {
        if (state.game?.id === gameId) state.side.set(node.id, { status: 'done', analysis });
      })
      .catch((e: unknown) => {
        if (state.game?.id === gameId) state.side.set(node.id, { status: 'error', error: (e as Error).message });
      });
  }

  function scheduleFocus(ply: number) {
    if (focusTimer) clearTimeout(focusTimer);
    focusTimer = setTimeout(() => {
      focusTimer = null;
      const game = state.game;
      if (!game || state.analyses[ply] || focused.has(ply)) return;
      focused.add(ply);
      api.focus(game.id, ply).catch(() => focused.delete(ply));
    }, focusDebounceMs);
  }

  watch(
    () => current.value?.id,
    () => {
      const node = current.value;
      state.preview = null;
      state.highlight = [];
      if (!node || node.ply === 0) return;
      if (node.mainPly !== null) {
        if (!state.analyses[node.mainPly] && !state.plyErrors[node.mainPly]) scheduleFocus(node.mainPly);
      } else {
        requestSide(node);
      }
    },
  );

  // --- navigation ---------------------------------------------------------------------------------------------

  const nav = {
    next: () => state.tree?.next(),
    prev: () => state.tree?.prev(),
    first: () => state.tree?.first(),
    last: () => state.tree?.last(),
    backToGame: () => state.tree?.backToGame(),
    goTo: (node: TreeNode) => state.tree?.goTo(node),
    goToMainPly: (ply: number) => state.tree?.goToMainPly(ply),
  };

  /** A move made on the board (UCI). */
  function playMove(uci: string): TreeNode | null {
    return state.tree?.play(uci)?.node ?? null;
  }

  /** Enter an engine line from `from` (e.g. clicking a PV move): plays the first `count` moves. */
  function playLine(from: TreeNode, ucis: string[], count = ucis.length): void {
    const tree = state.tree;
    if (!tree) return;
    // "Back to game" should come back to the game move whose alternative this is
    const here = tree.current;
    tree.returnTo = here.mainPly !== null && here.parent?.id === from.id ? here : null;
    const nodes = tree.playLine(ucis.slice(0, count), from);
    if (nodes.length) tree.goTo(nodes[nodes.length - 1]!);
  }

  /** Next main-line ply after the viewed position with an inaccuracy or worse (either side), or null. */
  const nextMistakePly = computed<number | null>(() => {
    const tree = state.tree;
    const game = state.game;
    if (!tree || !game) return null;
    const from = tree.branchPoint(tree.current).mainPly ?? 0;
    for (let p = from + 1; p <= game.moves.length; p++) {
      const a = state.analyses[p];
      if (a && LABELS[a.label].severity >= 3) return p;
    }
    return null;
  });

  function nextMistake() {
    const p = nextMistakePly.value;
    if (p !== null) state.tree?.goToMainPly(p);
  }

  /** Turn the board around; the side at the bottom is "You" (remembered for this game). */
  function flip() {
    setSide(state.orientation === 'white' ? 'black' : 'white');
  }

  function setSide(side: Color) {
    state.orientation = side;
    state.you = side;
    if (state.game) saveSide(storage, api.mode, state.game.id, side);
  }

  function rememberChessComName(name: string) {
    state.chessComName = name;
    saveChessComName(storage, api.mode, name);
  }

  function setPreview(p: Preview | null) {
    state.preview = p;
  }

  function dispose() {
    stopStream();
    if (focusTimer) clearTimeout(focusTimer);
    if (healthTimer) clearTimeout(healthTimer);
  }

  return {
    api,
    state,
    current,
    currentAnalysis,
    summary,
    progress,
    etaSeconds,
    nextMistakePly,
    nextMistake,
    analysisFor,
    isPending,
    errorFor,
    openGame,
    importPgn,
    playMove,
    playLine,
    flip,
    rememberChessComName,
    setPreview,
    checkHealth,
    retryPly,
    retrySide,
    setHighlight,
    dispose,
    ...nav,
  };
}

export type Session = ReturnType<typeof createSession>;
export const SessionKey: InjectionKey<Session> = Symbol('session');

export function useSession(): Session {
  const s = inject(SessionKey);
  if (!s) throw new Error('useSession() called without a provided session');
  return s;
}
