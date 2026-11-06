// Helpers for the real E2E tests (in-browser analysis, Stockfish WASM; see playwright.config.ts).
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * `test` with one browser context (and page) per test file instead of per test: IndexedDB — the analysis cache —
 * carries over between the tests of a file, like the old server's sqlite file did (tests rely on games analysed by
 * earlier ones only where noted). chess.com is blocked (no network from tests).
 */
export const test = base.extend<{ page: Page; context: BrowserContext }, { shared: { context: BrowserContext; page: Page } }>({
  shared: [
    async ({ browser }, use, workerInfo) => {
      const context = await browser.newContext({ baseURL: workerInfo.project.use.baseURL });
      await context.route('https://api.chess.com/**', (route) => route.abort());
      const page = await context.newPage();
      await use({ context, page });
      await context.close();
    },
    { scope: 'worker' },
  ],
  context: async ({ shared }, use) => use(shared.context),
  page: async ({ shared }, use) => use(shared.page),
});
export { expect };

interface TestHooks {
  health(): Promise<{ ok: boolean; engine: string | null; error?: string }>;
  createGame(pgn: string): Promise<{ id: string }>;
  killEngines(): Promise<{ killed: number }>;
  failNext(n: number): Promise<void>;
}

/** Call a test hook of the running app (window.__chessCoachTest; the E2E dev server enables them). */
export async function hooks<T>(page: Page, fn: (h: TestHooks, arg: unknown) => Promise<T>, arg?: unknown): Promise<T> {
  if (!/^https?:/.test(page.url())) await page.goto('/?ui=classic');
  await page.waitForFunction(() => '__chessCoachTest' in window);
  return page.evaluate(([src, a]) => {
    const f = new Function(`return (${src as string})`)() as (h: unknown, x: unknown) => Promise<T>;
    return f((window as unknown as { __chessCoachTest: unknown }).__chessCoachTest, a);
  }, [fn.toString(), arg] as const);
}

/** Import a PGN into the app's cache (like the old POST /api/games): its id; the analysis starts in this page. */
export async function gameId(page: Page, pgn: string): Promise<string> {
  return (await hooks(page, (h, p) => h.createGame(p as string), pgn)).id;
}

export const SIZES = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1920x1080', width: 1920, height: 1080 },
] as const;

export async function shot(page: Page, name: string, settleMs = 400) {
  await page.waitForTimeout(settleMs); // let board animations settle
  const vp = page.viewportSize()!;
  await page.screenshot({ path: `e2e/screenshots/real-${vp.width}x${vp.height}-${name}.png` });
}

/** Fail early (with the reason) when the in-browser engine can't start. */
export async function requireEngine(page: Page) {
  await page.goto('/?ui=classic');
  const h = await hooks(page, (x) => x.health());
  expect(h.ok, `engine not available: ${h.error}`).toBe(true);
}

/**
 * Remember a chess.com name, as if it had been looked up in the Open dialog: a pasted game whose player has this name
 * opens on that side ("You" = the side at the bottom). Call before the first navigation (an init script, run after
 * the test's localStorage.clear()).
 */
export async function rememberName(page: Page, name: string) {
  await page.addInitScript((n) => localStorage.setItem('chess-coach:chesscom-name', n), name);
}

/** Open the app (fresh localStorage) and paste a PGN into the dialog. */
export async function importPgn(page: Page, pgn: string) {
  await page.goto('/?ui=classic'); // these tests cover the classic screen (the app's default is layout A)
  await expect(page.getByTestId('pgn-input')).toBeVisible();
  await page.getByTestId('pgn-input').fill(pgn);
  await page.getByTestId('pgn-submit').click();
}

/** Centre of a square in page coordinates, honouring the board orientation. */
export async function squareCenter(page: Page, square: string): Promise<{ x: number; y: number }> {
  const board = page.getByTestId('board').locator('cg-board');
  const box = (await board.boundingBox())!;
  const black = (await page.getByTestId('board').getAttribute('class'))?.includes('orientation-black');
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const sq = box.width / 8;
  const col = black ? 7 - file : file;
  const row = black ? rank : 7 - rank;
  return { x: box.x + (col + 0.5) * sq, y: box.y + (row + 0.5) * sq };
}

export async function drag(page: Page, from: string, to: string) {
  const a = await squareCenter(page, from);
  const b = await squareCenter(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

/** Number of main-line moves showing a label glyph in the move list. */
export async function labelledMoves(page: Page): Promise<number> {
  return page.locator('[data-node^="m"] [data-label]').count();
}

/** "Analysed 3/14" -> [3, 14]; "Analysis complete" -> null. */
export async function progressOf(page: Page): Promise<[number, number] | null> {
  const t = (await page.getByTestId('progress').innerText()).trim();
  const m = /Analysed (\d+)\/(\d+)/.exec(t);
  return m ? [Number(m[1]), Number(m[2])] : null;
}
