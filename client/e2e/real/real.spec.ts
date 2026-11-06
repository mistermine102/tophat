// E2E against the real in-browser analysis (Stockfish WASM, `fast` profile, see playwright.config.ts). Tests run in
// order in one browser context with a fresh cache (IndexedDB): later tests rely on games analysed by earlier ones
// only where noted.
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { ALLOWED_MATE, BAD_ILLEGAL, FROM_FEN, LASKER_CHESSCOM, SHILLING_CHESSCOM, STALEMATE, TWO_PLIES, longGame } from '../pgns';
import { drag, expect, gameId, hooks, importPgn, labelledMoves, progressOf, rememberName, requireEngine, shot, test } from './helpers';

const OPERA = readFileSync(new URL('../../../bench/games/opera-game.pgn', import.meta.url), 'utf8');

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.clear());
  await requireEngine(page);
});

async function waitComplete(page: Page, timeout = 120_000) {
  await expect(page.getByTestId('progress')).toContainText('Analysis complete', { timeout });
}

test('chess.com PGN: board opens at once, analyses stream in, summary, checkmate, reload from cache', async ({ page }) => {
  await rememberName(page, 'SzymonJ');
  const t0 = Date.now();
  await importPgn(page, SHILLING_CHESSCOM);
  await expect(page.getByTestId('board')).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(5_000);
  // the remembered chess.com name -> orientation + "You"
  await expect(page.getByTestId('board')).toHaveClass(/orientation-black/);
  await expect(page.getByTestId('summary')).toContainText('SzymonJ');
  await expect(page.getByTestId('players')).toContainText('SomeOpponent');
  await shot(page, '01-streaming-start', 150);

  // progressive streaming: several intermediate progress values before completion
  const seen = new Set<number>();
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline && seen.size < 3) {
    const p = await progressOf(page);
    if (!p) break; // complete
    seen.add(p[0]);
    expect(p[1]).toBe(14);
    await page.waitForTimeout(100);
  }
  expect(seen.size).toBeGreaterThanOrEqual(3);
  const partial = await labelledMoves(page);
  expect(partial).toBeGreaterThan(0);
  await expect(page.getByTestId('summary-progress')).toContainText('partial');
  await shot(page, '02-streaming-partial', 0);

  await waitComplete(page);
  expect(await labelledMoves(page)).toBe(14);
  await expect(page.getByTestId('acc-you')).toHaveText(/^\d+\.\d$/);
  await expect(page.getByTestId('acc-opp')).toHaveText(/^\d+\.\d$/);
  // eval graph filled in: one continuous area over the whole game
  await expect(page.getByTestId('eval-graph').locator('path')).toHaveCount(2);

  // last ply: 7... Nf3# by "You"
  await page.keyboard.press('End');
  await expect(page.getByTestId('label-card')).toContainText('7... Nf3#');
  await expect(page.getByTestId('label-card')).toContainText('You');
  await expect(page.getByTestId('label-reason')).toHaveText('Checkmate!');
  await expect(page.getByTestId('eval-white')).toContainText('0-1');
  await expect(page.getByTestId('eval-white')).toContainText('Black won by checkmate');
  await shot(page, '03-checkmate');

  // overview with key moments; jump to the first one
  await page.keyboard.press('Home');
  await expect(page.getByTestId('key-moments')).toBeVisible();
  await shot(page, '04-overview');
  const moments = page.getByTestId('key-moments').locator('button');
  if ((await moments.count()) > 0) {
    await moments.first().click();
    await expect(page.getByTestId('label-reason')).toBeVisible();
    await shot(page, '05-key-moment');
  }

  // reload: same game from the cache, instantly
  expect(page.url()).toMatch(/[?&]game=[0-9a-f]{40}/);
  const t1 = Date.now();
  await page.reload();
  await expect(page.getByTestId('progress')).toContainText('Analysis complete', { timeout: 3_000 });
  expect(await labelledMoves(page)).toBe(14);
  expect(Date.now() - t1).toBeLessThan(3_000);
  await expect(page.getByTestId('board')).toHaveClass(/orientation-black/);

  // flipping the board switches "You": White (SomeOpponent) at the bottom, so Black's last move is the opponent's
  await page.getByTestId('flip').click();
  await expect(page.getByTestId('board')).toHaveClass(/orientation-white/);
  await page.keyboard.press('End');
  await expect(page.getByTestId('label-card')).toContainText('Opponent');
});

