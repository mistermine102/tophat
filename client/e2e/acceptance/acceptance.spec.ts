// M6 acceptance walk-through as a beginner, against a running `npm start` (real engine, default profile).
// See playwright.acceptance.config.ts. For each game: paste, watch the streaming, flip to your side, step through
// every mistake / blunder / miss and read the panel, "Play it", drag pieces, back to game, flip, reload.
// Everything the panel said is written to ACCEPT_OUT/log-<game>.md (with layout checks) for a human to read;
// screenshots go to ACCEPT_OUT/<size>-<game>-<step>.png.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { parsePgn, startingPosition } from 'chessops/pgn';
import { makeSanAndPlay, parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { drag } from '../real/helpers';

const OUT = process.env.ACCEPT_OUT ?? join(process.cwd(), '..', 'tmp', 'acceptance');
mkdirSync(OUT, { recursive: true });
const SMALL = { width: 1366, height: 768 };
const BIG = { width: 1920, height: 1080 };

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
interface GameCase {
  key: string;
  pgn: string;
  /** Your player name in the PGN (decides which side is "You"; empty: Black). */
  username: string;
  /** Main-line plies (position after it) to drag a piece in. */
  dragPlies: number[];
  full: boolean;
}
const GAMES: GameCase[] = [
  { key: 'chesscom', pgn: read('./chesscom-SzymonPlays.pgn'), username: 'SzymonPlays', dragPlies: [9, 30, 52], full: true },
  { key: '5frUvyHl', pgn: read('../../../bench/games/lichess/5frUvyHl.pgn'), username: '', dragPlies: [20], full: false },
  { key: 'mcz8Z7Cr', pgn: read('../../../bench/games/lichess/mcz8Z7Cr.pgn'), username: '', dragPlies: [16], full: false },
  { key: '57RP5sCb', pgn: read('../../../bench/games/lichess/57RP5sCb.pgn'), username: '', dragPlies: [24], full: false },
];

function header(pgn: string, name: string): string {
  return new RegExp(`\\[${name} "([^"]*)"\\]`).exec(pgn)?.[1] ?? '';
}

/** FENs after each main-line ply (index = ply) and the UCI of each ply. */
function mainLine(pgn: string): { fens: string[]; ucis: string[] } {
  const game = parsePgn(pgn)[0]!;
  const pos = startingPosition(game.headers).unwrap();
  const fens = [fenOf(pos)];
  const ucis = [''];
  for (const n of game.moves.mainline()) {
    const m = parseSan(pos, n.san)!;
    ucis.push(makeUci(m));
    pos.play(m);
    fens.push(fenOf(pos));
  }
  return { fens, ucis };
}
function fenOf(pos: Chess): string {
  return makeFen(pos.toSetup());
}

/** A plausible beginner move in the position that differs from the game's move: a capture if any, else a central/developing move. */
function exploreMove(fen: string, avoid: string): { uci: string; san: string } | null {
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  const all: { uci: string; san: string; score: number }[] = [];
  for (const [from, dests] of pos.allDests()) {
    for (const to of dests) {
      const move = { from, to };
      const uci = makeUci(move);
      if (uci === avoid || uci.length > 4) continue;
      const san = makeSanAndPlay(pos.clone(), move);
      if (san.startsWith('K') || san.startsWith('O-')) continue;
      const score = (san.includes('x') ? 10 : 0) + (san.includes('+') ? 5 : 0) + (/^[NB]/.test(san) ? 3 : 0) + (/[de][45]/.test(san) ? 2 : 0);
      all.push({ uci, san, score });
    }
  }
  all.sort((a, b) => b.score - a.score || a.uci.localeCompare(b.uci));
  return all[0] ?? null;
}

class Log {
  lines: string[] = [];
  add(s = '') {
    this.lines.push(s);
  }
  save(name: string) {
    writeFileSync(join(OUT, `log-${name}.md`), this.lines.join('\n') + '\n');
  }
}

async function shot(page: Page, name: string, settle = 450) {
  await page.waitForTimeout(settle);
  const vp = page.viewportSize()!;
  await page.screenshot({ path: join(OUT, `${vp.width}x${vp.height}-${name}.png`) });
}

/** Layout problems: page scrolls, panels cut off, horizontal overflow inside panels. */
async function layout(page: Page): Promise<string> {
  return page.evaluate(() => {
    const out: string[] = [];
    const d = document.documentElement;
    if (d.scrollWidth > innerWidth + 1) out.push(`page scrolls horizontally (${d.scrollWidth} > ${innerWidth})`);
    if (d.scrollHeight > innerHeight + 1) out.push(`page scrolls vertically (${d.scrollHeight} > ${innerHeight})`);
    const ex = document.querySelector('[data-testid="explanation"]')?.parentElement;
    if (ex && ex.scrollHeight > ex.clientHeight + 1) out.push(`explanation column scrolls (${ex.scrollHeight}/${ex.clientHeight})`);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('section, header, [data-testid]'))) {
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== 'auto') {
        out.push(`h-overflow in ${el.dataset.testid ?? el.tagName.toLowerCase()} (${el.scrollWidth}/${el.clientWidth})`);
      }
    }
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.truncate'))) {
      if (el.scrollWidth > el.clientWidth + 1 && el.offsetParent) out.push(`truncated text: "${el.textContent?.trim().slice(0, 60)}"`);
    }
    return out.length ? out.join('; ') : 'ok';
  });
}

