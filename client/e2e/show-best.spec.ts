// Mock-mode check of "Show best move" (B / the arrow button): gold arrows for the engine's top moves in the position on
// the board, as bright as they are good, ranked at the arrowheads — in the main line and in a side line — off by default, remembered. No big arrows for
// the best / suggested move otherwise (feedback round 3). Screenshot: e2e/screenshots/show-best-1366x768.png.
import { expect, test, type Page } from '@playwright/test';

const GOLD = '#e0a400';
const BLUE = '#2563eb';
const GREEN = '#16a34a';

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

/** Gold arrows drawn, with their opacities. */
const goldOpacities = (page: Page) => page.locator('cg-container svg line').evaluateAll((ls, gold) => ls.filter((l) => l.getAttribute('stroke') === gold).map((l) => Number(l.getAttribute('opacity'))), GOLD);

/** The rank labels at the arrowheads. */
const rankLabels = (page: Page) => page.locator('cg-container svg text').allTextContents();

/** Stroke colours of the arrows chessground draws. */
const arrowColours = (page: Page) => page.locator('cg-container svg line').evaluateAll((ls) => ls.map((l) => l.getAttribute('stroke')));

test('show best move: gold arrows for the top moves here, main line and side line, remembered', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('cleared')) {
      localStorage.clear();
      localStorage.setItem('chess-coach:show-best', '0'); // on by default: start from off to test the toggle
      sessionStorage.setItem('cleared', '1');
    }
  });
  await openSample(page);
  // a bad move: no big arrows for its alternatives, no gold arrows while the toggle is off
  await page.locator('[data-node="m32"]').click();
  await page.waitForTimeout(300);
  expect(await arrowColours(page)).not.toContain(BLUE);
  expect(await arrowColours(page)).not.toContain(GREEN);
  expect(await arrowColours(page)).not.toContain(GOLD);
  await expect(page.getByTestId('show-best')).toHaveAttribute('aria-pressed', 'false');

  // on: the best move in this position, and the previous move's alternatives give way
  await page.keyboard.press('b');
  await expect(page.getByTestId('show-best')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await goldOpacities(page)).length).toBeGreaterThanOrEqual(2);
  const ops = await goldOpacities(page);
  expect(ops.length).toBeLessThanOrEqual(5);
  // as bright as they are good: the best move is the most opaque, and it is drawn last (on top)
  expect(Math.max(...ops)).toBeGreaterThan(Math.min(...ops));
  expect(ops[ops.length - 1]).toBe(Math.max(...ops));
  // ranks at the arrowheads, 1 = the best
  await expect.poll(() => rankLabels(page)).toContain('1');
  expect((await rankLabels(page)).length).toBe(ops.length);
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

test('show best move: "Moves here" lists what the arrows\' moves do, numbered like the arrows', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('cleared')) {
      localStorage.clear();
      localStorage.setItem('chess-coach:show-best', '0'); // on by default: start from off to test the toggle
      sessionStorage.setItem('cleared', '1');
    }
  });
  await openSample(page);
  await page.locator('[data-node="m32"]').click();
  // off: no list
  await expect(page.getByTestId('top-ideas')).toHaveCount(0);
  await page.keyboard.press('b');
  const list = page.getByTestId('top-ideas');
  await expect(list).toBeVisible();
  // one row per arrow, in the arrows' order
  await expect.poll(async () => (await goldOpacities(page)).length).toBeGreaterThanOrEqual(2);
  await expect(list.getByTestId('top-idea')).toHaveCount((await goldOpacities(page)).length);
  // the points arrive after the arrows
  await expect(page.getByTestId('top-ideas-pending')).toHaveCount(0, { timeout: 10_000 });
  await expect(list.getByTestId('tone-line').first()).toBeVisible();
  // hovering a move highlights its squares
  const first = list.getByTestId('top-idea').first();
  const uci = (await first.getAttribute('data-uci'))!;
  await first.hover();
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('cg-board square.cc-hl').length)).toBeGreaterThan(0);
  expect(uci).toMatch(/^[a-h][1-8][a-h][1-8]/);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: 'e2e/screenshots/show-best-ideas-1366x768.png' });

  // the start position: several developing moves, the later ones told by how they differ
  await page.keyboard.press('Home');
  await expect(list.getByTestId('top-idea').first()).toBeVisible();
  await expect(page.getByTestId('top-ideas-pending')).toHaveCount(0, { timeout: 10_000 });
  await page.screenshot({ path: 'e2e/screenshots/show-best-ideas-start-1366x768.png' });
});
