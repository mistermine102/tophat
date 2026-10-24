// Mock-mode walkthrough of the v1 screen: paste the sample PGN, step through moves, explore a side line, flip,
// and take screenshots at 1280×720 and 1920×1080 into e2e/screenshots/.
import { expect, test, type Page } from '@playwright/test';

const SIZES = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1920x1080', width: 1920, height: 1080 },
];

async function shot(page: Page, name: string, size: string) {
  await page.waitForTimeout(450); // let board animations settle
  await page.screenshot({ path: `e2e/screenshots/${size}-${name}.png` });
}

/** Centre of a square in page coordinates, honouring the board orientation. */
async function squareCenter(page: Page, square: string): Promise<{ x: number; y: number }> {
  const board = page.getByTestId('board').locator('cg-board');
  const box = (await board.boundingBox())!;
  const orientation = (await page.getByTestId('board').getAttribute('class'))?.includes('orientation-black')
    ? 'black'
    : 'white';
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const sq = box.width / 8;
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  return { x: box.x + (col + 0.5) * sq, y: box.y + (row + 0.5) * sq };
}

async function drag(page: Page, from: string, to: string) {
  const a = await squareCenter(page, from);
  const b = await squareCenter(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

async function openSample(page: Page) {
  await page.goto('/?mock=1');
  await expect(page.getByTestId('pgn-input')).toBeVisible();
  await page.getByTestId('pgn-sample').click();
  await page.getByTestId('pgn-submit').click();
  await expect(page.getByTestId('board')).toBeVisible();
}

for (const size of SIZES) {
  test(`review flow ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.addInitScript(() => localStorage.clear());

    // Empty state: the PGN dialog opens on first load; bad PGN shows an error.
    await page.goto('/?mock=1');
    await expect(page.getByTestId('pgn-input')).toBeVisible();
    await page.getByTestId('pgn-input').fill('1. e4 e5 2. Ke3');
    await page.getByTestId('pgn-submit').click();
    await expect(page.getByTestId('pgn-error')).toContainText('Illegal');
    await shot(page, '00-pgn-error', size.name);

    await page.getByTestId('pgn-sample').click();
    await page.getByTestId('pgn-submit').click();
    await expect(page.getByTestId('board')).toBeVisible();
    await expect(page.getByTestId('players')).toContainText('coach_tester');
    await expect(page.getByTestId('progress')).toContainText('Analysed');
    await shot(page, '01-start-streaming', size.name);

    // Step to 11. h3 (inaccuracy, pick ≠ best) with the keyboard.
    for (let i = 0; i < 21; i++) await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('label-card')).toContainText('11. h3');
    await expect(page.getByTestId('label-name')).toHaveText('Inaccuracy', { timeout: 10_000 });
    await expect(page.getByTestId('candidate-pick')).toContainText('b4');
    await expect(page.getByTestId('candidate-best')).toContainText('Kh1');
    await shot(page, '02-inaccuracy-pick-vs-best', size.name);

    // Hovering a move of the suggested line previews it on the board.
    await page.getByTestId('candidate-pick').getByTestId('pv').locator('button').nth(2).hover();
    await expect(page.getByTestId('preview-caption')).toContainText('Preview');
    await shot(page, '03-line-preview', size.name);
    await page.mouse.move(5, 5);

    // Wait for the whole game, then jump to the material-rule blunder (26... Re1 "still winning").
    await expect(page.getByTestId('progress')).toContainText('Analysis complete', { timeout: 30_000 });
    await page.locator('[data-node="m52"]').click();
    await expect(page.getByTestId('label-name')).toHaveText('Blunder');
    await expect(page.getByTestId('label-reason')).toContainText('still winning');
    await shot(page, '04-material-blunder', size.name);

    // Great move and the Miss.
    await page.locator('[data-node="m23"]').click();
    await expect(page.getByTestId('label-name')).toHaveText('Great');
    await page.locator('[data-node="m32"]').click();
    await expect(page.getByTestId('label-name')).toHaveText('Miss');
    await shot(page, '05-miss', size.name);

    // Deep-only suggestion.
    await page.locator('[data-node="m33"]').click();
    await expect(page.getByTestId('deep-only')).toBeVisible();

    // Side line: after 10... Nh5 (ply 20) play 11. Kh1 instead of 11. h3.
    await page.locator('[data-node="m20"]').click();
    await drag(page, 'g1', 'h1');
    await expect(page.getByTestId('back-to-game')).toBeVisible();
    await expect(page.getByTestId('variation')).toContainText('Kh1');
    await shot(page, '06-sideline-pending', size.name);
    await expect(page.getByTestId('move-spinner')).toHaveCount(0, { timeout: 5_000 });
    await drag(page, 'a7', 'a5');
    await expect(page.getByTestId('variation').first()).toContainText('a5');
    await expect(page.getByTestId('move-spinner')).toHaveCount(0, { timeout: 5_000 });
    await shot(page, '07-sideline-analysed', size.name);

    // Flip the board.
    await page.getByTestId('flip').click();
    await expect(page.getByTestId('board')).toHaveClass(/orientation-white/);
    await shot(page, '08-flipped', size.name);

    // Back to game returns to the branch point (ply 20); dragging the game move just advances.
    await page.getByTestId('back-to-game').click();
    await expect(page.getByTestId('back-to-game')).toHaveCount(0);
    await expect(page.locator('[data-node="m20"]')).toHaveAttribute('data-active', 'true');
    await drag(page, 'h2', 'h3');
    await expect(page.locator('[data-node="m21"]')).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('variation')).toHaveCount(1);

    await page.keyboard.press('End');
    await expect(page.getByTestId('label-card')).toContainText('Rd3#');
    await shot(page, '09-final-position', size.name);
  });
}

test('focus: jumping ahead makes the viewed ply arrive next', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openSample(page);
  await page.keyboard.press('End');
  await expect(page.getByTestId('label-name')).toHaveText('Best', { timeout: 2_000 });
  await expect(page.getByTestId('progress')).toContainText('Analysed');
});