test('focus: the viewed ply jumps the queue; pending states', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await rememberName(page, 'EdLasker1912');
  await importPgn(page, LASKER_CHESSCOM);
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.getByTestId('board')).toHaveClass(/orientation-white/);
  // the PGN's variation (7... O-O 8. Bd3), NAGs and clock comments are ignored: 35 main-line plies
  await expect(page.locator('[data-node^="m"]')).toHaveCount(35);

  // jump to the end right away: ply 35 should arrive long before the background queue gets there
  await page.keyboard.press('End');
  await expect(page.getByTestId('label-card')).toContainText('18. Kd2#');
  await expect(page.getByTestId('label-card')).toContainText('Analysing this move now');
  await shot(page, '06-pending-focused', 100);
  const t0 = Date.now();
  await expect(page.locator('[data-node="m35"] [data-label]')).toHaveCount(1, { timeout: 30_000 });
  const focusedAfter = Date.now() - t0;
  const labelled = await labelledMoves(page);
  console.log(`focused ply 35 arrived after ${focusedAfter} ms with ${labelled}/35 plies analysed`);
  expect(labelled).toBeLessThan(25);
  await expect(page.locator('[data-node="m25"] [data-label]')).toHaveCount(0);
  await expect(page.getByTestId('label-reason')).toHaveText('Checkmate!');
  await shot(page, '07-focused-arrived');
  await waitComplete(page);
  await shot(page, '08-complete');
});

test('side lines, "Try this", keyboard on the board, square highlight, legend', async ({ page }) => {
  await rememberName(page, 'EdLasker1912');
  await importPgn(page, LASKER_CHESSCOM); // analysed by the previous test (cache)
  await waitComplete(page, 120_000);

  // a side line from the start position: 1. e4 (game: 1. d4) ... e5
  await page.keyboard.press('Home');
  await drag(page, 'e2', 'e4');
  await expect(page.getByTestId('back-to-game')).toBeVisible();
  await expect(page.getByTestId('variation')).toContainText('e4');
  await expect(page.getByTestId('label-card')).toContainText('Side line');
  await expect(page.getByTestId('move-spinner')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByTestId('label-reason')).toBeVisible();
  await drag(page, 'e7', 'e5');
  await expect(page.getByTestId('variation').first()).toContainText('e5');
  await expect(page.getByTestId('move-spinner')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByTestId('label-reason')).toBeVisible();
  await shot(page, '09-sideline-analysed');
  await page.getByTestId('back-to-game').click();
  await expect(page.getByTestId('back-to-game')).toHaveCount(0);

  // keyboard navigation with the focus on the board
  await page.getByTestId('board').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-node="m2"]')).toHaveAttribute('data-active', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-node="m1"]')).toHaveAttribute('data-active', 'true');

  // find a move with a "Try this" suggestion and play it on the board
  let found = false;
  for (let ply = 1; ply <= 35 && !found; ply++) {
    await page.locator(`[data-node="m${ply}"]`).click();
    found = (await page.getByTestId('play-pick').count()) > 0;
  }
  expect(found).toBe(true);
  await shot(page, '10-try-this');
  const pickSan = (await page.getByTestId('candidate-pick').locator('header button').first().innerText()).split(' ').at(-1)!;
  await page.getByTestId('play-pick').click();
  await expect(page.getByTestId('back-to-game')).toBeVisible();
  await expect(page.getByTestId('label-card')).toContainText(pickSan);
  await expect(page.getByTestId('label-card')).toContainText('Side line');
  await expect(page.getByTestId('label-reason')).toBeVisible({ timeout: 60_000 });
  await shot(page, '11-try-this-played');
  await page.getByTestId('back-to-game').click();

  // hovering a square name in the explanation highlights the square
  const ref = page.getByTestId('explanation').locator('.sq-ref').first();
  await expect(ref).toBeVisible();
  const sq = await ref.getAttribute('data-square');
  await ref.hover();
  await expect(page.locator('cg-board square.cc-hl')).toHaveCount(1);
  await shot(page, `12-square-highlight-${sq}`, 150);
  await page.mouse.move(2, 2);
  await expect(page.locator('cg-board square.cc-hl')).toHaveCount(0);

  // label legend
  await page.getByTestId('legend-button').click();
  await expect(page.getByTestId('legend')).toContainText('Blunder');
  await expect(page.getByTestId('legend')).toContainText('White');
  await shot(page, '13-legend', 100);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('legend')).toHaveCount(0);
});

