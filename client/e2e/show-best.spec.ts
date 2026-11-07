// Mock-mode check of "Show best move" (B / the arrow button): a gold arrow for the best move in the position on the
// board — in the main line and in a side line — off by default, remembered, and it replaces the arrows about the
// previous move's alternatives. Screenshot: e2e/screenshots/show-best-1366x768.png.
import { expect, test, type Page } from '@playwright/test';

const GOLD = '#e0a400';
const BLUE = '#2563eb';

async function openSample(page: Page) {
  await page.goto('/?mock=1');
  await page.getByTestId('pgn-sample').click();
  await page.getByTestId('pgn-submit').click();
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.getByTestId('progress')).toContainText('Analysis complete', { timeout: 30_000 });
}

async function squareCenter(page: Page, square: string): Promise<{ x: number; y: number }> {
  const box = (await page.getByTestId('board').locator('cg-board').boundingBox())!;
  const black = (await page.getByTestId('board').getAttribute('class'))?.includes('orientation-black');
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const sq = box.width / 8;
  return { x: box.x + ((black ? 7 - file : file) + 0.5) * sq, y: box.y + ((black ? rank : 7 - rank) + 0.5) * sq };
}

async function drag(page: Page, from: string, to: string) {
  const a = await squareCenter(page, from);
  const b = await squareCenter(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

/** Stroke colours of the arrows chessground draws. */
const arrowColours = (page: Page) => page.locator('cg-container svg line').evaluateAll((ls) => ls.map((l) => l.getAttribute('stroke')));

test('show best move: a gold arrow for the best move here, main line and side line, remembered', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('cleared')) {
      localStorage.clear();
      sessionStorage.setItem('cleared', '1');
    }
  });
  await openSample(page);
  // a bad move: its alternatives are drawn (blue), no gold arrow while the toggle is off
  await page.locator('[data-node="m32"]').click();
  await expect.poll(() => arrowColours(page)).toContain(BLUE);
  expect(await arrowColours(page)).not.toContain(GOLD);
  await expect(page.getByTestId('show-best')).toHaveAttribute('aria-pressed', 'false');

  // on: the best move in this position, and the previous move's alternatives give way
  await page.keyboard.press('b');
  await expect(page.getByTestId('show-best')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => arrowColours(page)).toContain(GOLD);
  expect(await arrowColours(page)).not.toContain(BLUE);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/screenshots/show-best-1366x768.png' });

  // the start position too (from the first move's analysis)
  await page.keyboard.press('Home');
  await expect.poll(() => arrowColours(page)).toContain(GOLD);

  // a side line from the start: once its move is analysed, the arrow shows the best reply there
  await drag(page, 'a2', 'a3');
  await expect(page.getByTestId('back-to-game')).toBeVisible();
  await expect.poll(() => arrowColours(page)).toContain(GOLD);
  await page.getByTestId('show-best').click();
  await expect(page.getByTestId('show-best')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => arrowColours(page)).not.toContain(GOLD);

  // remembered after a reload
  await page.getByTestId('show-best').click();
  await page.reload();
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.getByTestId('show-best')).toHaveAttribute('aria-pressed', 'true');
});
