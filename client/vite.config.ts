/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:5174', changeOrigin: true },
    },
  },
  test: {
    name: 'client',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    passWithNoTests: true,
  },
});
