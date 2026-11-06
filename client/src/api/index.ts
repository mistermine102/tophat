// Picks the data layer: `?mock=1` → MockApiClient (fixture data, no engine), otherwise the in-browser analysis
// (LocalApiClient: the analysis worker with Stockfish WASM).
import { analysisConfig } from '../worker/config';
import { LocalApiClient } from './local';
import type { ApiClient } from './types';

export function isMockMode(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  const v = new URLSearchParams(search).get('mock');
  return v === '1' || v === 'true';
}

/**
 * URL parameters of the analysis config: build-time defaults (env VITE_ANALYSIS_DEFAULTS, e.g. the E2E dev server's
 * "profile=fast&engines=2&testhooks=1") overridden by the page's own query.
 */
export function analysisQuery(search: string, defaults: string = import.meta.env.VITE_ANALYSIS_DEFAULTS ?? ''): string {
  const q = new URLSearchParams(defaults);
  for (const [k, v] of new URLSearchParams(search)) q.set(k, v);
  return q.toString();
}

export async function createApiClient(mock = isMockMode()): Promise<ApiClient> {
  if (!mock) {
    const worker = new Worker(new URL('../worker/analysis.worker.ts', import.meta.url), { type: 'module', name: 'chess-coach-analysis' });
    const config = analysisConfig(analysisQuery(location.search), {
      hardwareConcurrency: navigator.hardwareConcurrency,
      crossOriginIsolated: self.crossOriginIsolated === true,
      deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    });
    const client = new LocalApiClient(worker, config);
    if (config.testHooks) (window as unknown as { __chessCoachTest?: LocalApiClient }).__chessCoachTest = client;
    return client;
  }
  // Loaded on demand so the fixture data isn't part of the normal startup path.
  const { MockApiClient } = await import('./mock');
  return new MockApiClient();
}

export type { ApiClient } from './types';
