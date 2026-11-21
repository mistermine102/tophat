/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Default analysis URL parameters baked into a dev server / build (api/index.ts `analysisQuery`). */
  readonly VITE_ANALYSIS_DEFAULTS?: string;
  /** The site's base path ('/'; nuxt.config.ts from app.baseURL). Not BASE_URL: under Nuxt that is the assets' /_nuxt/. */
  readonly VITE_APP_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
