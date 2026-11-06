/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Default analysis URL parameters baked into a dev server / build (api/index.ts `analysisQuery`). */
  readonly VITE_ANALYSIS_DEFAULTS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
