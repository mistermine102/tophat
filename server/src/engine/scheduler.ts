// Priority queue in front of the single Engine (see ARCHITECTURE.md "Engine").
//
// - `run(key, priority, job)`: queues `job(engine)`; resolves/rejects with its result. Jobs run one at a time.
// - Lower number = higher priority (SIDELINE=0 > FOCUS=1 > BACKGROUND=2); FIFO within the same priority.
// - Dedupe: while a job with the same key is queued or running, another `run` with that key returns the SAME
//   promise (the job function is not run twice); if queued, the job is upgraded to the higher priority.
// - `bump(key, priority)` upgrades a queued job. A job that changes priority joins the back of its new class
//   (FIFO by the time it entered that priority).
// - Not preemptive: a running job finishes before the next one starts. A finished key is forgotten (results are
//   cached elsewhere), so a later `run` with the same key runs again.

import type { Engine } from './uci';

export const Priority = {
  SIDELINE: 0,
  FOCUS: 1,
  BACKGROUND: 2,
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

export type Job<T, E> = (engine: E) => Promise<T>;

interface Entry<E> {
  key: string;
  priority: Priority;
  seq: number;
  job: Job<unknown, E>;
  promise: Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

export class Scheduler<E = Engine> {
  private queued = new Map<string, Entry<E>>();
  private running: Entry<E> | null = null;
  private seq = 0;
  private idleWaiters: (() => void)[] = [];

  constructor(readonly engine: E) {}

  run<T>(key: string, priority: Priority, job: Job<T, E>): Promise<T> {
    if (this.running?.key === key) return this.running.promise as Promise<T>;
    const existing = this.queued.get(key);
    if (existing) {
      this.bump(key, priority);
      return existing.promise as Promise<T>;
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

  /** Upgrade a queued job's priority (never downgrades). Returns true if the job is queued or running. */
  bump(key: string, priority: Priority): boolean {
    if (this.running?.key === key) return true;
    const e = this.queued.get(key);
    if (!e) return false;
    if (priority < e.priority) {
      e.priority = priority;
      e.seq = this.seq++;
    }
    return true;
  }

  /** Is the key queued or running? */
  has(key: string): boolean {
    return this.running?.key === key || this.queued.has(key);
  }

  priorityOf(key: string): Priority | undefined {
    if (this.running?.key === key) return this.running.priority;
    return this.queued.get(key)?.priority;
  }

  /** Number of queued (not yet running) jobs. */
  get size(): number {
    return this.queued.size;
  }

  get busy(): boolean {
    return this.running !== null;
  }

  /** Resolves when nothing is queued or running. */
  onIdle(): Promise<void> {
    if (!this.running && this.queued.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private next(): Entry<E> | undefined {
    let best: Entry<E> | undefined;
    for (const e of this.queued.values()) {
      if (!best || e.priority < best.priority || (e.priority === best.priority && e.seq < best.seq)) best = e;
    }
    return best;
  }

  private pump(): void {
    if (this.running) return;
    const e = this.next();
    if (!e) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const w of waiters) w();
      return;
    }
    this.queued.delete(e.key);
    this.running = e;
    let p: Promise<unknown>;
    try {
      p = Promise.resolve(e.job(this.engine));
    } catch (err) {
      p = Promise.reject(err);
    }
    p.then(e.resolve, e.reject).finally(() => {
      this.running = null;
      this.pump();
    });
  }
}
