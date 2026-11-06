// Priority queue in front of one or more engines (see ARCHITECTURE.md "Engine").
//
// - `run(key, priority, job)`: queues `job(engine)`; resolves/rejects with its result. Each running job has an engine
//   of its own, so with N engines up to N jobs run concurrently (M4: N engine processes; one engine = one job at a
//   time, as before).
// - Lower number = higher priority (SIDELINE=0 > FOCUS=1 > BACKGROUND=2); FIFO within the same priority.
// - Dedupe: while a job with the same key is queued or running, another `run` with that key returns the SAME
//   promise (the job function is not run twice); the job is upgraded to the higher priority (a running job too, so
//   it is no longer preemptable by that priority).
// - `bump(key, priority)` upgrades a queued (or running) job. A queued job that changes priority joins the back of
//   its new class (FIFO by the time it entered that priority).
// - Preemption (M4, option `preempt`, default on; needs engines with `abort()`): when a job is queued, no engine is
//   free and a running job has a strictly lower priority, the lowest-priority running job (the most recently started
//   among equals) is preempted: its engine is aborted (`Engine.abort()`: the running search stops and rejects with
//   SearchAbortedError) and handed to the new job at once. The preempted job keeps its engine handle only as a
//   revoked lease (every further search rejects with SearchAbortedError); if it then fails with SearchAbortedError
//   it is re-queued with its old priority and position, otherwise its result is used as usual. Re-running a job is
//   cheap because its finished searches are cached (SearchCache) — only the interrupted search is repeated.
//   So a side-line move or a focused ply never waits behind long background jobs.
// - A finished key is forgotten (results are cached elsewhere), so a later `run` with the same key runs again.

import { SearchAbortedError } from './uci';
import type { Engine } from './uci';

