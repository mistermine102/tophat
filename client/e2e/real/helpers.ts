// Helpers for the real-server E2E tests.
import { expect, test, type Page } from '@playwright/test';

export const SIZES = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1920x1080', width: 1920, height: 1080 },
] as const;

export async function shot(page: Page, name: string, settleMs = 400) {
  await page.waitForTimeout(settleMs); // let board animations settle
  const vp = page.viewportSize()!;
  await page.screenshot({ path: `e2e/screenshots/real-${vp.width}x${vp.height}-${name}.png` });
}

/** Skip the test when the server has no engine (Stockfish not installed). */
export async function requireEngine(page: Page) {
  const res = await page.request.get('/api/health');
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  test.skip(!body.ok, `engine not available: ${body.error ?? res.status()}`);
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
