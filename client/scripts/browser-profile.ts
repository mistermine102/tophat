// In-browser performance profile (BACKLOG C1): opens the app in Playwright Chromium, imports a PGN with a cold cache
// (fresh browser profile = empty IndexedDB) and measures the time to the first label and to the whole game.
//
// Usage (with a dev server or `vite preview` running on the URL's port):
//   npx tsx client/scripts/browser-profile.ts <file.pgn> [--url http://localhost:5473] [--query "engines=4"] [--runs 1]
//     [--probe] [--json out.json]
//   --query  extra URL parameters (engines=N, threads=N, hash=MB, engine=lite, profile=fast)
//   --probe  at 15 s, click the ply at 2/3 of the game (focus) and time its label
// Prints the engine, cross-origin isolation, engine start, first label, 10 plies, all plies and (with --probe) the
// focused ply's latency.
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUE_OPTS = new Set(['--url', '--query', '--runs', '--json']);
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_OPTS.has(args[i - 1]!)));
if (!file) {
  console.error('usage: npx tsx client/scripts/browser-profile.ts <file.pgn> [--url URL] [--query "engines=4"] [--runs N] [--probe] [--json out.json]');
  process.exit(2);
}
const base = opt('url') ?? 'http://localhost:5473';
const query = opt('query') ?? '';
const runs = Number(opt('runs') ?? 1);
const pgn = readFileSync(file, 'utf8');

interface Run {
  query: string;
  engine: string | null;
  isolated: boolean;
  plies: number;
  engineReadyMs: number;
  firstLabelMs: number;
  tenPliesMs: number;
  allMs: number;
  focusMs?: number;
  stats?: unknown;
}

async function once(): Promise<Run> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.error(`  [page ${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => console.error(`  [page error] ${e.message}`));
  await page.goto(`${base}/?ui=classic&testhooks=1${query ? `&${query}` : ''}`);
  await page.getByTestId('pgn-input').fill(pgn);
  const t0 = Date.now();
  await page.getByTestId('pgn-submit').click();
  const done = async () => page.evaluate(() => document.querySelectorAll('[data-node^="m"] [data-label]').length);
  const total = await page.evaluate(() => 0);
  void total;
  let first = 0;
  let ten = 0;
  let plies = 0;
  let focusMs: number | undefined;
  let probed = false;
  const engineReady = page
    .evaluate(async () => {
      const t = (window as unknown as { __chessCoachTest: { health(): Promise<{ ok: boolean; engine: string | null; error?: string }> } }).__chessCoachTest;
      return t.health();
    })
    .then((h) => ({ h, ms: Date.now() - t0 }));
  for (;;) {
    const n = await done();
    const now = Date.now() - t0;
    if (n > 0 && !first) first = now;
    if (n >= 10 && !ten) ten = now;
    const prog = (await page.getByTestId('progress').innerText().catch(() => '')).trim();
    const m = /Analysed (\d+)\/(\d+)/.exec(prog);
    if (m) plies = Number(m[2]);
    if (args.includes('--probe') && !probed && now > 15_000 && plies) {
      probed = true;
      const P = Math.round((plies * 2) / 3);
      const node = page.locator(`[data-node="m${P}"]`);
      if ((await node.locator('[data-label]').count()) === 0) {
        const tf = Date.now();
        await node.click();
        await node.locator('[data-label]').waitFor({ timeout: 300_000 });
        focusMs = Date.now() - tf;
      }
    }
    if (plies && n >= plies) break;
    if (!m && /complete/i.test(prog) && n > 0) break;
    if (now > 900_000) throw new Error('timeout');
    await page.waitForTimeout(250);
  }
  const allMs = Date.now() - t0;
  const { h, ms } = await engineReady;
  const stats = await page.evaluate(() => (window as unknown as { __chessCoachTest: { stats(): Promise<unknown> } }).__chessCoachTest.stats());
  const isolated = await page.evaluate(() => self.crossOriginIsolated);
  // memory of the page and its workers (Chromium, cross-origin isolated pages only); can take a while to answer
  const memoryMb = await page
    .evaluate(async () => {
      const p = performance as unknown as { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> };
      if (!p.measureUserAgentSpecificMemory) return null;
      const r = await Promise.race([p.measureUserAgentSpecificMemory(), new Promise<null>((res) => setTimeout(() => res(null), 30_000))]);
      return r ? Math.round(r.bytes / 1e6) : null;
    })
    .catch(() => null);
  if (stats && typeof stats === 'object') (stats as Record<string, unknown>).memoryMb = memoryMb;
  await browser.close();
  return { query, engine: h.engine, isolated, plies: plies || (await Promise.resolve(0)), engineReadyMs: ms, firstLabelMs: first, tenPliesMs: ten, allMs, ...(focusMs !== undefined ? { focusMs } : {}), stats };
}

const out: Run[] = [];
for (let i = 0; i < runs; i++) {
  const r = await once();
  out.push(r);
  console.log(
    `${query || '(defaults)'}: ${r.engine} isolated=${r.isolated} plies=${r.plies} engine ready ${(r.engineReadyMs / 1000).toFixed(1)} s, first label ${(r.firstLabelMs / 1000).toFixed(1)} s, 10 plies ${(r.tenPliesMs / 1000).toFixed(1)} s, all ${(r.allMs / 1000).toFixed(1)} s${r.focusMs !== undefined ? `, focused ply ${(r.focusMs / 1000).toFixed(1)} s` : ''} ${JSON.stringify(r.stats)}`,
  );
}
const json = opt('json');
if (json) writeFileSync(json, JSON.stringify(out, null, 1));
