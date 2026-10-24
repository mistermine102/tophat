import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { Engine } from '../src/engine/uci';

async function get(app: ReturnType<typeof createApp>, path: string) {
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

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
