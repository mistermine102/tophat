// Phones (< 768px): the phone layout (layouts/MobileLayout.vue). One screen, no page scrolling: the board (with a slim
// eval bar beside it) and the verdict both in view, nothing wider than the screen (also while the header shows the
// analysis progress), the move controls in one row at the bottom, the move list reachable below the explanation.
import { expect, test } from '@playwright/test';

for (const size of [{ width: 390, height: 664 }, { width: 320, height: 568 }]) {
  test(`phone ${size.width}x${size.height}: one screen, board and verdict in view, controls at the bottom`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/?mock=1');
    await page.getByTestId('pgn-sample').click();
    await page.getByTestId('pgn-submit').click();
    await expect(page.locator('main[data-layout="m"]')).toBeVisible();
    await expect(page.getByTestId('progress')).toContainText('/');
    const fits = () => page.evaluate(() => [document.documentElement.scrollWidth <= innerWidth, document.documentElement.scrollHeight <= innerHeight]);
    expect(await fits()).toEqual([true, true]);
    await expect(page.getByTestId('progress')).toContainText('Analysis complete', { timeout: 30_000 });

    for (let i = 0; i < 6; i++) await page.getByLabel('Next move').click();
    await expect(page.getByTestId('verdict')).toBeVisible();
    expect(await fits()).toEqual([true, true]);
    const board = (await page.getByTestId('board').boundingBox())!;
    const bar = (await page.getByTestId('eval-bar').boundingBox())!;
    const verdict = (await page.getByTestId('verdict').boundingBox())!;
    const nav = (await page.getByTestId('nav').boundingBox())!;
    // the eval bar beside the board, the board nearly as wide as the screen
    expect(bar.x + bar.width).toBeLessThanOrEqual(board.x);
    expect(board.width).toBeGreaterThan(size.width * 0.7);
    // board, then the verdict, then the controls at the bottom of the screen
    expect(verdict.y).toBeGreaterThanOrEqual(board.y + board.height - 1);
    expect(verdict.y + 20).toBeLessThan(nav.y);
    expect(nav.y + nav.height).toBeLessThanOrEqual(size.height);
    // the card has no separate header line: the move name sits next to the label
    await expect(page.getByTestId('verdict').getByTestId('move-name')).toContainText('...');
    await expect(page.getByTestId('eval-change')).toHaveCount(0);
    // the move list is below the explanation: scrolled into reach, a tap goes to that move
    const list = page.getByTestId('move-list');
    await list.scrollIntoViewIfNeeded();
    await list.locator('[data-node]').first().click();
    await expect(page.getByTestId('verdict').getByTestId('move-name')).toContainText('1.');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({ path: `e2e/screenshots/mobile-${size.width}x${size.height}.png` });
  });
}