test('bad PGNs are rejected with a readable message', async ({ page }) => {
  await importPgn(page, BAD_ILLEGAL);
  await expect(page.getByTestId('pgn-error')).toContainText('Could not read this PGN');
  await expect(page.getByTestId('pgn-error')).toContainText('Ke3');
  await shot(page, '14-bad-pgn');
  await page.getByTestId('pgn-input').fill('hello world');
  await page.getByTestId('pgn-submit').click();
  await expect(page.getByTestId('pgn-error')).toContainText('no moves found');
});

test('edge games: 2 plies, stalemate, start from a FEN', async ({ page }) => {
  // two plies
  await importPgn(page, TWO_PLIES);
  await waitComplete(page, 60_000);
  await page.keyboard.press('End');
  await expect(page.getByTestId('label-card')).toContainText('1... e5');
  await expect(page.getByTestId('acc-you')).toHaveText(/^\d+\.\d$/);

  // stalemate on the last move
  await page.getByTestId('open-pgn').click();
  await page.getByTestId('pgn-input').fill(STALEMATE);
  await page.getByTestId('pgn-submit').click();
  await expect(page.getByTestId('players')).toContainText('Loyd');
  await page.keyboard.press('End');
  await expect(page.getByTestId('label-card')).toContainText('10. Qe6');
  await expect(page.getByTestId('label-reason')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('eval-white')).toContainText('draw by stalemate');
  await shot(page, '15-stalemate');
  await waitComplete(page, 60_000);

  // game from a set-up position, Black moves first
  await page.getByTestId('open-pgn').click();
  await page.getByTestId('pgn-input').fill(FROM_FEN);
  await page.getByTestId('pgn-submit').click();
  await expect(page.getByTestId('players')).toContainText('Trainer');
  await expect(page.locator('[data-node^="m"]')).toHaveCount(8);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('label-card')).toContainText('50... Kh7');
  await waitComplete(page, 60_000);
  await page.keyboard.press('End');
  await expect(page.getByTestId('label-card')).toContainText('54. Qg7#');
  await expect(page.getByTestId('eval-white')).toContainText('1-0');
  await shot(page, '16-from-fen-mate');
});

