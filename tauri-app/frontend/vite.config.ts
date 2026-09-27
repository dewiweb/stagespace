/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Le show d'exemple bundlé vit à la racine du repo (examples/) —
  // hors du workspace root détecté par Vite (frontend/package.json).
  server: {
    fs: { allow: ['..', '../..'] },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
})
