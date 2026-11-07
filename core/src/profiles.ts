// Analysis profiles: named variants of the analysis settings.
import { type AnalysisSettings, DEFAULT_SETTINGS } from '@chess-coach/shared';

export type AnalysisProfile = 'default' | 'fast';

/**
 * `default` = DEFAULT_SETTINGS; `fast` = reduced search budget for E2E tests and quick looks (same pipeline, much
 * shallower searches; a different settings hash, so its cache entries never mix with full-depth results).
 * The app picks one with `?profile=fast` (client/src/worker/config.ts); Node scripts with env ANALYSIS_PROFILE.
 */
export function analysisSettingsFor(profile: string | undefined | null): AnalysisSettings {
  const p = (profile ?? '').trim().toLowerCase();
  if (!p || p === 'default') return DEFAULT_SETTINGS;
  if (p !== 'fast') throw new Error(`unknown analysis profile "${profile}" (expected "default" or "fast")`);
  const s: AnalysisSettings = structuredClone(DEFAULT_SETTINGS);
  s.budget.deep = { depth: 10, multipv: 5, maxMs: 1000 };
  s.budget.shallow = { depth: 6, multipv: 5, maxMs: 300 };
  s.budget.threat = { depth: 8, multipv: 1, maxMs: 300 };
  s.budget.forcedness = { depth: 8, multipv: 2, maxMs: 300 };
  return s;
}

/** Positive integer from an env / URL value, or undefined (unset / invalid). */
export function envInt(value: string | undefined | null): number | undefined {
  if (value === undefined || value === null || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
