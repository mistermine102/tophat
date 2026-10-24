import { describe, expect, it } from 'vitest';
import { Priority, Scheduler } from '../src/engine/scheduler';

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
