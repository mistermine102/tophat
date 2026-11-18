import { describe, expect, it } from 'vitest';
import { analysisConfig, defaultEngines, engineFile } from './config';

const ENV = { hardwareConcurrency: 12, crossOriginIsolated: true, deviceMemory: 8 };

describe('analysis config', () => {
  it('defaults: 1-thread lite-network instances, cores - 2, capped by count and memory', () => {
    expect(analysisConfig('', ENV)).toEqual({ flavour: 'lite', engines: 6, threads: 1, hashMb: 32, profile: 'default', testHooks: false });
    expect(defaultEngines(4)).toBe(2);
    expect(defaultEngines(2)).toBe(1);
    expect(defaultEngines(32)).toBe(6);
    expect(defaultEngines(12, 4)).toBe(3);
    expect(defaultEngines(12, 1)).toBe(1);
    expect(defaultEngines(0)).toBe(2); // unknown core count: assume 4
  });

  it('URL overrides', () => {
    expect(analysisConfig('?engines=3&hash=16&profile=fast&testhooks=1', ENV)).toMatchObject({ engines: 3, hashMb: 16, profile: 'fast', testHooks: true });
    expect(analysisConfig('?engines=0&hash=x', ENV)).toMatchObject({ engines: 6, hashMb: 32 });
    expect(analysisConfig('?engine=full', ENV).flavour).toBe('full');
    expect(analysisConfig('?engine=lite', ENV).flavour).toBe('lite');
    expect(analysisConfig('?engine=other', ENV).flavour).toBe('lite');
  });

  it('threads need cross-origin isolation and the full build', () => {
    expect(analysisConfig('?engine=full&threads=2', ENV).threads).toBe(2);
    expect(analysisConfig('?engine=full&threads=2', { ...ENV, crossOriginIsolated: false }).threads).toBe(1);
    expect(analysisConfig('?threads=2', ENV).threads).toBe(1); // the lite default has no multi-threaded build
  });

  it('engine file', () => {
    expect(engineFile({ flavour: 'full', threads: 1 })).toBe('stockfish-19-single.js');
    expect(engineFile({ flavour: 'full', threads: 2 })).toBe('stockfish-19.js');
    expect(engineFile({ flavour: 'lite', threads: 1 })).toBe('stockfish-19-lite-single.js');
  });
});
