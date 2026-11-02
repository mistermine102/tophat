// Picks the data layer: `?mock=1` → MockApiClient (fixture data, no server), otherwise the real HTTP API.
import { RealApiClient } from './real';
import type { ApiClient } from './types';

export function isMockMode(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  const v = new URLSearchParams(search).get('mock');
  return v === '1' || v === 'true';
}

export async function createApiClient(mock = isMockMode()): Promise<ApiClient> {
  if (!mock) return new RealApiClient();
  // Loaded on demand so the fixture data isn't part of the normal startup path.
  const { MockApiClient } = await import('./mock');
  return new MockApiClient();
}

export type { ApiClient } from './types';
