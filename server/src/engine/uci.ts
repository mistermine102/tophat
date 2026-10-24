// Engine: a UCI process wrapper around a single Stockfish process (see ARCHITECTURE.md "Engine").
//
// - All commands go through one serialised queue: `search()` is safe to call concurrently; calls run in order.
// - Every search is preceded by `isready` sync so stale output can never leak into the next search.
// - Positions with no legal moves resolve to `{ lines: [], bestmove: null }` (engine prints `bestmove (none)`).
// - Timeouts reject with EngineTimeoutError (the engine is stopped, or killed and restarted on next use).
// - If the process crashes, the pending request rejects with EngineCrashedError; the next call restarts it.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import type { Score } from '@chess-coach/shared';
import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { parseUci } from 'chessops/util';

export interface EngineOptions {
  path?: string;
  threads?: number;
  hashMb?: number;
  /** Default per-search timeout when the request has none (ms). Default 120 s (movetime searches: movetime + 10 s). */
  searchTimeoutMs?: number;
}

export interface SearchRequest {
  fen: string;
  multipv?: number; // default 1
  depth?: number; // stop condition (one of depth/movetimeMs/nodes required)
  movetimeMs?: number;
  nodes?: number;
  searchmoves?: string[]; // UCI moves to restrict to
  /** Optional override of the search timeout (ms). */
  timeoutMs?: number;
}

export interface PvLine {
  multipv: number; // 1-based rank
  move: string; // first move UCI
  score: Score; // side-to-move POV
  depth: number;
  pv: string[]; // UCI
}

export interface SearchResult {
  lines: PvLine[];
  bestmove: string | null;
  depth: number;
  nodes: number;
  timeMs: number;
}

export class EngineError extends Error {
  override name = 'EngineError';
}
export class EngineTimeoutError extends EngineError {
  override name = 'EngineTimeoutError';
}
export class EngineCrashedError extends EngineError {
  override name = 'EngineCrashedError';
}

/** `STOCKFISH_PATH` env, else `<repo>/engine/stockfish.exe`. */
export function defaultEnginePath(): string {
  const env = process.env.STOCKFISH_PATH;
  if (env) return env;
  return fileURLToPath(new URL('../../../engine/stockfish.exe', import.meta.url));
}

export function engineAvailable(path = defaultEnginePath()): boolean {
  return existsSync(path);
}

// ---------------------------------------------------------------------------------------------------------------
// UCI `info` parsing

export interface InfoLine {
  depth?: number;
  seldepth?: number;
  multipv?: number;
  score?: Score;
  bound?: 'lower' | 'upper';
  wdl?: [number, number, number];
  nodes?: number;
  nps?: number;
  time?: number;
  hashfull?: number;
  tbhits?: number;
  currmove?: string;
  currmovenumber?: number;
  pv?: string[];
  string?: string;
}

const NUMERIC_KEYS = new Set(['depth', 'seldepth', 'multipv', 'nodes', 'nps', 'time', 'hashfull', 'tbhits', 'currmovenumber', 'cpuload', 'sbhits']);

const toInt = (s: string | undefined): number | undefined => {
  if (s === undefined) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return n === 0 ? 0 : n; // normalise -0
};

/** Parse a UCI `info ...` line. Returns null for anything else. Unknown tokens are skipped. */
export function parseInfoLine(line: string): InfoLine | null {
  const t = line.trim().split(/\s+/);
  if (t[0] !== 'info') return null;
  const info: InfoLine = {};
  for (let i = 1; i < t.length; i++) {
    const key = t[i]!;
    if (NUMERIC_KEYS.has(key)) {
      const n = toInt(t[++i]);
      if (n !== undefined && key !== 'cpuload' && key !== 'sbhits') (info as Record<string, unknown>)[key] = n;
      continue;
    }
    switch (key) {
      case 'score': {
        const kind = t[i + 1];
        const v = toInt(t[i + 2]);
        if ((kind === 'cp' || kind === 'mate') && v !== undefined) {
          info.score = kind === 'cp' ? { cp: v } : { mate: v };
          i += 2;
        } else {
          i += 1;
        }
        break;
      }
      case 'lowerbound':
        info.bound = 'lower';
        break;
      case 'upperbound':
        info.bound = 'upper';
        break;
      case 'wdl': {
        const w = [toInt(t[i + 1]), toInt(t[i + 2]), toInt(t[i + 3])];
        if (w.every((x) => x !== undefined)) info.wdl = w as [number, number, number];
        i += 3;
        break;
      }
      case 'currmove':
        info.currmove = t[++i];
        break;
      case 'pv':
        info.pv = t.slice(i + 1).filter(Boolean);
        i = t.length;
        break;
      case 'string':
        info.string = t.slice(i + 1).join(' ');
        i = t.length;
        break;
      case 'refutation':
      case 'currline':
        i = t.length; // not used
        break;
      default:
        break; // unknown token: skip
    }
  }
  return info;
}