export const Priority = {
  SIDELINE: 0,
  FOCUS: 1,
  BACKGROUND: 2,
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

export type Job<T, E> = (engine: E) => Promise<T>;

export interface SchedulerOptions {
  /** Preempt lower-priority running jobs when all engines are busy (default true). */
  preempt?: boolean;
}

interface Entry<E> {
  key: string;
  priority: Priority;
  seq: number;
  job: Job<unknown, E>;
  promise: Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  /** Running: engine slot, start order, lease revocation. */
  slot?: number;
  started?: number;
  revoke?: () => void;
  preempted?: boolean;
}

type Abortable = { abort?: () => void };

export class Scheduler<E = Engine> {
  /** All engines (one job runs on each at a time). */
  readonly engines: readonly E[];
  private readonly preemptEnabled: boolean;
  private queued = new Map<string, Entry<E>>();
  /** Jobs holding an engine slot. */
  private running = new Map<string, Entry<E>>();
  /** Preempted jobs still finishing (no engine slot; their lease is revoked). */
  private zombies = new Map<string, Entry<E>>();
  private free: number[];
  private seq = 0;
  private startSeq = 0;
  private idleWaiters: (() => void)[] = [];
  /** Number of preemptions so far (for logs / tests). */
  preemptions = 0;

  constructor(engines: E | readonly E[], opts: SchedulerOptions = {}) {
    this.engines = Array.isArray(engines) ? [...(engines as readonly E[])] : [engines as E];
    if (this.engines.length === 0) throw new Error('Scheduler needs at least one engine');
    this.free = this.engines.map((_, i) => i);
    this.preemptEnabled = opts.preempt ?? true;
  }

  /**
   * Add an engine (one more job runs at a time), e.g. once it has started: the browser starts its WASM instances one
   * after another and the first one already works while the others load.
   */
  addEngine(engine: E): void {
    (this.engines as E[]).push(engine);
    this.free.push(this.engines.length - 1);
    queueMicrotask(() => this.pump());
  }

  /** The first engine (single-engine use). */
  get engine(): E {
    return this.engines[0]!;
  }

  run<T>(key: string, priority: Priority, job: Job<T, E>): Promise<T> {
    const active = this.running.get(key) ?? this.zombies.get(key) ?? this.queued.get(key);
    if (active) {
      this.bump(key, priority);
      return active.promise as Promise<T>;
    }
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.queued.set(key, { key, priority, seq: this.seq++, job: job as Job<unknown, E>, promise, resolve, reject });
    queueMicrotask(() => this.pump());
    return promise as Promise<T>;
  }

  /** Upgrade a job's priority (never downgrades). Returns true if the job is queued or running. */
  bump(key: string, priority: Priority): boolean {
    const r = this.running.get(key) ?? this.zombies.get(key);
    if (r) {
      if (priority < r.priority) r.priority = priority;
      return true;
    }
    const e = this.queued.get(key);
    if (!e) return false;
    if (priority < e.priority) {
      e.priority = priority;
      e.seq = this.seq++;
      queueMicrotask(() => this.pump()); // may now preempt a running job
    }
    return true;
  }

  /** Is the key queued or running? */
  has(key: string): boolean {
    return this.running.has(key) || this.zombies.has(key) || this.queued.has(key);
  }

  priorityOf(key: string): Priority | undefined {
    return (this.running.get(key) ?? this.zombies.get(key) ?? this.queued.get(key))?.priority;
  }

  /** Number of queued (not yet running) jobs. */
  get size(): number {
    return this.queued.size;
  }

  get busy(): boolean {
    return this.running.size > 0 || this.zombies.size > 0;
  }

  /** Jobs currently holding an engine. */
  get runningCount(): number {
    return this.running.size;
  }

  /** Resolves when nothing is queued or running. */
  onIdle(): Promise<void> {
    if (!this.busy && this.queued.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private next(): Entry<E> | undefined {
    let best: Entry<E> | undefined;
    for (const e of this.queued.values()) {
      if (!best || e.priority < best.priority || (e.priority === best.priority && e.seq < best.seq)) best = e;
    }
    return best;
  }

  /** The running job to preempt for a job of `priority`: lowest priority, most recently started. */
  private victim(priority: Priority): Entry<E> | undefined {
    if (!this.preemptEnabled) return undefined;
    let v: Entry<E> | undefined;
    for (const r of this.running.values()) {
      if (r.priority <= priority) continue;
      if (typeof (this.engines[r.slot!] as Abortable).abort !== 'function') continue;
      if (!v || r.priority > v.priority || (r.priority === v.priority && r.started! > v.started!)) v = r;
    }
    return v;
  }

  private pump(): void {
    for (;;) {
      const e = this.next();
      if (!e) break;
      if (this.free.length === 0) {
        const v = this.victim(e.priority);
        if (!v) break;
        this.preempt(v);
      }
      this.start(e, this.free.shift()!);
    }
    if (!this.busy && this.queued.size === 0) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const w of waiters) w();
    }
  }

  private preempt(v: Entry<E>): void {
    this.preemptions++;
    v.preempted = true;
    v.revoke!();
    (this.engines[v.slot!] as Abortable).abort!();
    this.running.delete(v.key);
    this.zombies.set(v.key, v);
    this.free.push(v.slot!);
    v.slot = undefined;
  }

  private start(e: Entry<E>, slot: number): void {
    this.queued.delete(e.key);
    e.slot = slot;
    e.started = this.startSeq++;
    e.preempted = false;
    this.running.set(e.key, e);
    const lease = this.lease(this.engines[slot]!);
    e.revoke = lease.revoke;
    let p: Promise<unknown>;
    try {
      p = Promise.resolve(e.job(lease.engine));
    } catch (err) {
      p = Promise.reject(err);
    }
    p.then(
      (v) => this.settle(e, () => e.resolve(v)),
      (err) => {
        if (e.preempted && err instanceof SearchAbortedError) {
          // re-queue with its old priority and FIFO position (cached searches make the re-run cheap)
          this.zombies.delete(e.key);
          if (!this.queued.has(e.key)) this.queued.set(e.key, e);
          this.pump();
          return;
        }
        this.settle(e, () => e.reject(err));
      },
    );
  }

  private settle(e: Entry<E>, done: () => void): void {
    if (this.running.get(e.key) === e) {
      this.running.delete(e.key);
      this.free.push(e.slot!);
      this.free.sort((a, b) => a - b);
    } else if (this.zombies.get(e.key) === e) {
      this.zombies.delete(e.key);
    }
    done();
    this.pump();
  }

  /**
   * The engine handle a job sees: the engine itself while the job owns it; after preemption every `search` call
   * rejects with SearchAbortedError. (Other members are passed through.)
   */
  private lease(engine: E): { engine: E; revoke: () => void } {
    if (!this.preemptEnabled || typeof engine !== 'object' || engine === null || typeof (engine as { search?: unknown }).search !== 'function') {
      return { engine, revoke: () => undefined };
    }
    let revoked = false;
    const target = engine as unknown as { search: (...a: unknown[]) => Promise<unknown> };
    const proxy = new Proxy(engine as object, {
      get(t, prop) {
        if (prop === 'search') {
          return (...a: unknown[]) => (revoked ? Promise.reject(new SearchAbortedError('job preempted')) : target.search(...a));
        }
        const v = Reflect.get(t, prop, t);
        return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v;
      },
    }) as E;
    return { engine: proxy, revoke: () => (revoked = true) };
  }
}
