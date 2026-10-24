import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, settingsHash } from '@chess-coach/shared';
import { analysisSettingsFor, createApp, envInt } from '../src/app';
import type { Engine } from '../src/engine/uci';

async function get(app: ReturnType<typeof createApp>, path: string) {
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: (await res.json().catch(() => null)) as unknown };
  } finally {
    server.close();
  }
}

describe('env options', () => {
  it('ANALYSIS_PROFILE: default keeps DEFAULT_SETTINGS, fast reduces only the search budget', () => {
    expect(analysisSettingsFor(undefined)).toBe(DEFAULT_SETTINGS);
    expect(analysisSettingsFor('default')).toBe(DEFAULT_SETTINGS);
    const fast = analysisSettingsFor(' FAST ');
    expect(fast.budget.deep.depth).toBeLessThan(DEFAULT_SETTINGS.budget.deep.depth);
    expect({ ...fast, budget: null }).toEqual({ ...DEFAULT_SETTINGS, budget: null });
    expect(settingsHash(fast)).not.toBe(settingsHash(DEFAULT_SETTINGS));
    expect(() => analysisSettingsFor('turbo')).toThrow(/ANALYSIS_PROFILE/);
  });
  it('ENGINE_THREADS parsing', () => {
    expect(envInt('2')).toBe(2);
    expect(envInt(undefined)).toBeUndefined();
    expect(envInt('')).toBeUndefined();
    expect(envInt('0')).toBeUndefined();
    expect(envInt('two')).toBeUndefined();
  });
  it('the fault-injection routes exist only with test hooks', async () => {
    const res = await get(createApp({ engine: null, scheduler: null }), '/api/test/kill-engine');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/health', () => {
  it('reports the engine', async () => {
    const engine = { alive: true, name: 'Stockfish 19' } as unknown as Engine;
    const res = await get(createApp({ engine, scheduler: null }), '/api/health');
    expect(res).toEqual({ status: 200, body: { ok: true, engine: 'Stockfish 19' } });
  });
  it('returns 503 when the engine is not running', async () => {
    const res = await get(createApp({ engine: null, scheduler: null, engineError: 'binary not found' }), '/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, error: 'binary not found' });
  });
});