/** Collects info lines of one search and produces the final ranked PvLines. */
export class PvCollector {
  private slots = new Map<number, { exact?: PvLine; bound?: PvLine }>();
  nodes = 0;
  lastDepth = 0;

  constructor(private readonly maxMultipv: number) {}

  add(info: InfoLine): void {
    if (info.nodes !== undefined) this.nodes = info.nodes;
    if (info.depth !== undefined && info.score) this.lastDepth = Math.max(this.lastDepth, info.depth);
    if (!info.score || !info.pv || info.pv.length === 0 || info.depth === undefined) return;
    const multipv = info.multipv ?? 1;
    if (multipv < 1 || multipv > this.maxMultipv) return;
    const line: PvLine = { multipv, move: info.pv[0]!, score: info.score, depth: info.depth, pv: info.pv };
    const slot = this.slots.get(multipv) ?? {};
    // newer info at >= depth wins (later batches re-rank); exact lines are preferred over bound ones
    if (info.bound) {
      if (!slot.bound || line.depth >= slot.bound.depth) slot.bound = line;
    } else if (!slot.exact || line.depth >= slot.exact.depth) {
      slot.exact = line;
    }
    this.slots.set(multipv, slot);
  }

  lines(): PvLine[] {
    const out: PvLine[] = [];
    const seen = new Set<string>();
    for (const k of [...this.slots.keys()].sort((a, b) => a - b)) {
      const slot = this.slots.get(k)!;
      const line = slot.exact ?? slot.bound;
      if (!line || seen.has(line.move)) continue; // a stopped search can leave a stale duplicate rank
      seen.add(line.move);
      out.push({ ...line, multipv: out.length + 1 });
    }
    return out;
  }
}

// ---------------------------------------------------------------------------------------------------------------

interface Pending {
  done: (line: string) => boolean;
  onLine?: (line: string) => void;
  resolve: (line: string) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const START_TIMEOUT_MS = 15_000;
const READY_TIMEOUT_MS = 30_000;
const STOP_GRACE_MS = 3_000;

export class Engine {
  readonly path: string;
  readonly threads: number;
  readonly hashMb: number;
  readonly searchTimeoutMs: number;
  /** From `id name` (e.g. "Stockfish 19"). */
  name = 'unknown';

  private proc: ChildProcessWithoutNullStreams | null = null;
  private buf = '';
  private pending: Pending | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private multipv = 1;
  private closed = false;
  private lastStderr = '';

  private constructor(opts: EngineOptions = {}) {
    this.path = opts.path ?? defaultEnginePath();
    this.threads = Math.max(1, opts.threads ?? os.availableParallelism() - 2);
    this.hashMb = opts.hashMb ?? 512;
    this.searchTimeoutMs = opts.searchTimeoutMs ?? 120_000;
  }

  static async start(opts?: EngineOptions): Promise<Engine> {
    const engine = new Engine(opts);
    await engine.enqueue(() => engine.boot());
    return engine;
  }

  get alive(): boolean {
    return this.proc !== null;
  }

  /** Validates the request, then runs it after all previously queued commands. */
  search(req: SearchRequest): Promise<SearchResult> {
    let valid: ReturnType<typeof validate>;
    try {
      valid = validate(req);
    } catch (e) {
      return Promise.reject(e);
    }
    return this.enqueue(async () => {
      await this.ensureAlive();
      return this.runSearch({ ...req, fen: valid.fen, searchmoves: valid.searchmoves }, valid.multipv);
    });
  }