async function panelText(page: Page): Promise<string> {
  const parts: string[] = [];
  parts.push((await page.getByTestId('label-card').innerText()).replace(/\n+/g, ' | '));
  for (const k of ['pick', 'best'] as const) {
    const c = page.getByTestId(`candidate-${k}`);
    if (await c.count()) parts.push(`[${k}] ${(await c.innerText()).replace(/\n+/g, ' | ')}`);
  }
  return parts.join('\n    ');
}

async function waitLabel(page: Page, timeout = 60_000): Promise<number> {
  const t0 = Date.now();
  await expect(page.getByTestId('label-reason')).toBeVisible({ timeout });
  return Date.now() - t0;
}

/** "You" = the side at the bottom: flip the board when it shows the other side. */
async function playAs(page: Page, color: 'white' | 'black') {
  const cls = (await page.getByTestId('board').getAttribute('class')) ?? '';
  if (!cls.includes(`orientation-${color}`)) await page.getByTestId('flip').click();
  await expect(page.getByTestId('board')).toHaveClass(new RegExp(`orientation-${color}`));
}

test.describe.configure({ mode: 'serial' });

for (const g of GAMES) {
  test(`walk-through ${g.key}`, async ({ page }) => {
    const log = new Log();
    const white = header(g.pgn, 'White');
    const black = header(g.pgn, 'Black');
    const username = g.username || black; // lichess games: the user played Black (board must flip)
    const youColor = username === white ? 'white' : 'black';
    const { fens, ucis } = mainLine(g.pgn);
    log.add(`# ${g.key}: ${white} vs ${black} (${ucis.length - 1} plies), username "${username}" -> You = ${youColor}`);

    await page.setViewportSize(SMALL);
    // fresh browser state once (not on reload)
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('accept-init')) {
        localStorage.clear();
        sessionStorage.setItem('accept-init', '1');
      }
    });

    // 1. first launch
    await page.goto('/?ui=classic');
    await expect(page.getByTestId('pgn-input')).toBeVisible();
    if (g.full) await shot(page, `${g.key}-01-first-launch`);
    log.add(`- first launch layout: ${await layout(page)}`);

    // 2. paste + analyse
    await page.getByTestId('pgn-input').fill(g.pgn);
    if (g.full) await shot(page, `${g.key}-02-pasted`, 100);
    const t0 = Date.now();
    await page.getByTestId('pgn-submit').click();
    await expect(page.getByTestId('board')).toBeVisible();
    log.add(`- board visible after ${Date.now() - t0} ms`);
    await page.waitForTimeout(1500);
    if (g.full) await shot(page, `${g.key}-03-streaming`, 0);
    log.add(`- progress after 1.5 s: "${(await page.getByTestId('progress').innerText()).trim()}"`);
    await page.waitForTimeout(3000);
    log.add(`- progress after 4.5 s: "${(await page.getByTestId('progress').innerText()).trim()}"`);

    // 3. your side: flip the board if needed ("You" = the side at the bottom)
    await playAs(page, youColor);
    const orient = (await page.getByTestId('board').getAttribute('class')) ?? '';
    log.add(`- after flip: board ${orient.includes('orientation-black') ? 'black' : 'white'} at bottom (expected ${youColor}); summary You = "${(await page.getByTestId('summary').innerText()).split('\n').slice(0, 6).join(' / ')}"`);
    expect(orient.includes(`orientation-${youColor}`)).toBe(true);

    // 4. step into the game while it streams (pending moves)
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    log.add(`- ply 12 while streaming: ${(await page.getByTestId('label-card').innerText()).replace(/\n+/g, ' | ')}`);
    if (g.full) await shot(page, `${g.key}-04-stepping-while-streaming`, 0);
    const focusMs = await waitLabel(page, 90_000).catch(() => -1);
    log.add(`- focused ply 12 labelled after ${focusMs} ms`);

    // 5. wait for the whole game
    const deadline = Date.now() + 15 * 60_000;
    let last = '';
    while (Date.now() < deadline) {
      const p = (await page.getByTestId('progress').innerText()).trim();
      if (p !== last) last = p;
      if (p.includes('complete')) break;
      await page.waitForTimeout(1000);
    }
    log.add(`- analysis complete after ${((Date.now() - t0) / 1000).toFixed(0)} s (${last})`);
    if (g.full) await shot(page, `${g.key}-05-complete-ply12`);

    // 6. overview + key moments
    await page.keyboard.press('Home');
    await expect(page.getByTestId('key-moments')).toBeVisible();
    await shot(page, `${g.key}-06-overview`);
    log.add(`- overview layout: ${await layout(page)}`);
    log.add(`- summary: ${(await page.getByTestId('summary').innerText()).replace(/\n+/g, ' / ')}`);
    log.add(`- key moments: ${(await page.getByTestId('key-moments').innerText()).replace(/\n+/g, ' / ')}`);
    const moments = page.getByTestId('key-moments').locator('button');
    const n = await moments.count();
    log.add('');
    log.add('## Key moments');
    let played = false;
    for (let i = 0; i < n; i++) {
      await page.keyboard.press('Home');
      await moments.nth(i).click();
      await waitLabel(page);
      const name = (await page.getByTestId('label-name').innerText()).trim();
      log.add(`- **${i + 1}. ${name}**\n    ${await panelText(page)}\n    layout: ${await layout(page)}`);
      if (name === 'Blunder' || (g.full && i < 3)) await shot(page, `${g.key}-07-moment-${String(i + 1).padStart(2, '0')}-${name.toLowerCase()}`);
      // 7. "Play it" on the first suggestion
      if (!played && (await page.getByTestId('play-pick').count())) {
        played = true;
        const tp = Date.now();
        await page.getByTestId('play-pick').click();
        const ms = await waitLabel(page, 60_000).catch(() => -1);
        log.add(`    PLAY IT (pick): analysed in ${ms < 0 ? 'TIMEOUT' : Date.now() - tp} ms\n    ${await panelText(page)}`);
        await shot(page, `${g.key}-08-play-it`);
        await page.getByTestId('back-to-game').click();
        log.add(`    back to game -> ${(await page.getByTestId('label-card').innerText()).split('\n').slice(0, 2).join(' ')}`);
      }
    }

    // 7b. "Next mistake" from the start
    await page.keyboard.press('Home');
    const nm = page.getByTestId('next-mistake');
    if (await nm.count()) {
      await nm.click();
      await waitLabel(page);
      log.add(`- Next mistake from the start -> ${(await page.getByTestId('label-card').innerText()).split('\n').slice(0, 3).join(' ')}; more-below hint: ${await page.getByTestId('more-below').count()}`);
      if (g.full) await shot(page, `${g.key}-07b-next-mistake`);
    } else log.add('- Next mistake button: MISSING');

    // 8. drag pieces
    log.add('');
    log.add('## Exploring (drag)');
    for (const ply of g.dragPlies) {
      await page.locator(`[data-node="m${ply}"]`).click();
      const mv = exploreMove(fens[ply]!, ucis[ply + 1] ?? '');
      if (!mv) continue;
      const td = Date.now();
      await drag(page, mv.uci.slice(0, 2), mv.uci.slice(2, 4));
      await expect(page.getByTestId('back-to-game')).toBeVisible();
      if (g.full) await shot(page, `${g.key}-09-drag-${ply}-pending`, 100);
      const ms = await waitLabel(page, 60_000).catch(() => -1);
      log.add(`- after ply ${ply}: dragged ${mv.san}, analysed in ${ms < 0 ? 'TIMEOUT' : Date.now() - td} ms\n    ${await panelText(page)}\n    layout: ${await layout(page)}`);
      await shot(page, `${g.key}-09-drag-${ply}`);
      await page.getByTestId('back-to-game').click();
      await expect(page.getByTestId('back-to-game')).toHaveCount(0);
    }

    // 9. flip, reload, big screen
    await page.getByTestId('flip').click();
    if (g.full) await shot(page, `${g.key}-10-flipped`);
    await page.getByTestId('flip').click();
    const tr = Date.now();
    await page.reload();
    await expect(page.getByTestId('progress')).toContainText('complete', { timeout: 30_000 });
    log.add(`- reload: game back, analysis complete after ${Date.now() - tr} ms; url ${page.url()}`);
    if (g.full) await shot(page, `${g.key}-11-reloaded`);
    await page.setViewportSize(BIG);
    await page.keyboard.press('Home');
    await shot(page, `${g.key}-12-overview`);
    if (n) {
      await moments.nth(n - 1).click();
      await waitLabel(page);
      await shot(page, `${g.key}-13-last-moment`);
      log.add(`- 1920 layout: ${await layout(page)}`);
    }
    log.save(g.key);
  });
}
