import { describe, expect, it } from 'vitest';
import { Priority, Scheduler } from '../src/engine/scheduler';
import { SearchAbortedError } from '../src/engine/uci';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A fake job that records start order and resolves when released. */
function harness() {
  const order: string[] = [];
  const releases = new Map<string, () => void>();
  let concurrent = 0;
  let maxConcurrent = 0;
  const job = (name: string, result: unknown = name) => async (engine: { id: string }) => {
    expect(engine.id).toBe('fake-engine');
    order.push(name);
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise<void>((r) => releases.set(name, r));
    concurrent--;
    return result;
  };
  const release = async (name: string) => {
    for (let i = 0; i < 50 && !releases.has(name); i++) await tick();
    const r = releases.get(name);
    if (!r) throw new Error(`job ${name} never started (order: ${order.join(',')})`);
    r();
    await tick();
  };
  return { order, job, release, maxConcurrent: () => maxConcurrent };
}

describe('Scheduler', () => {
  it('runs jobs one at a time and returns their results', async () => {
    const s = new Scheduler({ id: 'fake-engine' });
    const h = harness();
    const a = s.run('a', Priority.BACKGROUND, h.job('a', 1));
    const b = s.run('b', Priority.BACKGROUND, h.job('b', 2));
    await h.release('a');
    await h.release('b');
    expect(await a).toBe(1);
    expect(await b).toBe(2);
    expect(h.maxConcurrent()).toBe(1);
    await s.onIdle();
    expect(s.size).toBe(0);
    expect(s.busy).toBe(false);
  });

  it('orders by priority, FIFO within a priority', async () => {
    const s = new Scheduler({ id: 'fake-engine' });
    const h = harness();
    const all = [
      s.run('bg1', Priority.BACKGROUND, h.job('bg1')),
      s.run('bg2', Priority.BACKGROUND, h.job('bg2')),
      s.run('f1', Priority.FOCUS, h.job('f1')),
      s.run('side1', Priority.SIDELINE, h.job('side1')),
      s.run('f2', Priority.FOCUS, h.job('f2')),
      s.run('side2', Priority.SIDELINE, h.job('side2')),
    ];
    for (const n of ['side1', 'side2', 'f1', 'f2', 'bg1', 'bg2']) await h.release(n);
    await Promise.all(all);
    expect(h.order).toEqual(['side1', 'side2', 'f1', 'f2', 'bg1', 'bg2']);
  });

  it('a higher-priority job queued while another runs goes next (no preemption)', async () => {
    const s = new Scheduler({ id: 'fake-engine' });
    const h = harness();
    const p1 = s.run('bg1', Priority.BACKGROUND, h.job('bg1'));
    const p2 = s.run('bg2', Priority.BACKGROUND, h.job('bg2'));
    await tick();
    expect(h.order).toEqual(['bg1']);
    const p3 = s.run('side', Priority.SIDELINE, h.job('side'));
    await h.release('bg1');
    await h.release('side');
    await h.release('bg2');
    await Promise.all([p1, p2, p3]);
    expect(h.order).toEqual(['bg1', 'side', 'bg2']);
  });

  it('dedupes identical keys: same promise, job runs once, priority upgraded', async () => {
    const s = new Scheduler({ id: 'fake-engine' });
    const h = harness();
    let runs = 0;
    const counted = (name: string) => {
      const inner = h.job(name);
      return async (e: { id: string }) => {
        runs++;
        return inner(e);
      };
    };
    const first = s.run('running', Priority.BACKGROUND, h.job('running'));
    await tick(); // 'running' starts
    const x1 =s.run('x', Priority.BACKGROUND, counted('x'));
    const y = s.run('y', Priority.BACKGROUND, h.job('y'));
    const x2 = s.run('x', Priority.FOCUS, counted('x-dup'));
    expect(x2).toBe(x1);
    expect(s.priorityOf('x')).toBe(Priority.FOCUS);
    // the running job is deduped too
    expect(s.run('running', Priority.SIDELINE, h.job('never'))).toBe(first);
    await h.release('running');
    await h.release('x');
    await h.release('y');
    await Promise.all([first, x1, y]);
    expect(runs).toBe(1);
    expect(h.order).toEqual(['running', 'x', 'y']);
  });

  it('dedupe never downgrades priority', async () => {
    const s = new Scheduler({ id: 'fake-engine' });
    const h = harness();
    const p = s.run('a', Priority.SIDELINE, h.job('a'));
    s.run('a', Priority.BACKGROUND, h.job('a'));
    expect(s.priorityOf('a')).toBe(Priority.SIDELINE);
    await h.release('a');
    await p;
  });

  it('bump() re-prioritises a queued job; bumped job joins the back of its new class', async () => {
    const s = new Scheduler({ id: 'fake-engine' });
    const h = harness();
    const ps = [
      s.run('r', Priority.BACKGROUND, h.job('r')),
      s.run('b1', Priority.BACKGROUND, h.job('b1')),
      s.run('b2', Priority.BACKGROUND, h.job('b2')),
      s.run('b3', Priority.BACKGROUND, h.job('b3')),
    ];
    await tick(); // r is running
    s.run('f', Priority.FOCUS, h.job('f'));
    expect(s.bump('b3', Priority.FOCUS)).toBe(true);
    expect(s.bump('r', Priority.SIDELINE)).toBe(true); // running: no-op but known
    expect(s.bump('nope', Priority.SIDELINE)).toBe(false);
    for (const n of ['r', 'f', 'b3', 'b1', 'b2']) await h.release(n);
    await Promise.all(ps);
    expect(h.order).toEqual(['r', 'f', 'b3', 'b1', 'b2']);
  });

  it('a failing job rejects only its own promise and the queue continues; key can be re-run', async () => {
    const s = new Scheduler({ id: 'fake-engine' });
    const bad = s.run('bad', Priority.FOCUS, async () => {
      throw new Error('boom');
    });
    const sync = s.run('sync-throw', Priority.FOCUS, (() => {
      throw new Error('sync boom');
    }) as unknown as () => Promise<never>);
    const good = s.run('good', Priority.BACKGROUND, async () => 'ok');
    await expect(bad).rejects.toThrow('boom');
    await expect(sync).rejects.toThrow('sync boom');
    await expect(good).resolves.toBe('ok');
    expect(s.has('bad')).toBe(false);
    await expect(s.run('bad', Priority.FOCUS, async () => 'second try')).resolves.toBe('second try');
  });

  it('onIdle resolves when the queue drains', async () => {
    const s = new Scheduler({ id: 'fake-engine' });
    await s.onIdle();
    let done = 0;
    for (let i = 0; i < 5; i++) s.run(`k${i}`, Priority.BACKGROUND, async () => void done++);
    await s.onIdle();
    expect(done).toBe(5);
  });
});