  newGame(): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureAlive();
      this.send('ucinewgame');
      await this.sync();
    });
  }

  /** Kill the current process (if any) and start a fresh one. */
  restart(): Promise<void> {
    return this.enqueue(async () => {
      this.kill();
      await this.boot();
    });
  }

  async quit(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const proc = this.proc;
    if (!proc) return;
    const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
    this.send('stop');
    this.send('quit');
    const t = setTimeout(() => proc.kill(), STOP_GRACE_MS);
    await exited;
    clearTimeout(t);
  }

  // --- internals ------------------------------------------------------------------------------------------------

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.tail.then(fn, fn);
    this.tail = p.catch(() => undefined);
    return p;
  }

  private async ensureAlive(): Promise<void> {
    if (this.closed) throw new EngineError('Engine has quit');
    if (!this.proc) await this.boot();
  }

  private async boot(): Promise<void> {
    if (this.closed) throw new EngineError('Engine has quit');
    if (!existsSync(this.path)) {
      throw new EngineError(`Stockfish binary not found at ${this.path} (run \`npm run setup:engine\` or set STOCKFISH_PATH)`);
    }
    const proc = spawn(this.path, [], { stdio: 'pipe', windowsHide: true });
    this.proc = proc;
    this.buf = '';
    this.multipv = 1;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => this.onData(chunk));
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk: string) => {
      this.lastStderr = (this.lastStderr + chunk).slice(-2000);
    });
    proc.stdin.on('error', () => undefined); // EPIPE after a crash; surfaced via 'exit'
    proc.on('error', (err) => this.onExit(proc, `failed to run engine: ${err.message}`));
    proc.on('exit', (code, signal) => this.onExit(proc, `engine exited (code ${code}, signal ${signal})`));

    try {
      await this.request('uci', (l) => l === 'uciok', START_TIMEOUT_MS, (l) => {
        if (l.startsWith('id name ')) this.name = l.slice('id name '.length).trim();
      });
      this.send(`setoption name Threads value ${this.threads}`);
      this.send(`setoption name Hash value ${this.hashMb}`);
      await this.sync();
    } catch (e) {
      this.kill();
      throw e;
    }
  }

  private async runSearch(req: SearchRequest, multipv: number): Promise<SearchResult> {
    if (multipv !== this.multipv) {
      this.send(`setoption name MultiPV value ${multipv}`);
      this.multipv = multipv;
    }
    this.send(`position fen ${req.fen}`);
    await this.sync();

    const go = ['go'];
    if (req.depth !== undefined) go.push('depth', String(req.depth));
    if (req.nodes !== undefined) go.push('nodes', String(req.nodes));
    if (req.movetimeMs !== undefined) go.push('movetime', String(req.movetimeMs));
    // searchmoves must be last: Stockfish consumes every remaining token as a move
    if (req.searchmoves?.length) go.push('searchmoves', ...req.searchmoves);

    const timeoutMs = req.timeoutMs ?? (req.movetimeMs !== undefined && req.depth === undefined && req.nodes === undefined ? req.movetimeMs + 10_000 : this.searchTimeoutMs);
    const collector = new PvCollector(multipv);
    const started = performance.now();
    let bestLine: string;
    try {
      bestLine = await this.request(go.join(' '), (l) => l.startsWith('bestmove'), timeoutMs, (l) => {
        const info = parseInfoLine(l);
        if (info) collector.add(info);
      });
    } catch (e) {
      if (e instanceof EngineTimeoutError && this.proc) {
        // try to bring the engine back to a clean state; if it doesn't answer, kill it (restart on next use)
        try {
          await this.request('stop', (l) => l.startsWith('bestmove'), STOP_GRACE_MS);
          await this.sync();
        } catch {
          this.kill();
        }
      }
      throw e;
    }
    const timeMs = Math.round(performance.now() - started);
    const best = bestLine.split(/\s+/)[1] ?? '(none)';
    if (best === '(none)') return { lines: [], bestmove: null, depth: 0, nodes: collector.nodes, timeMs };
    const lines = collector.lines();
    const depth = lines.reduce((d, l) => Math.max(d, l.depth), 0) || collector.lastDepth;
    return { lines, bestmove: best, depth, nodes: collector.nodes, timeMs };
  }

  private sync(): Promise<string> {
    return this.request('isready', (l) => l === 'readyok', READY_TIMEOUT_MS);
  }

  private send(cmd: string): void {
    if (!this.proc) throw new EngineCrashedError('Engine is not running');
    this.proc.stdin.write(cmd + '\n');
  }

  /** Send `cmd` and resolve with the first output line for which `done(line)` is true. One request at a time. */
  private request(cmd: string, done: (line: string) => boolean, timeoutMs: number, onLine?: (line: string) => void): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (!this.proc) {
        reject(new EngineCrashedError('Engine is not running'));
        return;
      }
      if (this.pending) {
        reject(new EngineError('internal: overlapping engine requests'));
        return;
      }
      const timer = setTimeout(() => {
        if (this.pending?.timer === timer) this.pending = null;
        reject(new EngineTimeoutError(`Engine did not answer "${cmd}" within ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending = { done, onLine, resolve, reject, timer };
      try {
        this.send(cmd);
      } catch (e) {
        clearTimeout(timer);
        this.pending = null;
        reject(e as Error);
      }
    });
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).replace(/\r$/, '').trim();
      this.buf = this.buf.slice(idx + 1);
      if (line) this.onLine(line);
    }
  }

  private onLine(line: string): void {
    const p = this.pending;
    if (!p) return; // unsolicited output (e.g. "info string" at startup): ignore
    p.onLine?.(line);
    if (p.done(line)) {
      clearTimeout(p.timer);
      this.pending = null;
      p.resolve(line);
    }
  }

  private onExit(proc: ChildProcessWithoutNullStreams, why: string): void {
    if (this.proc !== proc) return; // an old, already replaced process
    this.proc = null;
    const p = this.pending;
    this.pending = null;
    if (p) {
      clearTimeout(p.timer);
      const detail = this.lastStderr.trim() ? `; stderr: ${this.lastStderr.trim()}` : '';
      p.reject(this.closed ? new EngineError('Engine has quit') : new EngineCrashedError(`${why}${detail}`));
    }
  }

  private kill(): void {
    const proc = this.proc;
    if (!proc) return;
    this.onExit(proc, 'engine killed');
    proc.kill();
  }
}

/** chessops also accepts king-takes-rook castling (e1h1); Stockfish (non-960) needs king-to-square (e1g1). */
function toStandardCastling(pos: Chess, uci: string): string {
  const move = parseUci(uci);
  if (!move || !('from' in move)) return uci;
  const piece = pos.board.get(move.from);
  const target = pos.board.get(move.to);
  if (piece?.role !== 'king' || target?.role !== 'rook' || target.color !== piece.color) return uci;
  const file = (move.to & 7) > (move.from & 7) ? 'g' : 'c';
  return uci.slice(0, 2) + file + uci[1];
}

function validate(req: SearchRequest): { fen: string; multipv: number; searchmoves: string[] } {
  if (req.depth === undefined && req.movetimeMs === undefined && req.nodes === undefined) {
    throw new EngineError('SearchRequest needs one of depth, movetimeMs or nodes');
  }
  for (const [k, v] of [['depth', req.depth], ['movetimeMs', req.movetimeMs], ['nodes', req.nodes]] as const) {
    if (v !== undefined && !(Number.isInteger(v) && v > 0)) throw new EngineError(`SearchRequest.${k} must be a positive integer`);
  }
  const multipv = req.multipv ?? 1;
  if (!(Number.isInteger(multipv) && multipv >= 1 && multipv <= 500)) throw new EngineError('SearchRequest.multipv must be 1..500');

  // Validate with chessops first: an invalid FEN can crash Stockfish.
  const setup = parseFen(req.fen);
  if (setup.isErr) throw new EngineError(`Invalid FEN "${req.fen}": ${setup.error.message}`);
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) throw new EngineError(`Illegal position "${req.fen}": ${pos.error.message}`);
  const searchmoves: string[] = [];
  for (const uci of req.searchmoves ?? []) {
    const move = parseUci(uci);
    if (!move || !pos.value.isLegal(move)) throw new EngineError(`searchmoves: "${uci}" is not a legal move in ${req.fen}`);
    searchmoves.push(toStandardCastling(pos.value, uci));
  }
  return { fen: makeFen(pos.value.toSetup()), multipv, searchmoves };
}
