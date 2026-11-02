// Mock-mode checks of the three prototype layouts (`?ui=a|b|c`): the layout loads, the label badge sits on the
// destination square of the viewed move (also for a side-line move, with a spinner while it is analysed), and the
// explanation sentences carry their ✓ / ✗ tones. Screenshots: e2e/screenshots/proto-<ui>-mock-*.png.
import { expect, test, type Page } from '@playwright/test';

async function openSample(page: Page, ui: string) {
  await page.addInitScript(() => localStorage.clear());
  await page.goto(`/?mock=1&ui=${ui}`);
  await expect(page.getByTestId('pgn-input')).toBeVisible();
  await page.getByTestId('pgn-sample').click();
  await page.getByTestId('pgn-submit').click();
  await expect(page.getByTestId('board')).toBeVisible();
}

/** Box of a square in page coordinates, honouring the board orientation. */
async function squareBox(page: Page, square: string) {
  const board = page.getByTestId('board').locator('cg-board');
  const box = (await board.boundingBox())!;
  const black = (await page.getByTestId('board').getAttribute('class'))?.includes('orientation-black');
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const sq = box.width / 8;
  const col = black ? 7 - file : file;
  const row = black ? rank : 7 - rank;
  return { x: box.x + col * sq, y: box.y + row * sq, size: sq };
}

/** The badge is on `square`: its centre lies in the square's top-right quarter (it may stick out a little). */
async function expectBadgeOn(page: Page, square: string, attrs: Record<string, string>) {
  const badge = page.getByTestId('board-badge');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute('data-square', square);
  for (const [k, v] of Object.entries(attrs)) await expect(badge).toHaveAttribute(k, v);
  const b = (await badge.boundingBox())!;
  const s = await squareBox(page, square);
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  expect(cx).toBeGreaterThan(s.x + s.size / 2);
  expect(cx).toBeLessThan(s.x + s.size + 2);
  expect(cy).toBeGreaterThan(s.y - 2);
  expect(cy).toBeLessThan(s.y + s.size / 2);
}

async function drag(page: Page, from: string, to: string) {
  const a = await squareBox(page, from);
  const b = await squareBox(page, to);
  await page.mouse.move(a.x + a.size / 2, a.y + a.size / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.size / 2, b.y + b.size / 2, { steps: 8 });
  await page.mouse.up();
}

const shot = (page: Page, name: string) => page.waitForTimeout(400).then(() => page.screenshot({ path: `e2e/screenshots/${name}.png` }));

for (const ui of ['a', 'b', 'c'] as const) {
  test(`prototype ${ui}: badge on the destination square, toned explanation`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openSample(page, ui);
    await expect(page.locator(`[data-layout="${ui}"]`)).toBeVisible();
    await expect(page.getByTestId('progress')).toContainText('Analysis complete', { timeout: 30_000 });

    // 26... Re1 (ply 52): a material-rule Blunder by Black (the fixture user plays Black: the board starts flipped)
    await page.locator('[data-node="m52"]').click();
    await expect(page.getByTestId('label-name')).toContainText('Blunder');
    await expectBadgeOn(page, 'e1', { 'data-label': 'blunder', 'data-kind': 'label' });
    // what hurts is marked ✗, and comes first
    const tones = page.getByTestId('explanation').getByTestId('tone-line');
    // (layout A: the verdict carries the tone; its ✓ / ✗ lines are optional — no Better card)
    if (ui !== 'a') await expect(tones.first()).toBeVisible();
    expect(await page.getByTestId('explanation').locator('[data-tone="bad"]').count()).toBeGreaterThan(0);
    await shot(page, `proto-${ui}-mock-1366x768-blunder`);

    // the badge follows the board when it is flipped
    await page.keyboard.press('f');
    await expectBadgeOn(page, 'e1', { 'data-label': 'blunder' });
    await page.keyboard.press('f');

    // a good move: its ✓ points
    await page.locator('[data-node="m23"]').click();
    await expect(page.getByTestId('label-name')).toContainText('Great');
    await expect(page.getByTestId('explanation').locator('[data-tone="good"]').first()).toBeVisible();

    if (ui === 'a') {
      // the move's consequences on the board (red = bad for the mover); no tint just for being attacked
      await page.locator('[data-node="m52"]').click();
      await expect(page.locator('[data-testid="board-tag"][data-tone="bad"]').first()).toBeVisible();
      expect(await page.locator('cg-board square[class*=cc-hang-]').count()).toBe(0);
      // no Better card and no colour legend: the better move is the arrow on the board
      await expect(page.getByTestId('better')).toHaveCount(0);
      await expect(page.getByTestId('board-legend')).toHaveCount(0);
      // the players around the board: you (Black, at the bottom) below it, the opponent above; not in the header
      await expect(page.getByTestId('players')).toHaveCount(0);
      const boardBox = (await page.getByTestId('board').boundingBox())!;
      const top = page.getByTestId('player-white');
      const bottom = page.getByTestId('player-black');
      await expect(top).toContainText('BishopBlunder99');
      await expect(top.getByTestId('player-result')).toHaveText('Lost');
      await expect(bottom).toContainText('coach_tester');
      await expect(bottom.getByTestId('player-result')).toHaveText('Won');
      expect((await top.boundingBox())!.y).toBeLessThan(boardBox.y);
      expect((await bottom.boundingBox())!.y).toBeGreaterThan(boardBox.y + boardBox.height - 2);
      await shot(page, 'proto-a-mock-1366x768-marks');
      // flipped: the players swap places
      await page.keyboard.press('f');
      expect((await page.getByTestId('player-white').boundingBox())!.y).toBeGreaterThan(boardBox.y + boardBox.height - 2);
      await page.keyboard.press('f');
    }
    if (ui === 'b') {
      // "Show me why" replays the line on the board: replay bar, toned marker on the step's square
      await page.locator('[data-node="m52"]').click();
      await page.getByTestId('show-why').click();
      await expect(page.getByTestId('replay-bar')).toBeVisible();
      await page.getByTestId('replay-toggle').click(); // pause
      await page.keyboard.press('ArrowRight');
      await expect(page.getByTestId('replay-caption')).toContainText('2/');
      await shot(page, 'proto-b-mock-1366x768-replay');
      await page.getByTestId('replay-stop').click();
      await expect(page.getByTestId('replay-bar')).toHaveCount(0);
      await expectBadgeOn(page, 'e1', { 'data-label': 'blunder' });
    }
    if (ui === 'c') {
      await page.locator('[data-node="m52"]').click();
      await expect(page.getByTestId('block-bad')).toBeVisible();
      await expect(page.getByTestId('better')).toBeVisible();
    }

    // a side-line move gets a spinner badge, then its label, on its destination square
    await page.locator('[data-node="m20"]').click();
    await drag(page, 'g1', 'h1');
    await expect(page.getByTestId('back-to-game')).toBeVisible();
    await expect(page.getByTestId('board-badge')).toHaveAttribute('data-square', 'h1');
    await expectBadgeOn(page, 'h1', { 'data-kind': 'label' });
  });
}
