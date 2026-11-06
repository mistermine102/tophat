// Mock-mode checks of layout A's board marks and the label badges: the tags are toned for YOU (flipping the board
// makes the other player "you" and swaps green and red), each tag has its icon, the Label guide explains the colours,
// and every label glyph is centred in its round badge (measured from the drawn pixels). Screenshots:
// e2e/screenshots/marks-*.png.
import { expect, test, type Page } from '@playwright/test';

const shot = (page: Page, name: string) => page.waitForTimeout(400).then(() => page.screenshot({ path: `e2e/screenshots/${name}.png` }));

async function openSample(page: Page) {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/?mock=1');
  await page.getByTestId('pgn-sample').click();
  await page.getByTestId('pgn-submit').click();
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.getByTestId('progress')).toContainText('Analysis complete', { timeout: 30_000 });
}

type Tag = { tone: string | null; kind: string | null; icon: string | null };
/** square → { tone, kind, icon } of the board tags. */
function tagsOf(page: Page): Promise<Record<string, Tag>> {
  return page.getByTestId('board-tag').evaluateAll((els) =>
    Object.fromEntries(
      els.map((e) => [e.getAttribute('data-square'), { tone: e.getAttribute('data-tone'), kind: e.getAttribute('data-kind'), icon: e.querySelector('svg')?.getAttribute('data-icon') ?? null }]),
    ),
  );
}

/**
 * For every `svg[data-glyph]` under `root`: where the drawn symbol's ink box is centred inside the svg (0.5 = the
 * middle; drawn again into a canvas, so strokes and caps count), and how far the svg's centre is from its round
 * badge's centre (px).
 */
function glyphCentres(page: Page, root: string) {
  return page.locator(root).first().evaluate(async (el) => {
    const out: { glyph: string; cx: number; cy: number; dx: number; dy: number; d: number }[] = [];
    for (const svg of Array.from(el.querySelectorAll('svg[data-glyph]'))) {
      const N = 160;
      const clone = svg.cloneNode(true) as SVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', String(N));
      clone.setAttribute('height', String(N));
      clone.setAttribute('color', '#000');
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = N;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, N, N);
      const px = ctx.getImageData(0, 0, N, N).data;
      let x0 = N, x1 = -1, y0 = N, y1 = -1;
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++)
          if (px[(y * N + x) * 4 + 3]! > 60) {
            x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
          }
      const s = svg.getBoundingClientRect();
      const b = svg.parentElement!.getBoundingClientRect();
      out.push({
        glyph: svg.getAttribute('data-glyph')!,
        cx: (x0 + x1 + 1) / 2 / N,
        cy: (y0 + y1 + 1) / 2 / N,
        dx: s.x + s.width / 2 - (b.x + b.width / 2),
        dy: s.y + s.height / 2 - (b.y + b.height / 2),
        d: b.width,
      });
    }
    return out;
  });
}

function expectCentred(list: Awaited<ReturnType<typeof glyphCentres>>) {
  expect(list.length).toBeGreaterThan(0);
  for (const g of list) {
    // the symbol within 3% of the middle of its box, and the box on the badge's centre (half a pixel)
    expect.soft(Math.abs(g.cx - 0.5), `${g.glyph}: x ${g.cx.toFixed(3)}`).toBeLessThanOrEqual(0.03);
    expect.soft(Math.abs(g.cy - 0.5), `${g.glyph}: y ${g.cy.toFixed(3)}`).toBeLessThanOrEqual(0.03);
    expect.soft(Math.abs(g.dx), `${g.glyph}: box dx`).toBeLessThanOrEqual(0.5);
    expect.soft(Math.abs(g.dy), `${g.glyph}: box dy`).toBeLessThanOrEqual(0.5);
  }
}

test('board tags are toned for you, with icons; the guide explains them', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openSample(page);

  // 26... Re1 (ply 52): Black's material blunder. You are Black (the fixture player, at the bottom): red for you
  await page.locator('[data-node="m52"]').click();
  await expect(page.getByTestId('board-tag').first()).toBeVisible();
  const asBlack = await tagsOf(page);
  expect(Object.values(asBlack).some((t) => t.tone === 'bad')).toBe(true);
  for (const t of Object.values(asBlack)) expect(t.icon).toBe(t.kind);
  await shot(page, 'marks-1366x768-you-black');

  // flip: White is "you" now, and the same marks are good news
  await page.keyboard.press('f');
  await expect(page.getByTestId('board')).toHaveClass(/orientation-white/);
  const asWhite = await tagsOf(page);
  const flipped = { good: 'bad', bad: 'good', neutral: 'neutral' } as Record<string, string>;
  expect(Object.keys(asWhite).sort()).toEqual(Object.keys(asBlack).sort());
  for (const [sq, t] of Object.entries(asBlack)) expect(asWhite[sq]!.tone).toBe(flipped[t.tone!]);
  await shot(page, 'marks-1366x768-you-white');
  await page.keyboard.press('f');

  // the Label guide: the board colours, from your side
  await page.getByTestId('legend-button').click();
  await expect(page.getByTestId('legend-board')).toBeVisible();
  await expect(page.getByTestId('legend-you')).toHaveText('coach_tester (Black)');
  await expect(page.locator('[data-legend-tone]')).toHaveCount(3);
  await shot(page, 'marks-1366x768-legend');
});

test('label glyphs are centred in their badges (guide, board, move list)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openSample(page);
  // the Miss (16. … ply 32) on the board: the ✕ that used to sit off-centre
  await page.locator('[data-node="m32"]').click();
  await expect(page.getByTestId('board-badge')).toHaveAttribute('data-label', 'miss');
  await page.waitForTimeout(300); // the badge's pop-in animation scales it
  expectCentred(await glyphCentres(page, '[data-testid="board-badge"] >> xpath=..'));
  expectCentred(await glyphCentres(page, '[data-testid="moves"], main'));
  await page.getByTestId('legend-button').click();
  const legend = await glyphCentres(page, '[data-testid="legend"]');
  expect(new Set(legend.map((g) => g.glyph)).size).toBeGreaterThanOrEqual(10);
  expectCentred(legend);
  await page.getByTestId('board-badge').screenshot({ path: 'e2e/screenshots/marks-badge-miss.png' });
});