/** A fake engine whose searches complete when the test says so; abort() rejects the running one like Engine. */
class FakeEngine {
  aborts = 0;
  current: { name: string; resolve: (v: string) => void; reject: (e: unknown) => void } | null = null;
  constructor(readonly id: string) {}
  search(name: string): Promise<string> {
    return new Promise((resolve, reject) => (this.current = { name, resolve, reject }));
  }
  abort(): void {
    this.aborts++;
    const c = this.current;
    this.current = null;
    c?.reject(new SearchAbortedError('aborted'));
  }
  finish(): string {
    const c = this.current;
    if (!c) throw new Error(`${this.id} has no running search`);
    this.current = null;
    c.resolve(c.name);
    return c.name;
  }
}

describe('Scheduler with several engines (M4)', () => {
  const settle = async () => {
    for (let i = 0; i < 10; i++) await tick();
  };
  /** A job doing `searches` searches in a row on its engine; records where each attempt started. */
  const jobs = (log: string[]) => (name: string, searches = 1) => async (e: FakeEngine) => {
    log.push(`${name}@${e.id}`);
    const out: string[] = [];
    for (let i = 0; i < searches; i++) out.push(await e.search(`${name}.${i}`));
    return out.join(',');
  };

  it('runs one job per engine concurrently, FIFO', async () => {
    const [a, b] = [new FakeEngine('A'), new FakeEngine('B')];
    const s = new Scheduler([a, b]);
    const log: string[] = [];
    const job = jobs(log);
    const ps = ['j1', 'j2', 'j3'].map((n) => s.run(n, Priority.BACKGROUND, job(n)));
    await settle();
    expect(log).toEqual(['j1@A', 'j2@B']);
    expect(s.runningCount).toBe(2);
    b.finish();
    await settle();
    expect(log).toEqual(['j1@A', 'j2@B', 'j3@B']);
    a.finish();
    b.finish();
    expect(await Promise.all(ps)).toEqual(['j1.0', 'j2.0', 'j3.0']);
    await s.onIdle();
    expect(s.busy).toBe(false);
  });

  it('a side-line job preempts the most recently started background job; it is re-queued and re-run', async () => {
    const [a, b] = [new FakeEngine('A'), new FakeEngine('B')];
    const s = new Scheduler([a, b]);
    const log: string[] = [];
    const job = jobs(log);
    const bg1 = s.run('bg1', Priority.BACKGROUND, job('bg1'));
    const bg2 = s.run('bg2', Priority.BACKGROUND, job('bg2'));
    const bg3 = s.run('bg3', Priority.BACKGROUND, job('bg3'));
    await settle();
    const side = s.run('side', Priority.SIDELINE, job('side'));
    await settle();
    expect(b.aborts).toBe(1); // bg2 started after bg1
    expect(a.aborts).toBe(0);
    expect(s.preemptions).toBe(1);
    expect(log).toEqual(['bg1@A', 'bg2@B', 'side@B']);
    expect(s.has('bg2')).toBe(true);
    expect(b.finish()).toBe('side.0');
    expect(await side).toBe('side.0');
    await settle();
    // bg2 keeps its place in the queue: it runs before bg3
    expect(log).toEqual(['bg1@A', 'bg2@B', 'side@B', 'bg2@B']);
    b.finish();
    a.finish();
    await settle();
    b.finish();
    expect(await Promise.all([bg1, bg2, bg3])).toEqual(['bg1.0', 'bg2.0', 'bg3.0']);
  });

  it('never preempts a job of equal or higher priority (a running job bumped to FOCUS is safe)', async () => {
    const [a, b] = [new FakeEngine('A'), new FakeEngine('B')];
    const s = new Scheduler([a, b]);
    const log: string[] = [];
    const job = jobs(log);
    const f1 = s.run('f1', Priority.FOCUS, job('f1'));
    const bg = s.run('bg', Priority.BACKGROUND, job('bg'));
    await settle();
    expect(s.bump('bg', Priority.FOCUS)).toBe(true);
    const f2 = s.run('f2', Priority.FOCUS, job('f2'));
    await settle();
    expect(a.aborts + b.aborts).toBe(0);
    expect(log).toEqual(['f1@A', 'bg@B']);
    a.finish();
    await settle();
    expect(log).toEqual(['f1@A', 'bg@B', 'f2@A']);
    a.finish();
    b.finish();
    await Promise.all([f1, bg, f2]);
  });

  it('a preempted job that is not searching can no longer use its engine (revoked lease) and is re-run', async () => {
    const a = new FakeEngine('A');
    const s = new Scheduler([a]);
    const log: string[] = [];
    let gate!: () => void;
    const bg = s.run('bg', Priority.BACKGROUND, async (e: FakeEngine) => {
      log.push(`bg@${e.id}`);
      if (log.length === 1) await new Promise<void>((r) => (gate = r)); // first attempt: busy without searching
      return e.search('bg');
    });
    await settle();
    const side = s.run('side', Priority.SIDELINE, async (e: FakeEngine) => e.search('side'));
    await settle();
    expect(a.current?.name).toBe('side');
    gate(); // the old attempt now tries to search: rejected without touching the engine
    await settle();
    expect(a.current?.name).toBe('side');
    a.finish();
    await settle();
    expect(log).toEqual(['bg@A', 'bg@A']);
    a.finish();
    expect(await side).toBe('side');
    expect(await bg).toBe('bg');
  });

  it('a preempted job that finishes anyway resolves normally', async () => {
    const a = new FakeEngine('A');
    const s = new Scheduler([a]);
    let gate!: () => void;
    const bg = s.run('bg', Priority.BACKGROUND, async () => {
      await new Promise<void>((r) => (gate = r));
      return 'done without searching';
    });
    await settle();
    const side = s.run('side', Priority.SIDELINE, async (e: FakeEngine) => e.search('side'));
    await settle();
    gate();
    expect(await bg).toBe('done without searching');
    a.finish();
    expect(await side).toBe('side');
    await s.onIdle();
  });

  it('preempt: false keeps the old non-preemptive behaviour', async () => {
    const a = new FakeEngine('A');
    const s = new Scheduler([a], { preempt: false });
    const log: string[] = [];
    const job = jobs(log);
    const bg = s.run('bg', Priority.BACKGROUND, job('bg'));
    await settle();
    const side = s.run('side', Priority.SIDELINE, job('side'));
    await settle();
    expect(a.aborts).toBe(0);
    a.finish();
    await settle();
    a.finish();
    expect(await Promise.all([bg, side])).toEqual(['bg.0', 'side.0']);
    expect(log).toEqual(['bg@A', 'side@A']);
  });
});

describe('Scheduler.addEngine', () => {
  it('a waiting job starts on an engine added later (the browser adds its WASM instances as they start)', async () => {
    const s = new Scheduler<{ id: string }>([{ id: 'A' }]);
    const started: string[] = [];
    const releases: (() => void)[] = [];
    const job = (name: string) => async (e: { id: string }) => {
      started.push(`${name}@${e.id}`);
      await new Promise<void>((r) => releases.push(r));
      return name;
    };
    const a = s.run('a', Priority.BACKGROUND, job('a'));
    const b = s.run('b', Priority.BACKGROUND, job('b'));
    await tick();
    expect(started).toEqual(['a@A']);
    s.addEngine({ id: 'B' });
    await tick();
    expect(started).toEqual(['a@A', 'b@B']);
    expect(s.engines).toHaveLength(2);
    releases.forEach((r) => r());
    expect(await Promise.all([a, b])).toEqual(['a', 'b']);
  });
});
