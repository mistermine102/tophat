#!/usr/bin/env node
// Downloads Stockfish 19 (official GitHub release sf_19) to engine/stockfish.exe if it is missing.
// Idempotent: an existing binary is never replaced or deleted.
// Target override: STOCKFISH_PATH=<path to exe>. Unzips with tar.exe (bsdtar, built into Windows 10+),
// falling back to PowerShell Expand-Archive.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_ = 'https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-windows-x86-64-universal.zip';
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const target = process.env.STOCKFISH_PATH || join(repo, 'engine', 'stockfish.exe');

function engineName(exe) {
  const r = spawnSync(exe, [], { input: 'uci\nquit\n', encoding: 'utf8', timeout: 15000, windowsHide: true });
  return /^id name (.+)$/m.exec(r.stdout ?? '')?.[1]?.trim() ?? null;
}

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function unzip(zip, dest) {
  // Windows' own bsdtar reads zip files; Git Bash's GNU tar (often first on PATH) does not.
  const winTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  try {
    execFileSync(existsSync(winTar) ? winTar : 'tar', ['-xf', zip, '-C', dest], { stdio: 'inherit' });
  } catch {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`], { stdio: 'inherit' });
  }
}

/** Reads the response body, printing progress every ~10 % (a slow connection otherwise looks frozen). */
async function download(res) {
  const total = Number(res.headers.get('content-length')) || 0;
  const chunks = [];
  let got = 0;
  let shown = 0;
  for await (const chunk of res.body) {
    chunks.push(chunk);
    got += chunk.length;
    const pct = total ? Math.floor((got / total) * 10) * 10 : 0;
    if (total && pct > shown) {
      shown = pct;
      console.log(`[setup-engine] ${pct}% of ${(total / 1e6).toFixed(0)} MB`);
    }
  }
  return Buffer.concat(chunks);
}

async function main() {
  if (existsSync(target)) {
    console.log(`[setup-engine] ${target} already exists (${engineName(target) ?? 'unknown engine'}); nothing to do.`);
    return;
  }
  if (process.platform !== 'win32') {
    console.error('[setup-engine] This script downloads the Windows build. On other platforms install Stockfish 19 and set STOCKFISH_PATH.');
    process.exit(1);
  }
  const work = mkdtempSync(join(tmpdir(), 'stockfish-'));
  try {
    console.log(`[setup-engine] downloading ${URL_}`);
    const res = await fetch(URL_, { redirect: 'follow' });
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status} ${res.statusText}`);
    const zip = join(work, 'stockfish.zip');
    writeFileSync(zip, await download(res));
    const out = join(work, 'x');
    mkdirSync(out);
    unzip(zip, out);
    const files = walk(out);
    const exe = files.find((f) => /^stockfish.*\.exe$/i.test(basename(f)));
    if (!exe) throw new Error(`no stockfish*.exe in archive (found: ${files.map((f) => basename(f)).join(', ')})`);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(exe, target);
    const license = files.find((f) => /^copying(\.txt)?$/i.test(basename(f)));
    const licenseTarget = join(dirname(target), 'STOCKFISH-COPYING.txt');
    if (license && !existsSync(licenseTarget)) copyFileSync(license, licenseTarget);
    const name = engineName(target);
    if (!name) throw new Error(`${target} does not answer UCI`);
    console.log(`[setup-engine] installed ${name} -> ${target}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(`[setup-engine] ${e.message}`);
  process.exit(1);
});
