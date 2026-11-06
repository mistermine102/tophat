// Mock-mode checks of the Open screen (its own screen, not a dialog): the landing page with no game, the header's
// "Open game" over a loaded game with a way back (button, Esc, the browser's Back), `?game=<id>` reloads, and a game
// that can't be opened. Screenshots: e2e/screenshots/open-*.png.
import { expect, test, type Page } from '@playwright/test';

const shot = (page: Page, name: string) => page.waitForTimeout(400).then(() => page.screenshot({ path: `e2e/screenshots/${name}.png` }));
const gameParam = (page: Page) => new URL(page.url()).searchParams.get('game');

test('the Open screen: landing page, over a game, back, reload', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript(() => localStorage.clear());

  // no game: the Open screen is the page (no dialog over an empty screen)
  await page.goto('/?mock=1');
  await expect(page.getByTestId('open-screen')).toBeVisible();
  await expect(page.getByTestId('welcome')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('open-pgn')).toHaveCount(0);
  await expect(page.getByTestId('open-back')).toHaveCount(0);
  await shot(page, 'open-1366x768-landing');

  await page.getByTestId('pgn-sample').click();
  await page.getByTestId('pgn-submit').click();
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.getByTestId('open-screen')).toHaveCount(0);
  const id = gameParam(page);
  expect(id).toBeTruthy();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-node="m1"]')).toHaveAttribute('data-active', 'true');

  // "Open game": the Open screen over the game, which stays loaded
  await page.getByTestId('open-pgn').click();
  await expect(page.getByTestId('open-screen')).toBeVisible();
  await expect(page.getByTestId('board')).toHaveCount(0);
  await expect(page.getByTestId('welcome')).toHaveCount(0);
  await expect(page.getByTestId('open-back')).toContainText('BishopBlunder99 vs coach_tester');
  expect(gameParam(page)).toBeNull();
  await shot(page, 'open-1366x768-over-game');
  // the arrow keys don't move through the hidden game
  await page.keyboard.press('ArrowRight');

  // back with the button: the same game, the same move
  await page.getByTestId('open-back').click();
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.locator('[data-node="m1"]')).toHaveAttribute('data-active', 'true');
  expect(gameParam(page)).toBe(id);

  // back with the browser's Back button, and with Esc
  await page.getByTestId('open-pgn').click();
  await expect(page.getByTestId('open-screen')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('board')).toBeVisible();
  expect(gameParam(page)).toBe(id);
  await page.getByTestId('home').click();
  await expect(page.getByTestId('open-screen')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('board')).toBeVisible();

  // a reload opens the game of the URL again
  await page.reload();
  await expect(page.getByTestId('board')).toBeVisible();
  expect(gameParam(page)).toBe(id);
});

test("a game that can't be opened: the Open screen says why", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?mock=1&game=no-such-game');
  await expect(page.getByTestId('open-screen')).toBeVisible();
  await expect(page.getByTestId('load-error')).toContainText('not found');
  expect(gameParam(page)).toBeNull();
});
