// The prototype layouts (`?ui=a|b|c`) against the real server (fast profile): the Opera game's 15...Nxd7 shows its
// label badge on d7 (a spinner first) and toned sentences; B replays the move's line on the board. (The label itself
// is not asserted: the shallow fast profile may not see the mate in 2.) Screenshots:
// e2e/screenshots/real-<size>-proto-<ui>.png.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { requireEngine, shot } from './helpers';

const OPERA = readFileSync(new URL('../../../bench/games/opera-game.pgn', import.meta.url), 'utf8');

test.describe.configure({ mode: 'serial' });

for (const ui of ['a', 'b', 'c'] as const) {
  test(`prototype ${ui} on the real server: badge on the destination square, toned sentences`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.addInitScript(() => localStorage.clear());
    await requireEngine(page);
    const res = await page.request.post('/api/games', { data: { pgn: OPERA } });
    expect(res.ok()).toBe(true);
    const { id } = (await res.json()) as { id: string };
    await page.goto(`/?game=${id}&ui=${ui}`);
    await expect(page.locator(`[data-layout="${ui}"]`)).toBeVisible();

    // 15... Nxd7 (ply 30): the viewed ply is analysed first
    await page.locator('[data-node="m30"]').click();
    const badge = page.getByTestId('board-badge');
    await expect(badge).toHaveAttribute('data-square', 'd7');
    await expect(badge).toHaveAttribute('data-kind', 'label', { timeout: 90_000 });
    const label = (await badge.getAttribute('data-label'))!;
    await expect(page.getByTestId('label-name')).toContainText(label.charAt(0).toUpperCase() + label.slice(1));
    await expect(page.getByTestId('explanation').locator('[data-tone]').first()).toBeVisible();
    if (ui === 'b') {
      await page.getByTestId('show-why').click();
      await expect(page.getByTestId('replay-bar')).toBeVisible();
      await page.getByTestId('replay-toggle').click();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await expect(page.getByTestId('replay-caption')).toContainText('3/');
      await shot(page, `proto-${ui}-replay`);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('replay-bar')).toHaveCount(0);
    }
    await shot(page, `proto-${ui}`);
  });
}