test('engine crash mid-analysis recovers; a failed ply can be retried', async ({ page }) => {
  await importPgn(page, OPERA);
  await expect(page.getByTestId('board')).toBeVisible();
  await expect.poll(() => labelledMoves(page), { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  const kill = await hooks(page, (h) => h.killEngines());
  expect(kill.killed).toBeGreaterThan(0);
  await waitComplete(page, 180_000);
  expect(await labelledMoves(page)).toBe(33);
  await expect(page.getByTestId('failed-count')).toHaveCount(0);

  // a ply whose analysis fails twice (injected) shows an error with "Try again"
  await hooks(page, (h) => h.failNext(2));
  await page.getByTestId('open-pgn').click();
  await page.getByTestId('pgn-input').fill(TWO_PLIES.replace('1. e4 e5', '1. d4 d5'));
  await page.getByTestId('pgn-submit').click();
  await expect(page.getByTestId('failed-count')).toContainText('1 failed', { timeout: 60_000 });
  // ply 1 (1. d4) is cached from the Lasker game, so the injected failures hit ply 2
  await page.keyboard.press('End');
  await expect(page.getByTestId('ply-error')).toContainText('injected');
  await shot(page, '17-ply-error');
  await page.getByTestId('retry').click();
  await expect(page.getByTestId('label-reason')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('failed-count')).toHaveCount(0);
  await waitComplete(page, 30_000);

  // a failing side-line analysis, then a successful retry
  await hooks(page, (h) => h.failNext(2));
  await page.keyboard.press('ArrowLeft'); // after 1. d4, Black to move
  await drag(page, 'g8', 'f6');
  await expect(page.getByTestId('ply-error')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('retry').click();
  await expect(page.getByTestId('label-reason')).toBeVisible({ timeout: 60_000 });
});

test('allowed mate (M3 mate rule): a Blunder in a lost position, explained in the label reason and the tooltip', async ({ page }) => {
  // White (a knight down to a queen: lost either way) plays 1. a3?? and allows 1... Qe1#; h3 / Nd2 / Nc3 avoid it.
  // By win chance alone that is at most a Mistake (White's win chance was already tiny); the mate rule makes it a
  // Blunder. (A constructed position: in the fast E2E profile (d10) the Opera game's 15... Nxd7 is not reliable.)
  // no name remembered: "You" = White
  await importPgn(page, ALLOWED_MATE);
  await waitComplete(page, 60_000);
  const chip = page.locator('[data-node="m1"]');
  await expect(chip.locator('[data-label]')).toHaveAttribute('data-label', 'blunder');
  await expect(chip.locator('[data-label]')).toHaveAttribute('title', /allows a forced mate in 3 or less/);
  await chip.click();
  await expect(page.getByTestId('label-name')).toHaveText('Blunder');
  await expect(page.getByTestId('label-reason')).toContainText('You allowed mate in one. You were already losing, but');
  await expect(page.getByTestId('label-reason')).toContainText('would have avoided it — watch for mating threats.');
  await expect(page.getByTestId('mate-rule-note')).toContainText('marked Blunder because it allows a quick forced mate');
  await shot(page, '20-allowed-mate');
  // the mating move itself
  await page.locator('[data-node="m2"]').click();
  await expect(page.getByTestId('label-reason')).toContainText('Checkmate!');
});

test('long game (160 plies): UI stays responsive', async ({ page }) => {
  const t0 = Date.now();
  await importPgn(page, longGame(160));
  await expect(page.locator('[data-node^="m"]')).toHaveCount(160);
  console.log(`long game opened in ${Date.now() - t0} ms`);
  await page.getByTestId('board').click({ position: { x: 5, y: 5 } });
  const t1 = Date.now();
  for (let i = 0; i < 160; i++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-node="m160"]')).toHaveAttribute('data-active', 'true');
  const stepMs = (Date.now() - t1) / 160;
  console.log(`stepping: ${stepMs.toFixed(1)} ms per move`);
  expect(stepMs).toBeLessThan(60);
  await page.getByTestId('eval-graph').click({ position: { x: 100, y: 30 } });
  await expect(page.getByTestId('label-card')).toBeVisible();
  await shot(page, '18-long-game');
});

test('1920x1080 screenshots of finished games', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await rememberName(page, 'SzymonJ');
  const id = await gameId(page, SHILLING_CHESSCOM);
  await page.goto(`/?game=${id}&ui=classic`);
  await waitComplete(page, 10_000);
  await page.keyboard.press('End');
  await shot(page, '03-checkmate');
  await page.keyboard.press('Home');
  await shot(page, '04-overview');
  // a move with a suggestion
  for (let ply = 1; ply <= 14; ply++) {
    await page.locator(`[data-node="m${ply}"]`).click();
    if ((await page.getByTestId('candidate-best').count()) + (await page.getByTestId('candidate-pick').count()) > 0) break;
  }
  await shot(page, '10-suggestion');
  const opera = await gameId(page, OPERA);
  await page.goto(`/?game=${opera}&ui=classic`);
  await waitComplete(page, 10_000);
  await page.locator('[data-node="m20"]').click(); // 10... cxb5 (material rule)
  await shot(page, '19-opera-material');
  await page.setViewportSize({ width: 1280, height: 720 });
  await shot(page, '19-opera-material');
});
