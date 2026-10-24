/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// Dev server port and the API server it proxies `/api` to (env CLIENT_PORT / API_PORT; defaults 5173 / 5174).
const clientPort = Number(process.env.CLIENT_PORT ?? 5173);
const apiPort = Number(process.env.API_PORT ?? 5174);

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: clientPort,
    strictPort: true,
    proxy: {
      '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
    },
  },
  test: {
    name: 'client',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    passWithNoTests: true,
  },
});
